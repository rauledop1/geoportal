import "node-self";
import ee from "@google/earthengine";
import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const body = await req.json();
    const { action, startDate, endDate, cloudCover, geometry, imageId, sensor, visOption } = body;
    const key = process.env.service_account_key;

    await authenticate(key);

    // Define sensor configs and band mappings
    const SENSORS = {
      "Sentinel-2": {
        collection: "COPERNICUS/S2_SR",
        bands: { RED: 'B4', GREEN: 'B3', BLUE: 'B2', NIR: 'B8', SWIR1: 'B11' },
        cloudBand: "CLOUDY_PIXEL_PERCENTAGE",
        idPrefix: "COPERNICUS/S2_SR/"
      },
      "Sentinel-2 Harmonized": {
        collection: "COPERNICUS/S2_SR_HARMONIZED",
        bands: { RED: 'B4', GREEN: 'B3', BLUE: 'B2', NIR: 'B8', SWIR1: 'B11' },
        cloudBand: "CLOUDY_PIXEL_PERCENTAGE",
        idPrefix: "COPERNICUS/S2_SR_HARMONIZED/"
      },
      "Landsat 9": {
        collection: "LANDSAT/LC09/C02/T1_L2",
        bands: { RED: 'SR_B4', GREEN: 'SR_B3', BLUE: 'SR_B2', NIR: 'SR_B5', SWIR1: 'SR_B6' },
        cloudBand: "CLOUD_COVER",
        idPrefix: "LANDSAT/LC09/C02/T1_L2/"
      }
    };

    const selectedSensor = SENSORS[sensor] || SENSORS["Sentinel-2"];
    const bands = selectedSensor.bands;

    // Define Visualization Parameters based on option
    let visParams = {};
    if (visOption === "False Color (Infrared)") {
      visParams = { bands: [bands.NIR, bands.RED, bands.GREEN], min: 0, max: 3000, gamma: 1.4 };
      if (sensor === "Landsat 9") visParams.max = 30000;
    } else if (visOption === "NDVI") {
      // NDVI is computed, visParams are palette
      visParams = { min: 0, max: 1, palette: ['red', 'yellow', 'green'] };
    } else if (visOption === "NDWI") {
      // NDWI is computed, visParams are palette
      visParams = { min: -1, max: 1, palette: ['red', 'yellow', 'blue'] };
    } else {
      // Default RGB
      visParams = { bands: [bands.RED, bands.GREEN, bands.BLUE], min: 0, max: 3000, gamma: 1.4 };
      if (sensor === "Landsat 9") visParams.max = 30000;
    }

    if (action === "search") {
      const col = ee.ImageCollection(selectedSensor.collection)
        .filterDate(startDate, endDate)
        .filterBounds(ee.Geometry(geometry))
        .filter(ee.Filter.lte(selectedSensor.cloudBand, cloudCover))
        .sort(selectedSensor.cloudBand);

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

      const featuresWithThumbnails = await Promise.all(features.map(async (feat) => {
        let image = ee.Image(feat.id);

        // Handle Indices for Thumbnail
        if (visOption === "NDVI") {
          const ndvi = image.normalizedDifference([bands.NIR, bands.RED]);
          image = ndvi;
        } else if (visOption === "NDWI") {
          const ndwi = image.normalizedDifference([bands.GREEN, bands.NIR]);
          image = ndwi;
        }

        try {
          const thumbnail = await getThumbUrl(image, visParams, geometry);
          return { ...feat, thumbnail };
        } catch (e) {
          console.error(`Failed to get thumb for ${feat.id}`, e);
          return { ...feat, thumbnail: null };
        }
      }));

      return NextResponse.json({ images: featuresWithThumbnails }, { status: 200 });
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

function getThumbUrl(image, vis, regionGeoJSON) {
  return new Promise((resolve, reject) => {
    const params = {
      dimensions: '300x200',
      format: 'jpg'
    };
    if (regionGeoJSON) {
      params.region = regionGeoJSON;
    }

    // Visualize is typically necessary before getThumbURL for indices/palettes
    image.visualize(vis).getThumbURL(params, (url, error) => {
      if (error) reject(new Error(error));
      else resolve(url);
    });
  });
}

function evaluate(obj) {
  return new Promise((resolve, reject) =>
    obj.evaluate((result, error) =>
      error ? reject(new Error(error)) : resolve(result)
    )
  );
}
