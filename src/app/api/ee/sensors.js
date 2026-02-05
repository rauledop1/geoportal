
export const SENSORS = {
    "Sentinel Harmonized": {
        collection: "COPERNICUS/S2_SR_HARMONIZED",
        bands: { RED: 'B4', GREEN: 'B3', BLUE: 'B2', NIR: 'B8', SWIR1: 'B11' },
        cloudBand: "CLOUDY_PIXEL_PERCENTAGE",
        idPrefix: "COPERNICUS/S2_SR_HARMONIZED/"
    },
    "Landsat (Pan-sharpened)": {
        collection: "LANDSAT/LC09/C02/T1_L2", // Keeping Landsat 9 as base
        bands: { RED: 'SR_B4', GREEN: 'SR_B3', BLUE: 'SR_B2', NIR: 'SR_B5', SWIR1: 'SR_B6' },
        cloudBand: "CLOUD_COVER",
        idPrefix: "LANDSAT/LC09/C02/T1_L2/"
    },
    "Sentinel-1 (SAR)": {
        collection: "COPERNICUS/S1_GRD",
        bands: { VV: 'VV', VH: 'VH' },
        cloudBand: null, // SAR has no clouds
        idPrefix: "COPERNICUS/S1_GRD/"
    },
    "Canopy Height (Meta)": {
        collection: "projects/meta-forest-monitoring-okw37/assets/CanopyHeight",
        isStatic: true,
        visParams: {
            min: 0,
            max: 30,
            palette: ['ffffff', 'f7fcb9', 'addd8e', '78c679', '41ab5d', '238443', '005a32']
        },
        idPrefix: "META/CANOPY/"
    },
    "Digital Surface Model": {
        collection: "USGS/SRTMGL1_003",
        isStatic: true,
        visParams: {
            min: 0,
            max: 3000,
            palette: ['0000FF', '00FF00', 'FFFF00', 'FF0000', 'FFFFFF']
        },
        idPrefix: "USGS/SRTM/"
    },
    "Combined (Landsat + Sentinel)": {
        isCombined: true // Flag for special handling
    }
};

export function getSensorConfig(sensorName) {
    return SENSORS[sensorName] || SENSORS["Sentinel-2"];
}
