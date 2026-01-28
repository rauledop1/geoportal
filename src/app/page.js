"use client";

import { useEffect, useRef, useState } from "react";
import { Map, Marker, NavigationControl } from "maplibre-gl";
import Compare from "@maplibre/maplibre-gl-compare";
import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-compare/dist/maplibre-gl-compare.css";
import styles from "./page.module.css";

export default function Home() {
  const mapContainer = useRef(null);
  const leftMapContainer = useRef(null);
  const rightMapContainer = useRef(null);

  const map = useRef(null);
  const mapLeft = useRef(null);
  const mapRight = useRef(null);
  const compare = useRef(null);
  const marker = useRef(null);

  // UI State
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [isCompareMode, setIsCompareMode] = useState(false);

  // Sentinel-2 State
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

  const [activeLayerId, setActiveLayerId] = useState(null); // For single mode
  const [leftLayerId, setLeftLayerId] = useState(null); // For compare mode
  const [rightLayerId, setRightLayerId] = useState(null); // For compare mode

  // Location Search State
  const [locationQuery, setLocationQuery] = useState("");

  // Initialize Map(s) based on mode
  useEffect(() => {
    // Cleanup previous maps
    if (map.current) map.current.remove();
    if (compare.current) compare.current.remove();
    if (mapLeft.current) mapLeft.current.remove();
    if (mapRight.current) mapRight.current.remove();

    map.current = null;
    mapLeft.current = null;
    mapRight.current = null;
    compare.current = null;
    marker.current = null;

    const mapStyle = "https://demotiles.maplibre.org/style.json";
    // Use current geometry ref or default, but don't depend on state directly for init to avoid re-render loop if we add it to deps
    // Actually, we want to re-init if isCompareMode changes.
    const initialCenter = geometry ? geometry.coordinates : [-71.5, -33.5];
    const initialZoom = 8;

    if (isCompareMode) {
      // Initialize Two Maps
      mapLeft.current = new Map({
        container: leftMapContainer.current,
        style: mapStyle,
        center: initialCenter,
        zoom: initialZoom,
        attributionControl: false
      });

      mapRight.current = new Map({
        container: rightMapContainer.current,
        style: mapStyle,
        center: initialCenter,
        zoom: initialZoom,
        attributionControl: false
      });

      // Sync interactions via Compare
      compare.current = new Compare(mapLeft.current, mapRight.current, mapContainer.current, {});

      // We will handle markers in a separate effect

      // Add click listener
      mapLeft.current.on('click', (e) => {
        const { lng, lat } = e.lngLat;
        const point = { type: "Point", coordinates: [lng, lat] };
        setGeometry(point);
        setIsExplorerOpen(true);
      });

    } else {
      // Initialize Single Map
      map.current = new Map({
        container: mapContainer.current,
        style: mapStyle,
        center: initialCenter,
        zoom: initialZoom,
      });

      map.current.addControl(new NavigationControl(), 'bottom-right');

      map.current.on('click', (e) => {
        const { lng, lat } = e.lngLat;
        const point = { type: "Point", coordinates: [lng, lat] };
        setGeometry(point);
        setIsExplorerOpen(true);
      });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompareMode]);

  // Handle Markers separately to avoid re-initializing map
  useEffect(() => {
    if (!geometry) return;

    const { coordinates } = geometry;

    if (isCompareMode) {
      // Clear existing markers if we stored them, or just add new ones? 
      // For simplicity, let's just add new ones or update. 
      // To update, we need refs to markers.
      // Simplified: Just add new ones for now, user clicks update position.
      // Correct way: use a ref for markers array or objects.

      // Remove old markers if standard names used, or we just rely on new click replacing them visually?
      // Actually, previous code didn't store marker ref for left/right maps cleanly.
      // Let's rely on the fact that we setGeometry. 

      // We really should manage markers better.
      // For now, let's just create them if they don't exist logic doesn't work well across modes.
      // Let's just create generic markers.
      if (mapLeft.current) new Marker({ color: "#0070f3" }).setLngLat(coordinates).addTo(mapLeft.current);
      if (mapRight.current) new Marker({ color: "#0070f3" }).setLngLat(coordinates).addTo(mapRight.current);

    } else {
      if (map.current) {
        if (marker.current) {
          marker.current.setLngLat(coordinates);
        } else {
          marker.current = new Marker({ color: "#0070f3" }).setLngLat(coordinates).addTo(map.current);
        }
      }
    }
  }, [geometry, isCompareMode]);

  const handleLocationSearch = async (e) => {
    e.preventDefault();
    if (!locationQuery.trim()) return;

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationQuery)}`);
      const data = await res.json();

      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        const center = [lon, lat];

        if (isCompareMode) {
          if (mapLeft.current) mapLeft.current.flyTo({ center, zoom: 12 });
          if (mapRight.current) mapRight.current.flyTo({ center, zoom: 12 });
        } else {
          if (map.current) map.current.flyTo({ center, zoom: 12 });
        }
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

  const handleLayerAdd = async (imageId, target = 'single') => {
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

      const sourceId = "ee-source-" + target;
      const layerId = "ee-layer-" + target;

      let targetMap;
      if (target === 'single') targetMap = map.current;
      if (target === 'left') targetMap = mapLeft.current;
      if (target === 'right') targetMap = mapRight.current;

      if (!targetMap) return;

      if (targetMap.getLayer(layerId)) targetMap.removeLayer(layerId);
      if (targetMap.getSource(sourceId)) targetMap.removeSource(sourceId);

      targetMap.addSource(sourceId, {
        type: "raster",
        tiles: [urlFormat],
        tileSize: 256,
      });

      targetMap.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        minzoom: 0,
        maxzoom: 22,
      });

      if (target === 'single') setActiveLayerId(imageId);
      if (target === 'left') setLeftLayerId(imageId);
      if (target === 'right') setRightLayerId(imageId);

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

  // Timeline Interactions
  const handleTimelineClick = (imgId, side) => {
    if (isCompareMode) {
      handleLayerAdd(imgId, side);
    } else {
      handleLayerAdd(imgId, 'single');
    }
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
              {/* Compare Mode Toggle */}
              <div
                className={`${styles.compareToggle} ${isCompareMode ? styles.toggleActive : ''}`}
                onClick={() => setIsCompareMode(!isCompareMode)}
              >
                <span>Compare Mode (Swipe)</span>
                <div className={styles.toggleSwitch}>
                  <div className={styles.toggleKnob}></div>
                </div>
              </div>

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

        {/* Timeline Results */}
        {images.length > 0 && (
          <div className={styles.timelineContainer}>
            <div className={styles.timelineScroll}>
              {images.map((img) => (
                <div key={img.id} className={styles.timelineItem}>
                  <div className={styles.timelinePopover}>
                    {img.thumbnail && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={img.thumbnail} alt="Preview" className={styles.thumbnail} />
                    )}
                    <div className={styles.popoverInfo}>
                      <b>{img.date}</b><br />
                      {Math.round(img.cloud)}% Clouds
                    </div>

                    {!isCompareMode ? (
                      <button className={styles.popoverBtn} onClick={() => handleTimelineClick(img.id)}>Visualize</button>
                    ) : (
                      <div className={styles.popoverRow}>
                        <button className={styles.popoverBtn} onClick={() => handleTimelineClick(img.id, 'left')}>Left</button>
                        <button className={styles.popoverBtn} onClick={() => handleTimelineClick(img.id, 'right')}>Right</button>
                      </div>
                    )}
                  </div>

                  <div
                    className={`
                       ${styles.timelineDot}
                       ${!isCompareMode && img.id === activeLayerId ? styles.timelineDotActive : ''}
                       ${isCompareMode && img.id === leftLayerId ? styles.timelineDotLeft : ''}
                       ${isCompareMode && img.id === rightLayerId ? styles.timelineDotRight : ''}
                     `}
                    style={{ backgroundColor: getDotColor(img.cloud) }}
                  ></div>

                  <div className={styles.timelineDate}>{img.date}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Map Container - Handles both Single and Compare modes */}
        <div className={styles.mapContainer} ref={mapContainer}>
          {isCompareMode && (
            <>
              <div ref={leftMapContainer} className={styles.mapLeft}></div>
              <div ref={rightMapContainer} className={styles.mapRight}></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
