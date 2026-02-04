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
    const { action, startDate, endDate, cloudCover, geometry, imageId, sensor, visOption, comuna, baselineYear } = body;
    const key = process.env.service_account_key;

    await authenticate(key);

    const selectedSensor = getSensorConfig(sensor);
    const bands = selectedSensor.bands;

    // Define Visualization Parameters based on option
    let visParams = {};
    if (visOption === "False Color (Infrared)") {
      visParams = { bands: [bands.NIR, bands.RED, bands.GREEN], min: 0, max: 3000, gamma: 1.4 };
      if (sensor.includes("Landsat")) visParams.max = 30000;
    } else if (visOption === "NDVI") {
      // NDVI is computed, visParams are palette
      visParams = { min: 0, max: 1, palette: ['red', 'yellow', 'green'] };
    } else if (visOption === "NDWI") {
      // NDWI is computed, visParams are palette
      visParams = { min: -1, max: 1, palette: ['red', 'yellow', 'blue'] };
    } else {
      // Default RGB
      visParams = { bands: [bands.RED, bands.GREEN, bands.BLUE], min: 0, max: 3000, gamma: 1.4 };
      if (sensor.includes("Landsat")) visParams.max = 30000;
    }

    if (action === "search") {
      if (selectedSensor.isCombined) {
        // Combined logic: Fetch both
        const s2 = getSensorConfig("Sentinel Harmonized");
        const l9 = getSensorConfig("Landsat (Pan-sharpened)");

        const s2Col = ee.ImageCollection(s2.collection)
          .filterDate(startDate, endDate)
          .filterBounds(ee.Geometry(geometry))
          .filter(ee.Filter.lte(s2.cloudBand, cloudCover))
          .map(img => ee.Feature(null, {
            id: ee.String(s2.idPrefix).cat(img.get("system:index")),
            date: img.date().format("YYYY-MM-dd"),
            cloud: img.get(s2.cloudBand),
            time: img.get("system:time_start")
          }));

        const l9Col = ee.ImageCollection(l9.collection)
          .filterDate(startDate, endDate)
          .filterBounds(ee.Geometry(geometry))
          .filter(ee.Filter.lte(l9.cloudBand, cloudCover))
          .map(img => ee.Feature(null, {
            id: ee.String(l9.idPrefix).cat(img.get("system:index")),
            date: img.date().format("YYYY-MM-dd"),
            cloud: img.get(l9.cloudBand),
            time: img.get("system:time_start")
          }));

        const combined = s2Col.merge(l9Col).sort("time");
        const result = await evaluate(combined.limit(100).toList(100));
        const features = result.map((f) => f.properties);
        return NextResponse.json({ images: features }, { status: 200 });
      }

      const col = ee.ImageCollection(selectedSensor.collection)
        .filterDate(startDate, endDate)
        .filterBounds(ee.Geometry(geometry))
        .filter(ee.Filter.lte(selectedSensor.cloudBand, cloudCover))
        .sort("system:time_start"); // Sorted Oldest to Newest

      const imageList = col.limit(50);

      const featureCollection = imageList.map((img) => {
        return ee.Feature(null, {
          id: ee.String(selectedSensor.idPrefix).cat(img.get("system:index")),
          date: img.date().format("YYYY-MM-dd"),
          cloud: img.get(selectedSensor.cloudBand),
        });
      });

      const result = await evaluate(featureCollection.toList(50));
      const features = result.map((f) => f.properties);

      return NextResponse.json({ images: features }, { status: 200 });
    }

    // --- Monitor Actions ---

    if (action === "get-comunas") {
      return handleGetComunas();
    }

    if (action === "monitor-search") {
      return handleMonitorSearch(body);
    }

    if (action === "monitor-analysis") {
      return handleMonitorAnalysis(body);
    }

    // --- Geomorphology Actions ---

    if (action === "geom-analysis") {
      return handleGeomorphologyAnalysis(body);
    }

    if (action === "geom-analysis") {
      return handleGeomorphologyAnalysis(body);
    }

    if (action === "super-res") {
      return handleSuperResolution(body);
    }

    if (action === "getMap") {
      let image = ee.Image(imageId);

      // Handle Indices for Map
      if (visOption === "NDVI") {
        const ndvi = image.normalizedDifference([bands.NIR, bands.RED]);
        image = ndvi;
      } else if (visOption === "NDWI") {
        const ndwi = image.normalizedDifference([bands.GREEN, bands.NIR]);
        image = ndwi;
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
