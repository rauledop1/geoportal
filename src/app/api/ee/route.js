import "node-self";
import ee from "@google/earthengine";
import { NextResponse } from "next/server";
import { getSensorConfig } from "./sensors";
import { handleMonitorSearch, handleMonitorAnalysis, handleGetComunas } from "./monitor";
import { handleGeomorphologyAnalysis } from "./geomorphology";
import { handleSuperResolution } from "./super_resolution";

export async function POST(req) {
  try {
    const body = await req.json();
    const { action, startDate, endDate, cloudCover, geometry, imageId, sensor, visOption, comuna, baselineYear, minHeight } = body;
    const key = process.env.service_account_key;

    await authenticate(key);

    const selectedSensor = getSensorConfig(sensor);

    if (action === "search") {
      console.log("Search Action:", { sensor, startDate, endDate, cloudCover });

      if (selectedSensor.isCombined) {
        // Combined logic remains robust
        const s2 = getSensorConfig("Sentinel Harmonized");
        const l9 = getSensorConfig("Landsat (Pan-sharpened)");

        const s2Col = ee.ImageCollection(s2.collection)
          .filterDate(startDate, endDate)
          .filterBounds(ee.Geometry(geometry))
          .filter(ee.Filter.lte(s2.cloudBand, parseInt(cloudCover) || 100))
          .map(img => ee.Feature(null, {
            id: ee.String(s2.idPrefix).cat(img.get("system:index")),
            date: img.date().format("YYYY-MM-dd"),
            cloud: img.get(s2.cloudBand),
            time: img.get("system:time_start")
          }));

        const l9Col = ee.ImageCollection(l9.collection)
          .filterDate(startDate, endDate)
          .filterBounds(ee.Geometry(geometry))
          .filter(ee.Filter.lte(l9.cloudBand, parseInt(cloudCover) || 100))
          .map(img => ee.Feature(null, {
            id: ee.String(l9.idPrefix).cat(img.get("system:index")),
            date: img.date().format("YYYY-MM-dd"),
            cloud: img.get(l9.cloudBand),
            time: img.get("system:time_start")
          }));

        const combined = s2Col.merge(l9Col).sort("time", false); // Sort newest first
        const result = await evaluate(combined.limit(200).toList(200));
        const features = result.map((f) => f.properties);
        return NextResponse.json({ images: features }, { status: 200 });
      }

      if (selectedSensor.isStatic) {
        return NextResponse.json({
          images: [{ id: "CANOPY_HEIGHT_MOSAIC", date: "Global Mosaic", cloud: 0, time: Date.now() }]
        }, { status: 200 });
      }

      // Individual Search (S1 or Optical)
      let col = ee.ImageCollection(selectedSensor.collection)
        .filterDate(startDate, endDate)
        .filterBounds(ee.Geometry(geometry));

      if (sensor === "Sentinel-1 (SAR)") {
        col = col
          .filter(ee.Filter.eq('instrumentMode', 'IW'))
          .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
          .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'));
      } else {
        col = col.filter(ee.Filter.lte(selectedSensor.cloudBand, parseInt(cloudCover) || 100));
      }

      const featureCollection = col.sort("system:time_start", false).limit(200).map((img) => {
        return ee.Feature(null, {
          id: ee.String(selectedSensor.idPrefix).cat(img.get("system:index")),
          date: img.date().format("YYYY-MM-dd"),
          cloud: sensor === "Sentinel-1 (SAR)" ? 0 : img.get(selectedSensor.cloudBand),
          time: img.get("system:time_start")
        });
      });

      const result = await evaluate(featureCollection.toList(200));
      const features = result.map((f) => f.properties);
      return NextResponse.json({ images: features }, { status: 200 });
    }

    // ... (Monitor actions) ...

    if (action === "get-comunas") {
      return handleGetComunas();
    }
    if (action === "monitor-search") {
      return handleMonitorSearch(body);
    }
    if (action === "monitor-analysis") {
      return handleMonitorAnalysis(body);
    }
    if (action === "geom-analysis") {
      return handleGeomorphologyAnalysis(body);
    }
    if (action === "super-res") {
      return handleSuperResolution(body);
    }

    if (action === "getMap") {
      let image;
      let visParams = {};

      const toDb = (img) => ee.Image(10).multiply(img.max(0.0001).log10());

      // 1. Handle Static Mosaic Layers
      if (imageId === "CANOPY_HEIGHT_MOSAIC" || sensor === "Canopy Height (Meta)") {
        const config = getSensorConfig("Canopy Height (Meta)");
        let raw = ee.ImageCollection(config.collection).mosaic();

        // Apply Height Filter
        if (minHeight !== undefined) {
          raw = raw.updateMask(raw.gte(parseFloat(minHeight)));
        }

        image = raw;
        visParams = config.visParams;
      }
      // 2. Handle Sentinel-1 (SAR)
      else if (sensor === "Sentinel-1 (SAR)") {
        image = ee.Image(imageId);

        if (visOption === "RGB (VV+VH)") {
          const vv = image.select('VV').focal_mean(30, 'circle', 'meters');
          const vh = image.select('VH').focal_mean(30, 'circle', 'meters');
          const ratio = vv.divide(vh).rename('Ratio');
          const vvDb = toDb(vv).rename('VV');
          const vhDb = toDb(vh).rename('VH');
          image = ee.Image.cat([vvDb, vhDb, ratio]);
          visParams = { min: [-25, -25, 0], max: [0, -5, 2], bands: ['VV', 'VH', 'Ratio'] };
        } else if (visOption === "VH Intensity") {
          const vh = image.select('VH').focal_mean(30, 'circle', 'meters');
          const vhDb = toDb(vh).rename('VH');
          image = ee.Image.cat([vhDb, vhDb, vhDb]);
          visParams = { min: -25, max: 0, bands: ['VH', 'VH', 'VH'] };
        } else if (visOption === "VV + DEM") {
          const dem = ee.Image("USGS/SRTMGL1_003").clip(ee.Geometry(geometry || image.geometry()));
          const vv = image.select('VV').focal_mean(30, 'circle', 'meters');
          const hue = dem.clamp(0, 2000).divide(2000);
          const value = toDb(vv).clamp(-25, 0).subtract(-25).divide(25);
          image = ee.Image.cat([hue, ee.Image.constant(0.6), value]).hsvToRgb();
          visParams = { min: 0, max: 1 };
        } else {
          const vv = image.select('VV').focal_mean(30, 'circle', 'meters');
          const vvDb = toDb(vv).rename('VV');
          image = ee.Image.cat([vvDb, vvDb, vvDb]);
          visParams = { min: -25, max: 0, bands: ['VV', 'VV', 'VV'] };
        }
      }
      // 3. Handle Standard Optical Sensors
      else {
        image = ee.Image(imageId);
        const bands = selectedSensor.bands;
        if (visOption === "NDVI") {
          image = image.normalizedDifference([bands.NIR, bands.RED]);
          visParams = { min: 0, max: 0.8, palette: ['red', 'yellow', 'green'] };
        } else if (visOption === "NDWI") {
          image = image.normalizedDifference([bands.GREEN, bands.NIR]);
          visParams = { min: -0.5, max: 0.5, palette: ['red', 'yellow', 'blue'] };
        } else {
          let vizBands = [bands.RED, bands.GREEN, bands.BLUE];
          let max = 3000;
          if (visOption === "False Color (Infrared)") vizBands = [bands.NIR, bands.RED, bands.GREEN];
          if (sensor.includes("Landsat")) max = 30000;
          visParams = { min: 0, max, bands: vizBands, gamma: 1.4 };
        }
      }

      const { urlFormat } = await getMapId(image, visParams);
      return NextResponse.json({ urlFormat }, { status: 200 });
    }

    return NextResponse.json({ message: "Invalid action" }, { status: 400 });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
// Removed applyRefinedLee function to safely avoid EE object context issues.

// Helper functions (unchanged)
function authenticate(key) {
  return new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      JSON.parse(key),
      () => ee.initialize(null, null, resolve, reject),
      (error) => reject(new Error(error))
    );
  });
}

function getMapId(image, vis) {
  return new Promise((resolve, reject) => {
    image.getMapId(vis, (obj, error) =>
      error ? reject(new Error(error)) : resolve(obj)
    );
  });
}

// getThumbUrl removed

function evaluate(obj) {
  return new Promise((resolve, reject) =>
    obj.evaluate((result, error) =>
      error ? reject(new Error(error)) : resolve(result)
    )
  );
}
