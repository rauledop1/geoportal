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
      const imageList = col.map((img) => {
        return ee.Feature(null, {
          id: img.id(),
          date: img.date().format("YYYY-MM-dd"),
          cloud: img.get("CLOUDY_PIXEL_PERCENTAGE"),
        });
      });

      // Get the data from Earth Engine
      // evaluate() is needed to get the actual JavaScript objects/list from the server
      const result = await evaluate(imageList.toList(50)); // Limit to 50 results
      const features = result.map((f) => f.properties);

      return NextResponse.json({ images: features }, { status: 200 });
    }

    if (action === "getMap") {
      const image = ee.Image(imageId);
      const vis = {
        bands: ['B8', 'B4', 'B3'],
        min: 0, // Using 0-3000 as per common S2 viz, script had 750 but 0 might be safer for general
        max: 3000,
        gamma: 1.4, // Adjusted gamma for better look
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

// Helper functions (same as before but simplified)
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

function evaluate(obj) {
  return new Promise((resolve, reject) =>
    obj.evaluate((result, error) =>
      error ? reject(new Error(error)) : resolve(result)
    )
  );
}

