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

function getDownloadUrl(image, params) {
    return new Promise((resolve, reject) => {
        image.getDownloadURL(params, (url, error) =>
            error ? reject(new Error(error)) : resolve(url)
        );
    });
}

export async function handleGeomorphologyAnalysis(body) {
    const { comuna, type } = body; // type: 'Slope', 'Aspect', 'Hillshade', 'DEM'

    // 1. Geometry (Comuna)
    const comunaFeature = ee.FeatureCollection("users/raulperezastorga/Comunas")
        .filter(ee.Filter.eq("Comuna", comuna));

    const region = comunaFeature.geometry();

    // 2. Load SRTM
    const srtm = ee.Image('USGS/SRTMGL1_003');

    // 3. Process based on type
    let resultImage;
    let visParams;
    let fileName = `geom_${comuna}_${type}`;

    const visualizacionPendiente = { min: 0, max: 45, palette: ['white', 'red'] };
    // User palette: 'blue,yellow,green,red' - comma separated string works in JS API but here better array
    const visualizacionExposicion = { min: 0, max: 360, palette: ['blue', 'yellow', 'green', 'red'] };
    const visualizacionSombra = { min: 0, max: 255, palette: ['black', 'white'] };
    const visualizacionDEM = { min: 0, max: 3000, palette: ['0000FF', '00FF00', 'FFFF00', 'FF0000', 'FFFFFF'] };

    // Clip BEFORE calculation is often faster/cleaner, BUT for slope/aspect it might cause edge artifacts?
    // User script: clip(provincia) AFTER calc (except DEM).
    // Let's calc then clip.

    if (type === 'Slope' || type === 'Pendiente') {
        resultImage = ee.Terrain.slope(srtm).clip(region);
        visParams = visualizacionPendiente;
    } else if (type === 'Aspect' || type === 'Exposición') {
        resultImage = ee.Terrain.aspect(srtm).clip(region);
        visParams = visualizacionExposicion;
    } else if (type === 'Hillshade' || type === 'Sombra de Relieve') {
        resultImage = ee.Terrain.hillshade(srtm).clip(region);
        visParams = visualizacionSombra;
    } else {
        // DEM
        resultImage = srtm.clip(region);
        visParams = visualizacionDEM;
    }

    // 4. Map ID
    const { urlFormat } = await getMapId(resultImage, visParams);

    // 5. Download URL (GeoTIFF)
    // User script: scale: 30, region: polygon
    const downloadUrl = await getDownloadUrl(resultImage, {
        scale: 30,
        region: region,
        format: 'GeoTIFF',
        name: fileName
    });

    // 6. Return Comuna Border Style?
    // We can't return an EE object style to frontend directly to Leaflet easily unless we use another transparency tile.
    // Ideally frontend draws the polygon (GeoJSON).
    // But API can return the border as a tile too.
    // User script: Map.addLayer(provincia.style(estiloProvincia)...

    const borderStyle = { color: 'FF0000', fillColor: '00000000', width: 2 };
    const borderImage = comunaFeature.style(borderStyle);
    const { urlFormat: urlBorder } = await getMapId(borderImage, {});

    const boundsInfo = await evaluate(region.bounds());

    return NextResponse.json({
        mapUrl: urlFormat,
        borderUrl: urlBorder,
        downloadUrl,
        bounds: boundsInfo // GeoJSON Geometry for Zoom
    }, { status: 200 });
}
