"use client";

import { bbox } from "@turf/turf";
import { Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect } from "react";

export default function Home() {
  // Map div id
  const mapIdDiv = "map";

  // Earth engine layer id
  const eeLayerId = "ee-layer";

  // Map container style
  const mapStyle = {
    height: "100%",
    width: "100%",
  };

  // Do the process after the component is mounted
  useEffect(() => {
    // Load new map
    const map = new Map({
      container: mapIdDiv,
      zoom: 4,
      center: [117, 0],
      style: "https://demotiles.maplibre.org/style.json",
    });

    // When map is loaded fetch the tile and add it to he map
    map.on("load", async () => {
      // Fetch to folder api/ee
      const res = await fetch("/api/ee");

      // Get the body of the response
      const { urlFormat, geojson, message } = await res.json();

      // If the process is error then show the error message
      if (!res.ok) {
        throw new Error(message);
      }

      // If it is good then add the layer url to the map
      map.addSource(eeLayerId, {
        type: "raster",
        tiles: [urlFormat],
        tileSize: 256,
      });

      // After the source is added then add it as map layer
      map.addLayer({
        type: "raster",
        source: eeLayerId,
        id: eeLayerId,
        minzoom: 0,
        maxzoom: 20,
      });

      // Then zoom it to the map layer
      // Change geojson to bbox
      const bounds = bbox(geojson);
      map.fitBounds(bounds);
    });
  }, []); // Make the dependecies to [] so that it is only loaded once

  return <div id={mapIdDiv} style={mapStyle}></div>;
}
