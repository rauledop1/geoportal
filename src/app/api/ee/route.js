import "node-self";
import ee from "@google/earthengine";
import { NextResponse } from "next/server";
import { getSensorConfig } from "./sensors";

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

      const featuresWithThumbnails = await Promise.all(features.map(async (feat) => {
        // We no longer generate thumbnails
        return { ...feat, thumbnail: null };
      }));

      return NextResponse.json({ images: featuresWithThumbnails }, { status: 200 });
    }

    // --- Monitor Actions ---

    if (action === "get-comunas") {
      // Fetch Comunas from User Asset
      const comunasCollection = ee.FeatureCollection("users/raulperezastorga/Comunas");

      // We only need names for the dropdown.
      // Assuming the column name is 'Comuna' based on typical naming. 
      // If it's different (e.g. NOM_COM), this might need adjustment.
      const comunas = await evaluate(
        comunasCollection.reduceColumns(ee.Reducer.toList(), ["Comuna"]).get("list")
      );

      // Sort alphabetically
      const sortedComunas = (comunas || []).sort();

      return NextResponse.json({ comunas: sortedComunas }, { status: 200 });
    }

    if (action === "monitor-search") {
      // Input: comuna (name), dateRange (startDate, endDate)
      // 1. Get Geometry
      const region = ee.FeatureCollection("users/raulperezastorga/Comunas")
        .filter(ee.Filter.eq("Comuna", comuna))
        .geometry();

      // 2. Filter Collection (Sentinel-2)
      // Use S2_Harmonized
      const s2 = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
        .filterDate(startDate, endDate)
        .filterBounds(region)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 80)); // Loose filter

      // 3. Calculate Cloud Stats for Chart
      // Map over collection to get cloud info and simpler metadata
      const timeSeries = s2.map((img) => {
        return ee.Feature(null, {
          id: img.id(),
          date: img.date().format("YYYY-MM-dd"), // Time only
          system_time_start: img.get("system:time_start"),
          cloud: img.get("CLOUDY_PIXEL_PERCENTAGE"),
        });
      });

      const results = await evaluate(timeSeries.toList(100)); // Limit 100 points
      const data = results.map(f => f.properties);

      return NextResponse.json({ data }, { status: 200 });
    }

    if (action === "monitor-analysis") {
      // Input: imageId, comuna, baselineYear
      const region = ee.FeatureCollection("users/raulperezastorga/Comunas")
        .filter(ee.Filter.eq("Comuna", comuna))
        .geometry();

      // 1. Target Image
      let targetImg = ee.Image(imageId).clip(region);

      // 2. Baseline Image
      // Try to construct baseline from 'users/raulperezastorga/SGPE_2' if possible,
      // but fallback to Median of previous year same month.

      let baselineImg;
      // Logic: Get month of target image
      const targetDate = ee.Date(targetImg.get("system:time_start"));
      const month = targetDate.get("month");
      const year = targetDate.get("year");

      // Fallback Strategy: Median of Previous Year (+/- 1 month)
      // If baselineYear is provided, use that.
      const baseYearNum = baselineYear ? parseInt(baselineYear) : year.subtract(1);

      const startBase = ee.Date.fromYMD(baseYearNum, month, 1).advance(-1, 'month');
      const endBase = ee.Date.fromYMD(baseYearNum, month, 1).advance(2, 'month');

      const baseCol = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
        .filterDate(startBase, endBase)
        .filterBounds(region)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30));

      baselineImg = baseCol.median().clip(region);

      // 3. Compute NDII
      // Sentinel-2: NDII is (NIR - SWIR1) / (NIR + SWIR1) ? 
      // Or (B8 - B11) / (B8 + B11)? 
      // User script says: normalizedDifference(['B8', 'B4']) -> NDII? 
      // Wait, standard NDII uses SWIR. 
      // User script: image.addBands(image.normalizedDifference(['B8', 'B4']).rename('NDII'));
      // B8 is NIR, B4 is RED. That is NDVI!!
      // BUT user labeled it 'NDII'. 
      // The script also says: image.addBands(image.normalizedDifference(['B3', 'B11']).rename('NDSI'));
      // Let's stick to the USER'S DEFINITION in the script:
      // NDII = (B8 - B4) / (B8 + B4) -> This is actually NDVI in standard terms.
      // Let's call it NDII to match their request.

      const calcNDII = (img) => img.normalizedDifference(['B8', 'B4']).rename('NDII');

      const ndiiTarget = calcNDII(targetImg);

      // Baseline might need masking?
      // Using median handles some clouds, but let's assume it's clean enough.
      const ndiiBase = calcNDII(baselineImg);

      // 4. Difference
      // delta_ndii = ndii0 (base) - ndii1 (target)
      // "ndii0 = uso_SIP ... reduceToImage" -> Base
      // "ndii1 = clean(t1)" -> Target
      // delta = Base - Target
      const diff = ndiiBase.subtract(ndiiTarget);

      // 5. Threshold & Vectorize
      // "zones = delta_ndii.gte(0.15)"
      const zones = diff.gte(0.15).selfMask(); // Mask 0

      const vectors = zones.reduceToVectors({
        geometry: region,
        crs: 'EPSG:4326',
        scale: 20, // 10 might be too granular for API timeout
        geometryType: 'polygon',
        eightConnected: true,
        maxPixels: 1e8,
        bestEffort: true
      });

      // 6. URLs
      // Visualizations
      const vizRGB = { bands: ['B4', 'B3', 'B2'], min: 0, max: 3000 };
      // const vizDiff = { min: 0, max: 0.5, palette: ["008000","ff0000"] }; 
      // Actually, for the map we want the Polygons (vectors) or the Raster?
      // User script: Map.addLayer(vectors, viz_ndiiReclass_vector, 'Diferencias') -> White
      // Map.addLayer(delta_ndii.clip(pre), viz_deltandii, 'Cambios') -> Raster

      // Let's return Raster for colored overlay and Vectors for download?
      // Or Vectors for overlay?
      // Let's handle Raster MapID.
      const vizDiff = { min: 0, max: 0.5, palette: ["green", "red"] };

      const { urlFormat: urlTarget } = await getMapId(targetImg, vizRGB);
      const { urlFormat: urlDiff } = await getMapId(diff.updateMask(zones), vizDiff); // Only show changes

      // Download URL (KMZ)
      const downloadUrl = await new Promise((resolve, reject) => {
        vectors.getDownloadURL({
          format: 'kmz',
          filename: `monitor_${comuna}_${imageId}`
        }, (url, err) => {
          if (err) resolve(null); // Fail gracefully
          else resolve(url);
        });
      });

      return NextResponse.json({
        targetMap: urlTarget,
        diffMap: urlDiff,
        downloadUrl
      }, { status: 200 });
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
