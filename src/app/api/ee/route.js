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
      const imageList = col.limit(50);

      const featureCollection = imageList.map((img) => {
        return ee.Feature(null, {
          // Construct Full ID as 'COPERNICUS/S2_SR/' + system:index
          id: ee.String("COPERNICUS/S2_SR/").cat(img.get("system:index")),
          date: img.date().format("YYYY-MM-dd"),
          cloud: img.get("CLOUDY_PIXEL_PERCENTAGE"),
        });
      });

      const result = await evaluate(featureCollection.toList(50));
      const features = result.map((f) => f.properties);

      // Generate thumbnails for each image
      const featuresWithThumbnails = await Promise.all(features.map(async (feat) => {
        // Now feat.id should be the full path e.g. COPERNICUS/S2_SR/2023...
        const image = ee.Image(feat.id);
        const vis = {
          bands: ['B8', 'B4', 'B3'],
          min: 0,
          max: 3000,
          gamma: 1.4,
        };
        try {
          // Pass geometry as region to focus thumbnail
          // Must be a GeoJSON object or ee.Geometry, but getThumbURL expects JSON/coords if client-side or specific format
          // Since we are server-side with Node, passing the 'geometry' object (GeoJSON) directly to region might need ee.Geometry(geometry) serialization?
          // getThumbURL options: region must be GeoJSON or WKT or ... 
          // Actually it often accepts a pure GeoJSON object.

          const thumbnail = await getThumbUrl(image, vis, geometry);
          return { ...feat, thumbnail };
        } catch (e) {
          console.error(`Failed to get thumb for ${feat.id}`, e);
          return { ...feat, thumbnail: null };
        }
      }));

      return NextResponse.json({ images: featuresWithThumbnails }, { status: 200 });
    }

    if (action === "getMap") {
      // imageId coming from frontend should now be full path
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
