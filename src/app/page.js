"use client";

import { useEffect, useRef, useState } from "react";
import { Map, Marker, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./page.module.css";

export default function Home() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);

  // UI State
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);

  // Sentinel-2 State
  // Default to last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);

  const [cloudCover, setCloudCover] = useState(60);
  const [sensor, setSensor] = useState("Sentinel-2");
  const [visOption, setVisOption] = useState("True Color (RGB)");
  const [geometry, setGeometry] = useState(null);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeLayerId, setActiveLayerId] = useState(null);

  // Location Search State
  const [locationQuery, setLocationQuery] = useState("");

  // Initialize Map
  useEffect(() => {
    if (map.current) return;

    map.current = new Map({
      container: mapContainer.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [-71.5, -33.5],
      zoom: 8,
    });

    map.current.addControl(new NavigationControl(), 'bottom-right');

    map.current.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      const point = { type: "Point", coordinates: [lng, lat] };
      setGeometry(point);

      if (marker.current) {
        marker.current.setLngLat([lng, lat]);
      } else {
        marker.current = new Marker({ color: "#0070f3" })
          .setLngLat([lng, lat])
          .addTo(map.current);
      }

      setIsExplorerOpen(true);
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
        map.current.flyTo({ center: [lon, lat], zoom: 12 });
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
          sensor,
          visOption,
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
          imageId,
          sensor,
          visOption
        })
      });

      if (!res.ok) throw new Error("Failed to get layer");
      const { urlFormat } = await res.json();

      const layerId = "ee-layer";
      const sourceId = "ee-source";

      if (map.current.getLayer(layerId)) map.current.removeLayer(layerId);
      if (map.current.getSource(sourceId)) map.current.removeSource(sourceId);

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
      alert("Error loading layer: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const getDotColor = (cloudPct) => {
    const val = Math.floor(255 - (cloudPct * 1.55));
    return `rgb(${val}, ${val}, ${val})`;
  };

  return (
    <div className={styles.main}>
      {/* Navbar */}
      <nav className={styles.navbar}>
        <div className={styles.brand}>
          <span>GEE Explorer</span>
          <button
            className={`${styles.explorerBtn} ${isExplorerOpen ? styles.explorerBtnActive : ''}`}
            onClick={() => setIsExplorerOpen(!isExplorerOpen)}
          >
            Explorador {isExplorerOpen ? '▲' : '▼'}
          </button>
        </div>

        <form className={styles.searchContainer} onSubmit={handleLocationSearch}>
          <input
            type="text"
            className={styles.searchBar}
            placeholder="Search location..."
            value={locationQuery}
            onChange={(e) => setLocationQuery(e.target.value)}
          />
          <span className={styles.searchIcon} onClick={handleLocationSearch}>🔍</span>
        </form>
        <div style={{ width: '20px' }}></div>
      </nav>

      <div className={styles.mapWrapper}>
        {/* Floating Sidebar (Explorer) */}
        <div className={`${styles.sidebar} ${isExplorerOpen ? styles.sidebarVisible : ''}`}>
          <div className={styles.sidebarContent}>
            <div className={styles.title}>Refine Search</div>
            <div className={styles.subtitle}>Configure filters below</div>

            <div className={styles.section}>
              <div className={styles.instruction}>
                {geometry ? "✅ Location selected" : "Click map to select location"}
              </div>

              <div style={{ marginTop: '10px' }}>
                <label className={styles.label}>Sensor</label>
                <select
                  className={styles.select}
                  value={sensor}
                  onChange={(e) => setSensor(e.target.value)}
                >
                  <option value="Sentinel-2">Sentinel-2 Level-2A</option>
                  <option value="Sentinel-2 Harmonized">Sentinel-2 Harmonized</option>
                  <option value="Landsat 9">Landsat 9 Level-2</option>
                </select>

                <label className={styles.label}>Visualization</label>
                <select
                  className={styles.select}
                  value={visOption}
                  onChange={(e) => setVisOption(e.target.value)}
                >
                  <option value="True Color (RGB)">True Color (RGB)</option>
                  <option value="False Color (Infrared)">False Color (Infrared)</option>
                  <option value="NDVI">NDVI (Vegetation)</option>
                  <option value="NDWI">NDWI (Water)</option>
                </select>

                <label className={styles.label}>Date Range</label>
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
              {loading ? "Searching..." : "Search Images"}
            </button>
          </div>
        </div>

        {/* Bottom Timeline Results */}
        {images.length > 0 && (
          <div className={styles.timelineContainer}>
            <div className={styles.timelineScroll}>
              {images.map((img) => (
                <div key={img.id} className={styles.timelineItem} onClick={() => handleLayerAdd(img.id)}>
                  <div className={styles.timelinePopover}>
                    {img.thumbnail && (
                      <img src={img.thumbnail} alt="Preview" className={styles.thumbnail} />
                    )}
                    <div className={styles.popoverInfo}>
                      <b>{img.date}</b><br />
                      {Math.round(img.cloud)}% Clouds
                    </div>
                    <button className={styles.popoverBtn}>Visualize</button>
                  </div>

                  <div
                    className={`${styles.timelineDot} ${img.id === activeLayerId ? styles.timelineDotActive : ''}`}
                    style={{ backgroundColor: getDotColor(img.cloud) }}
                  ></div>

                  <div className={styles.timelineDate}>{img.date}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={mapContainer} className={styles.mapContainer} />
      </div>
    </div>
  );
}
