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
    const { action, startDate, endDate, cloudCover, geometry, imageId, sensor, visOption, comuna, baselineYear, minHeight, t1ImageId, t2ImageId } = body;
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

        const combined = s2Col.merge(l9Col).sort("time", true); // Sort oldest first so recent is at the end
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

      const featureCollection = col.sort("system:time_start", true).limit(200).map((img) => {
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
      } else if (imageId === "DSM_MOSAIC" || sensor === "Digital Surface Model") {
        const config = getSensorConfig("Digital Surface Model");
        const srtm = ee.Image(config.collection);

        if (visOption === 'Slope') {
          image = ee.Terrain.slope(srtm);
          visParams = { min: 0, max: 45, palette: 'white,red' };
        } else if (visOption === 'Aspect') {
          image = ee.Terrain.aspect(srtm);
          visParams = { min: 0, max: 360, palette: 'blue,yellow,green,red' };
        } else if (visOption === 'Hillshade') {
          image = ee.Terrain.hillshade(srtm);
          visParams = { min: 0, max: 255, palette: ['black', 'white'] };
        } else {
          // Default to DEM
          image = srtm;
          visParams = { min: 0, max: 3000, palette: ['0000FF', '00FF00', 'FFFF00', 'FF0000', 'FFFFFF'] };
        }
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
        } else if (visOption === "Harvest-Deforestation") {
          // Convert dB to Linear Power for calculation
          const toPower = (img) => ee.Image(10).pow(img.divide(10));
          const vv = toPower(image.select('VV'));
          const vh = toPower(image.select('VH'));

          const area = vv.multiply(vh);
          const v_len = vv.pow(2).add(vh.pow(2)).sqrt();

          const GAIN = 2.5;
          const WATER_LIMIT = 0.1;
          const FOREST_LIMIT = 0.2;
          const INVERSE_FACTOR = 25;

          // Simple thresholding logic based on the user's SCRIPT
          // Since we can't easily reproduce the "ColorRampVisualizer" in plain EE without more complex mapping,
          // we use a more direct image calculation approach.

          const waterMask = v_len.lt(WATER_LIMIT);
          const forestMask = v_len.gt(FOREST_LIMIT);
          const deficitMask = v_len.gte(WATER_LIMIT).and(v_len.lte(FOREST_LIMIT));

          // Green Index: GAIN * v_len - v_angle_weighted
          const v_angle_weighted = vh.divide(vv).atan().divide(Math.PI / 2);
          const greenIndex = v_len.multiply(GAIN).subtract(v_angle_weighted);

          // Red Index: GAIN * v_len_inverse + v_angle_weighted
          const v_len_inverse = ee.Image(1).divide(v_len.multiply(INVERSE_FACTOR));
          const redIndex = v_len_inverse.multiply(GAIN).add(v_angle_weighted);

          // We'll use a color palette for these indices
          // Combining them into one visualization layer is tricky, so we'll create a composite
          const greenPart = greenIndex.updateMask(forestMask);
          const redPart = redIndex.updateMask(deficitMask);

          image = ee.Image.cat([redPart, greenPart, ee.Image(0).updateMask(redPart.or(greenPart))]);
          visParams = { min: 0, max: 1, bands: ['constant_1', 'constant', 'constant_2'] };
          // Note: EE auto-names bands from expressions. We'll simplify.

          image = ee.Image(0).visualize({ palette: ['000000'] })
            .where(forestMask, greenIndex.visualize({ min: 0, max: 1, palette: ['003300', '406600', '80f300'] }))
            .where(deficitMask, redIndex.visualize({ min: 0, max: 1, palette: ['000000', 'ae0000', 'ff6e00', 'ff8600', 'ffffff'] }))
            .where(waterMask, ee.Image(0).visualize({ palette: ['000080'] }));

          visParams = {}; // Already visualized
        } else if (visOption === "Radar Vegetation Index") {
          const toPower = (img) => ee.Image(10).pow(img.divide(10));
          const calcRVI = (img) => {
            const vv = toPower(img.select('VV'));
            const vh = toPower(img.select('VH'));
            const denom = vh.multiply(2).add(vv.multiply(2));
            return vh.multiply(8).divide(denom).rename('RVI');
          };

          const endDate = image.date();
          const startDate = endDate.advance(-3, 'month');
          const config = getSensorConfig("Sentinel-1 (SAR)");

          const collection = ee.ImageCollection(config.collection)
            .filterBounds(image.geometry())
            .filterDate(startDate, endDate)
            .filter(ee.Filter.eq('instrumentMode', 'IW'))
            .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
            .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'));

          const getMonthMean = (monthOffset) => {
            const start = endDate.advance(monthOffset, 'month');
            const end = start.advance(1, 'month');
            const monthCol = collection.filterDate(start, end);
            return monthCol.map(calcRVI).mean().unitScale(0.25, 0.75).clamp(0, 1);
          };

          const rviMonth0 = getMonthMean(-1);
          const rviMonth1 = getMonthMean(-2);
          const rviMonth2 = getMonthMean(-3);

          image = ee.Image.cat([rviMonth2, rviMonth1, rviMonth0]);
          visParams = { min: 0, max: 1 };
        } else if (visOption === "Crop Monitoring") {
          const toPower = (img) => ee.Image(10).pow(img.divide(10));
          const config = getSensorConfig("Sentinel-1 (SAR)");

          let slave, master;

          if (t1ImageId && t2ImageId) {
            master = ee.Image(t1ImageId);
            slave = ee.Image(t2ImageId);
          } else {
            slave = image;
            // Fallback to auto-finding master (~4 months prior)
            const masterDate = slave.date().advance(-4, 'month');
            const masterCol = ee.ImageCollection(config.collection)
              .filterBounds(slave.geometry())
              .filterDate(masterDate.advance(-15, 'day'), masterDate.advance(15, 'day'))
              .filter(ee.Filter.eq('instrumentMode', 'IW'))
              .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
              .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
              .sort('system:time_start', false);
            master = ee.Image(masterCol.first());
          }

          const slaveVV = toPower(slave.select('VV'));
          const slaveVH = toPower(slave.select('VH'));
          const masterVH = toPower(master.select('VH'));

          // Logic from provided script: Dif = Slave - Master
          const red = slaveVV.multiply(1.5);
          const green = slaveVH.subtract(masterVH).multiply(8.0);
          const blue = slaveVV.multiply(0.5);

          image = ee.Image.cat([red, green, blue]);
          visParams = { min: 0, max: 0.5 };
        } else if (visOption === "Radar Soil Moisture") {
          const toPower = (img) => ee.Image(10).pow(img.divide(10));
          const config = getSensorConfig("Sentinel-1 (SAR)");

          const endDate = image.date();
          const startDate = endDate.advance(-36, 'month');

          const col = ee.ImageCollection(config.collection)
            .filterBounds(image.geometry())
            .filterDate(startDate, endDate)
            .filter(ee.Filter.eq('instrumentMode', 'IW'))
            .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
            .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
            .map(img => img.addBands(toPower(img.select('VV')).rename('VV_power')));

          const stats = col.select('VV_power').reduce(ee.Reducer.min().combine(ee.Reducer.max(), null, true).combine(ee.Reducer.mean(), null, true));
          const min = stats.select('VV_power_min');
          const max = stats.select('VV_power_max');
          const mean = stats.select('VV_power_mean');
          const sensitivity = max.subtract(min);

          const currentVV = toPower(image.select('VV'));
          let mv = currentVV.subtract(min).divide(sensitivity);

          // Masks from script
          const meanDb = toDb(mean);
          const urbanMask = meanDb.gt(-6).not();
          const waterMask = meanDb.lt(-17).not();

          mv = mv.multiply(urbanMask).multiply(waterMask).rename('SSM');

          // Visualize using the script's color transitions
          image = mv.visualize({
            min: 0,
            max: 0.6,
            palette: ['ffffff', 'ff0000', 'ffff00', '00ffff', '0000ff', '000080']
          });
          visParams = {}; // Already visualized
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
          visParams = {
            min: -1.0,
            max: 0.9,
            palette: [
              '000000', 'A50026', 'D73027', 'F46D43', 'FDAE61', 'FEE08B',
              'FFFFBF', 'D9EF8B', 'A6D96A', '66BD63', '1A9850', '006837'
            ]
          };
        } else if (visOption === "NDWI") {
          image = image.normalizedDifference([bands.GREEN, bands.NIR]);
          visParams = {
            min: -0.8,
            max: 0.8,
            palette: ['800000', 'ff0000', 'ffff00', '00ffff', '0000ff', '000080']
          };
        } else if (visOption === "Vegetation Change") {
          let t1, t2;
          if (t1ImageId && t2ImageId) {
            t1 = ee.Image(t1ImageId);
            t2 = ee.Image(t2ImageId);
          } else {
            // Default to comparing selected image with one from 1 year ago
            t2 = image;
            const pastDate = t2.date().advance(-1, 'year');
            const pastCol = ee.ImageCollection(selectedSensor.collection)
              .filterBounds(t2.geometry())
              .filterDate(pastDate.advance(-30, 'day'), pastDate.advance(30, 'day'))
              .sort(selectedSensor.cloudBand || 'CLOUD_COVER');
            t1 = ee.Image(pastCol.first());
          }

          const ndvi1 = t1.normalizedDifference([bands.NIR, bands.RED]);
          const ndvi2 = t2.normalizedDifference([bands.NIR, bands.RED]);

          // Delta = Baseline - Current (Positive means loss of vegetation)
          image = ndvi1.subtract(ndvi2);
          visParams = {
            min: 0.2,
            max: 0.8,
            palette: ["008000", "ffcc00", "ff0000", "36013f"]
          };
        } else {
          let vizBands = [bands.RED, bands.GREEN, bands.BLUE];
          let max = 4000; // Applying ~2.5x gain (10000 / 2.5 = 4000)
          if (visOption === "False Color (Infrared)") {
            vizBands = [bands.NIR, bands.RED, bands.GREEN];
            max = 4000;
          }
          if (sensor.includes("Landsat")) {
            // For Landsat C2 L2, max is 65535, but typical values reach ~30000-40000 for bright surfaces.
            max = 30000;
          }
          if (visOption === "Wildfire") {
            const b12 = image.select(bands.SWIR1 || 'B12');
            const b11 = image.select('B11'); // Sentinel-2 Harmonized has SWIR1 as B11, B12 is SWIR2
            // Pierre Markuse QuickFire uses B12, B11, B8, B4, B3, B2
            // Standard hotspots use SWIR:
            const hotspot = b12.add(b11).gt(1.0); // Simple threshold for hotspot in 0-1 range or similar
            // But we need to handle the scaling.

            // Urban/SWIR style visualization
            const red = image.select(bands.SWIR1 || 'B11').multiply(2.0);
            const green = image.select(bands.NIR || 'B8').multiply(1.5);
            const blue = image.select(bands.RED || 'B4');

            image = ee.Image.cat([red, green, blue]);
            max = 8000;
          }
          visParams = { min: 0, max, bands: vizBands, gamma: 1.4 };

          if (visOption === "Wildfire") {
            // Redefine for wildfire
            visParams = { min: 0, max: 10000, bands: [bands.SWIR1 || 'B12', bands.NIR || 'B8', bands.RED || 'B4'], gamma: [1.0, 1.2, 1.2] };
          }
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
