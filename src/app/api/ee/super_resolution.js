import ee from "@google/earthengine";
import { NextResponse } from "next/server";

// Helper functions (reused)
function evaluate(obj) {
    return new Promise((resolve, reject) =>
        obj.evaluate((result, error) =>
            error ? reject(new Error(error)) : resolve(result)
        )
    );
}

function getMapId(image, vis) {
    return new Promise((resolve, reject) => {
        image.getMapId(vis, (obj, error) =>
            error ? reject(new Error(error)) : resolve(obj)
        );
    });
}

export async function handleSuperResolution(body) {
    const { comuna } = body;

    // 1. Geometry
    const comunaFeature = ee.FeatureCollection("users/raulperezastorga/Comunas")
        .filter(ee.Filter.eq("Comuna", comuna));

    const region = comunaFeature.geometry();

    // 2. Fetch Image
    let rawImage;
    if (body.imageId) {
        // Option A: Specific Scene
        rawImage = ee.Image(body.imageId).clip(region);
    } else {
        // Option B: Latest Cloud-Free (Fallback)
        const now = new Date();
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(now.getMonth() - 3);

        const s2 = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
            .filterDate(threeMonthsAgo.toISOString().split('T')[0], now.toISOString().split('T')[0])
            .filterBounds(region)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 10))
            .sort("system:time_start", false); // Newest first

        // Check if we have images
        const count = await evaluate(s2.size());
        if (count === 0) {
            return NextResponse.json({ error: "No recent cloud-free images found for this location." }, { status: 404 });
        }

        rawImage = s2.first().clip(region);
    }
    const date = await evaluate(rawImage.date().format("YYYY-MM-dd"));

    // 3. Processing
    // Standard RGB
    const rgb = rawImage.select(['B4', 'B3', 'B2']);
    const visParams = { min: 0, max: 3000 };

    // Sharpening
    // 1. Resample (Bicubic) to finer scale? 
    // EE handles zoom automatically, but we can force a resample.
    // 2. Apply Laplacian Kernel
    // Kernel: [ [0, -1, 0], [-1, 5, -1], [0, -1, 0] ] (Standard sharpening)

    const kernel = ee.Kernel.fixed(3, 3, [
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
    ]);

    const sharpened = rgb.convolve(kernel);

    // Get MapIDs
    const [mapOriginal, mapEnhanced] = await Promise.all([
        getMapId(rawImage, { bands: ['B4', 'B3', 'B2'], min: 0, max: 3000 }),
        getMapId(sharpened, { min: 0, max: 3000 }) // Bands are already B4, B3, B2
    ]);

    // Bounds
    const boundsInfo = await evaluate(region.bounds());

    return NextResponse.json({
        originalMap: mapOriginal.urlFormat,
        enhancedMap: mapEnhanced.urlFormat,
        bounds: boundsInfo,
        date: date
    }, { status: 200 });
}
