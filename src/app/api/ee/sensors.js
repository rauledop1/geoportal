
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
    }
};

export function getSensorConfig(sensorName) {
    return SENSORS[sensorName] || SENSORS["Sentinel-2"];
}
