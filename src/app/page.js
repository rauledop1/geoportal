"use client";

import { useEffect, useRef, useState } from "react";
import { Map, Marker, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./page.module.css";

export default function Home() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);

  // State for Sentinel-2
  const [startDate, setStartDate] = useState("2023-05-01");
  const [endDate, setEndDate] = useState("2023-07-31");
  const [cloudCover, setCloudCover] = useState(60);
  const [geometry, setGeometry] = useState(null); // GeoJSON point
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeLayerId, setActiveLayerId] = useState(null);

  // State for Location Search
  const [locationQuery, setLocationQuery] = useState("");

  // Initialize Map
  useEffect(() => {
    if (map.current) return;

    map.current = new Map({
      container: mapContainer.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [-71.5, -33.5], // Default center (Chile roughly)
      zoom: 8,
    });

    map.current.addControl(new NavigationControl(), 'bottom-right');

    map.current.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      const point = {
        type: "Point",
        coordinates: [lng, lat]
      };

      setGeometry(point);

      // Update marker
      if (marker.current) {
        marker.current.setLngLat([lng, lat]);
      } else {
        marker.current = new Marker({ color: "#0070f3" })
          .setLngLat([lng, lat])
          .addTo(map.current);
      }
    });

  }, []);

  const handleLocationSearch = async (e) => {
    e.preventDefault();
    if (!locationQuery.trim()) return;

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationQuery)}`);
      const data = await res.json();

      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        map.current.flyTo({
          center: [lon, lat],
          zoom: 12
        });
      } else {
        alert("Location not found");
      }
    } catch (err) {
      console.error(err);
      alert("Error searching location");
    }
  };

  const handleSearch = async () => {
    if (!geometry) {
      setError("Please select a location on the map first (click on map).");
      return;
    }
    setError(null);
    setLoading(true);
    setImages([]);

    try {
      const res = await fetch("/api/ee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "search",
          startDate,
          endDate,
          cloudCover,
          geometry
        })
      });

      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setImages(data.images || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLayerAdd = async (imageId) => {
    setLoading(true);
    try {
      const res = await fetch("/api/ee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getMap",
          imageId
        })
      });

      if (!res.ok) throw new Error("Failed to get layer");
      const { urlFormat } = await res.json();

      const layerId = "ee-layer";
      const sourceId = "ee-source";

      // Remove existing layer if any
      if (map.current.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
      if (map.current.getSource(sourceId)) {
        map.current.removeSource(sourceId);
      }

      map.current.addSource(sourceId, {
        type: "raster",
        tiles: [urlFormat],
        tileSize: 256,
      });

      map.current.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        minzoom: 0,
        maxzoom: 22,
      });

      setActiveLayerId(imageId);

    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.main}>
      {/* Navbar */}
      <nav className={styles.navbar}>
        <div className={styles.brand}>GEE Sentinel Browser</div>
        <form className={styles.searchContainer} onSubmit={handleLocationSearch}>
          <input
            type="text"
            className={styles.searchBar}
            placeholder="Search location (e.g. Santiago, Chile)..."
            value={locationQuery}
            onChange={(e) => setLocationQuery(e.target.value)}
          />
          <span className={styles.searchIcon} onClick={handleLocationSearch}>🔍</span>
        </form>
        <div style={{ width: '20px' }}></div> {/* Spacer */}
      </nav>

      {/* Map Content */}
      <div className={styles.mapWrapper}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarContent}>
            <div className={styles.title}>Data Filters</div>
            <div className={styles.subtitle}>Sentinel-2 Imagery</div>

            <div className={styles.section}>
              <div className={styles.instruction}>
                {geometry ? "✅ Location selected" : "Click map to select location"}
              </div>

              <div style={{ marginTop: '10px' }}>
                <label className={styles.label}>Date Range</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="date"
                    className={styles.input}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                  <input
                    type="date"
                    className={styles.input}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              <label className={styles.label}>Max Clouds: {cloudCover}%</label>
              <input
                type="range"
                min="0" max="100"
                className={styles.range}
                value={cloudCover}
                onChange={(e) => setCloudCover(Number(e.target.value))}
              />
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button
              className={styles.button}
              onClick={handleSearch}
              disabled={loading}
            >
              {loading ? "Searching..." : "Find Images"}
            </button>

            <div className={styles.imageList}>
              {images.map((img) => (
                <div key={img.id} className={styles.imageCard}>
                  <div className={styles.cardHeader}>
                    <span className={styles.cardDate}>
                      {img.id === activeLayerId && <span className={styles.activeImageMarker}></span>}
                      {img.date}
                    </span>
                    <span className={styles.cardCloud}>{Math.round(img.cloud)}%</span>
                  </div>
                  <button
                    className={styles.buttonSecondary}
                    onClick={() => handleLayerAdd(img.id)}
                    style={{ width: '100%' }}
                  >
                    {img.id === activeLayerId ? "Active Layer" : "Visualize"}
                  </button>
                </div>
              ))}
              {images.length === 0 && !loading && (
                <p style={{ color: '#888', textAlign: 'center', fontSize: '0.85rem' }}>
                  No results yet. Try searching.
                </p>
              )}
            </div>
          </div>
        </div>

        <div ref={mapContainer} className={styles.mapContainer} />
      </div>
    </div>
  );
}
