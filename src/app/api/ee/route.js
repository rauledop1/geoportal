import "node-self";
import ee from "@google/earthengine";
import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const body = await req.json();
    const { action, startDate, endDate, cloudCover, geometry, imageId } = body;
    const key = process.env.service_account_key;

    await authenticate(key);

    if (action === "search") {
      const col = ee.ImageCollection("COPERNICUS/S2_SR")
        .filterDate(startDate, endDate)
        .filterBounds(ee.Geometry(geometry))
        .filter(ee.Filter.lte("CLOUDY_PIXEL_PERCENTAGE", cloudCover))
        .sort("CLOUDY_PIXEL_PERCENTAGE");

      // Extract necessary metadata
      const imageList = col.limit(50); // Limit to 50

      const featureCollection = imageList.map((img) => {
        return ee.Feature(null, {
          id: img.id(),
          date: img.date().format("YYYY-MM-dd"),
          cloud: img.get("CLOUDY_PIXEL_PERCENTAGE"),
        });
      });

      const result = await evaluate(featureCollection.toList(50));
      const features = result.map((f) => f.properties);

      // Generate thumbnails for each image
      const featuresWithThumbnails = await Promise.all(features.map(async (feat) => {
        const image = ee.Image(feat.id);
        const vis = {
          bands: ['B8', 'B4', 'B3'],
          min: 0,
          max: 3000,
          gamma: 1.4,
        };
        try {
          const thumbnail = await getThumbUrl(image, vis);
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
      const vis = {
        bands: ['B8', 'B4', 'B3'],
        min: 0,
        max: 3000,
        gamma: 1.4,
      };

      const { urlFormat } = await getMapId(image, vis);
      return NextResponse.json({ urlFormat }, { status: 200 });
    }

    return NextResponse.json({ message: "Invalid action" }, { status: 400 });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

// Helper functions
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

function getThumbUrl(image, vis) {
  return new Promise((resolve, reject) => {
    image.visualize(vis).getThumbURL({
      dimensions: '100x100',
      format: 'jpg'
    }, (url, error) => {
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
