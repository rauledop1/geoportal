import "node-self";
import ee from "@google/earthengine";
import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const body = await req.json();
    const { action, startDate, endDate, cloudCover, geometry, imageId, sensor } = body;
    const key = process.env.service_account_key;

    await authenticate(key);

    // Define sensor configs
    const SENSORS = {
      "Sentinel-2": {
        collection: "COPERNICUS/S2_SR",
        vis: { bands: ['B8', 'B4', 'B3'], min: 0, max: 3000, gamma: 1.4 },
        cloudBand: "CLOUDY_PIXEL_PERCENTAGE",
        idPrefix: "COPERNICUS/S2_SR/"
      },
      "Sentinel-2 Harmonized": {
        collection: "COPERNICUS/S2_SR_HARMONIZED",
        vis: { bands: ['B8', 'B4', 'B3'], min: 0, max: 3000, gamma: 1.4 },
        cloudBand: "CLOUDY_PIXEL_PERCENTAGE",
        idPrefix: "COPERNICUS/S2_SR_HARMONIZED/"
      },
      "Landsat 9": {
        collection: "LANDSAT/LC09/C02/T1_L2",
        vis: { bands: ['SR_B5', 'SR_B4', 'SR_B3'], min: 0, max: 30000, gamma: 1.4 }, // Landsat values are roughly 0-65535, typical scaling
        cloudBand: "CLOUD_COVER", // Property name is different for Landsat
        idPrefix: "LANDSAT/LC09/C02/T1_L2/"
      }
    };

    const selectedSensor = SENSORS[sensor] || SENSORS["Sentinel-2"];

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
          cloud: img.get(selectedSensor.cloudBand), // Get correct cloud band
        });
      });

      const result = await evaluate(featureCollection.toList(50));
      const features = result.map((f) => f.properties);

      const featuresWithThumbnails = await Promise.all(features.map(async (feat) => {
        const image = ee.Image(feat.id);

        try {
          const thumbnail = await getThumbUrl(image, selectedSensor.vis, geometry);
          return { ...feat, thumbnail };
        } catch (e) {
          console.error(`Failed to get thumb for ${feat.id}`, e);
          return { ...feat, thumbnail: null };
        }
      }));

      return NextResponse.json({ images: featuresWithThumbnails }, { status: 200 });
    }

    if (action === "getMap") {
      const image = ee.Image(imageId);
      // For getMap, we might need to know the sensor again to apply right VIS, or infer/force pass it.
      // But actually, we can try to guess or better yet, pass 'sensor' in getMap action too.
      // Assuming frontend passes 'sensor' state in this call too.

      const { urlFormat } = await getMapId(image, selectedSensor.vis);
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
