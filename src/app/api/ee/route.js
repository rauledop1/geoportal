import "node-self";

import ee from "@google/earthengine";
import { NextResponse } from "next/server";

/**
 * Function that process earth engine script
 * Earth Engine script can only be processed on the server. So you cannot run it on the browser
 * @returns {Response} Returning response which body contain the url of the earth engine layer
 */
export async function GET() {
  // Do catch error if the process failed
  try {
    // Get the key from the .env file with key service_account
    const key = process.env.service_account_key;

    // Authenticate earth engine
    await authenticate(key);

    // Image collection of sentinel-2
    const col = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED");

    // Geojson geometry of the are we want
    const geojson = {
      coordinates: [
        [
          [103.57567457694688, -1.5538708282870601],
          [103.57567457694688, -1.6154123989164617],
          [103.63624333965345, -1.6154123989164617],
          [103.63624333965345, -1.5538708282870601],
          [103.57567457694688, -1.5538708282870601],
        ],
      ],
      type: "Polygon",
    };

    // Turn the geojson geometry to ee.Geometry for filtering earth engine collection
    const geometry = ee.Geometry(geojson);

    // Range of date for filter
    const start = "2023-05-01";
    const end = "2023-07-31";

    // Filter by date and bounds
    const filtered = col.filterBounds(geometry).filterDate(start, end);

    // Apply cloud masking
    const cloudMasked = filtered.map((image) => {
      const scl = image.select("SCL");
      const mask = scl
        .eq(3)
        .or(scl.gte(7).and(scl.lte(10)))
        .eq(0);
      return image.select(["B.*"]).updateMask(mask);
    });

    // Create a median composite of the image
    const median = cloudMasked.median();

    // Image visualization parameter
    // Using NIR-SWIR1-SWIR2 composite
    const vis = {
      min: [1000, 500, 250],
      max: [4000, 3000, 2000],
      bands: ["B8", "B11", "B12"],
    };

    // Get url format of the image
    const { urlFormat } = await getMapId(median, vis);

    // Also get the image geometry
    const imageGeom = filtered.geometry();
    const imageGeometryGeojson = await evaluate(imageGeom);

    // Return the result to the client/browser
    // Return url format and geojson geometry for zoom in
    return NextResponse.json(
      { urlFormat, geojson: imageGeometryGeojson },
      { status: 200 }
    );
  } catch ({ messsage }) {
    // If the process error then return the error message
    return NextResponse.json({ messsage }, { status: 404 });
  }
}

/**
 * Function to authenticate and initialize earth engine using google service account private key
 * This function is made so that authentication doesnt have to use callback but with promise (better to read)
 * @param {JSON} key JSON string of the private key
 * @returns {Promise<void>} did not return anything
 */
function authenticate(key) {
  return new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      JSON.parse(key),
      () =>
        ee.initialize(
          null,
          null,
          () => resolve(),
          (error) => reject(new Error(error))
        ),
      (error) => reject(new Error(error))
    );
  });
}

/**
 * Function to get the image tile url
 * This function is also for no callback
 * @param {ee.Image} image
 * @param {{ min: [number, number, number], max: [number, number, number], bands: [string, string, string]}}
 * @returns {Promise<{urlFormat: string}>} Will return the object with key urlFormat for viewing in web map
 */
function getMapId(image, vis) {
  return new Promise((resolve, reject) => {
    image.getMapId(vis, (obj, error) =>
      error ? reject(new Error(error)) : resolve(obj)
    );
  });
}

/**
 * Function to get an actual value of an ee object
 * @param {any} obj
 * @returns {any}
 */
function evaluate(obj) {
  return new Promise((resolve, reject) =>
    obj.evaluate((result, error) =>
      error ? reject(new Error(error)) : resolve(result)
    )
  );
}
