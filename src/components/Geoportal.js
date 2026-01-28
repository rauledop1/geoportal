"use client";

import { useEffect, useRef, useState } from "react";
import { Map, Marker, NavigationControl } from "maplibre-gl";
import Compare from "@maplibre/maplibre-gl-compare";
import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-compare/dist/maplibre-gl-compare.css";
// Adjust import for CSS module since we moved file depth (src/app -> src/components)
import styles from "../app/page.module.css";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import shp from "shpjs";
import JSZip from "jszip";
import { kml } from "@tmcw/togeojson";
import bbox from "@turf/bbox";

export default function Geoportal() {
    const mapContainer = useRef(null);
    const leftMapContainer = useRef(null);
    const rightMapContainer = useRef(null);

    const map = useRef(null);
    const mapLeft = useRef(null);
    const mapRight = useRef(null);
    const compare = useRef(null);
    const marker = useRef(null);
    const draw = useRef(null);

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

            // Add click listener to Left Map (primary for interaction)
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

            // Add Draw Control
            const drawControl = new MapboxDraw({
                displayControlsDefault: false,
                controls: {
                    polygon: true,
                    trash: true
                }
            });
            map.current.addControl(drawControl, 'top-left');
            draw.current = drawControl;

            const updateGeometryFromDraw = () => {
                const data = drawControl.getAll();
                if (data.features.length > 0) {
                    setGeometry(data.features[0].geometry);
                } else {
                    setGeometry(null);
                }
            };

            map.current.on('draw.create', updateGeometryFromDraw);
            map.current.on('draw.delete', updateGeometryFromDraw);
            map.current.on('draw.update', updateGeometryFromDraw);

            map.current.on('click', (e) => {
                // If drawing is active, don't override with point click
                // Mapbox draw usually swallows clicks when drawing, but let's be safe
                // or just allow point selection if no polygon exists?
                // Simplest: If the draw control has no features, allow point click.
                // Or better: Allow point click always, but it changes geometry to Point.
                // But we must check if we clicked ON a drawn feature.

                // For now, keep existing logic but only if not drawing
                // We'll rely on user intent.
                // Let's preserve the existing point-click logic but maybe clear draw?

                const { lng, lat } = e.lngLat;
                // Check if we didn't click on a draw feature?
                // Actually if a feature exists, we might select it.
                // Let's just set Point if we are not in a mode.

                // Let's only set Point if draw is empty for now to avoid conflict
                if (drawControl.getAll().features.length === 0) {
                    const point = { type: "Point", coordinates: [lng, lat] };
                    setGeometry(point);
                    setIsExplorerOpen(true);
                }
            });
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isCompareMode]);

    // Reset Compare Mode if images < 2
    useEffect(() => {
        if (isCompareMode && images.length < 2) {
            setIsCompareMode(false);
        }
    }, [images, isCompareMode]);


    // Handle Markers and Draw Updates
    useEffect(() => {
        if (!geometry) {
            if (marker.current) {
                marker.current.remove();
                marker.current = null;
            }
            if (draw.current) {
                // Only clear if we really want to? 
                // If geometry is null, we should clear draw.
                // But this runs on geometry change. 
                // If update came FROM draw, we don't need to do anything.
                // But if it came from NULL, clear.
                const data = draw.current.getAll();
                if (data.features.length > 0 && !geometry) {
                    draw.current.deleteAll();
                }
            }
            return;
        }

        const { type, coordinates } = geometry;

        if (type === 'Point') {
            // Clear Draw if it has stuff?
            // If we switched to Point, clear polygons
            if (draw.current) {
                // If draw has features, clear them because we are now a Point
                if (draw.current.getAll().features.length > 0) {
                    draw.current.deleteAll();
                }
            }

            if (isCompareMode) {
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
        } else {
            // Polygon or other
            // Remove marker if exists
            if (marker.current) {
                marker.current.remove();
                marker.current = null;
            }

            // sync with draw
            if (!isCompareMode && draw.current) {
                // Check if draw already has this geometry (to avoid loop)
                const currentDrawData = draw.current.getAll();
                // A deep check is hard, but we can verify if we have 1 feature and it matches approx?
                // Or just clear and add if it's different.
                // To avoid flickering, check id?

                if (currentDrawData.features.length === 0) {
                    draw.current.add(geometry);
                } else {
                    // Check if same?
                    // If the geometry came from draw event, we don't re-add.
                    // The event handler calls setGeometry.
                    // But if geometry came from Upload, we MUST add.
                    // Simple heuristic: If coordinates differ significantly? 
                    // Or just brute force: delete all, add new.

                    // Issue: functionality loop if setGeometry triggers this, which triggers draw update...
                    // But draw update event doesn't trigger if we programmatically add?
                    // MapboxDraw fires 'draw.create' only on user interaction usually.
                    // Let's hope programmatically adding doesn't fire create/update.
                    // It actually usually doesn't.

                    // But wait, we need to know if we should replace.
                    // Let's just create a new feature from geometry and add it if empty.
                    // If not empty, assume it's in sync unless we just uploaded?
                    // We can't distinguish easily.
                    // Force replace is safest for Upload case.
                    // But for Drawing case, it might break interaction?
                    // NO, because if I am drawing, `geometry` updates. 
                    // Then this effect runs. 
                    // It deletes my drawing and re-adds it? That would stop the drawing session.
                    // That is BAD.

                    // How to detect if we are drawing?
                    // We can check `draw.current.getMode()`.
                    // If mode is 'draw_polygon', do not touch!
                    const mode = draw.current.getMode();
                    if (['draw_polygon', 'direct_select', 'simple_select'].includes(mode)) {
                        // If we are selecting/editing, assume we are in sync or user is busy
                        // UNLESS the geometry changed radically (file upload).
                        // This is tricky.
                        // Let's rely on checking if the geometry matches deeply?
                        // Or just rely on the fact that file upload happens while mode is likely simple_select or static.
                    }

                    // Better approach:
                    // Only add to draw if draw is EMPTY.
                    if (currentDrawData.features.length === 0) {
                        draw.current.add(geometry);
                    } else {
                        // If draw is not empty, assume it's the source of truth,
                        // UNLESS we explicitly want to overwrite (File Upload).
                        // We can add a flag or just assume File Upload clears draw first?
                        // In handleFileUpload, I can clear draw.
                    }
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

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            let geojson = null;
            const name = file.name.toLowerCase();

            if (name.endsWith('.geojson') || name.endsWith('.json')) {
                const text = await file.text();
                geojson = JSON.parse(text);
            } else if (name.endsWith('.kml')) {
                const text = await file.text();
                const parser = new DOMParser();
                const kmlDoc = parser.parseFromString(text, "text/xml");
                geojson = kml(kmlDoc);
            } else if (name.endsWith('.kmz')) {
                const arrayBuffer = await file.arrayBuffer();
                const zip = await JSZip.loadAsync(arrayBuffer);
                const kmlFile = Object.keys(zip.files).find(n => n.endsWith('.kml'));
                if (kmlFile) {
                    const kmlText = await zip.file(kmlFile).async("string");
                    const parser = new DOMParser();
                    const kmlDoc = parser.parseFromString(kmlText, "text/xml");
                    geojson = kml(kmlDoc);
                }
            } else if (name.endsWith('.zip')) {
                const arrayBuffer = await file.arrayBuffer();
                geojson = await shp(arrayBuffer);
            }

            if (geojson) {
                // Determine Geometry
                let geometryToSet = null;
                // If FeatureCollection, extract first appropriate geometry
                if (geojson.type === 'FeatureCollection' && geojson.features.length > 0) {
                    // Prefer Polygon
                    const poly = geojson.features.find(f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
                    if (poly) geometryToSet = poly.geometry;
                    else geometryToSet = geojson.features[0].geometry;
                } else if (geojson.type === 'Feature') {
                    geometryToSet = geojson.geometry;
                } else if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
                    geometryToSet = geojson;
                }

                if (geometryToSet) {
                    // Update Draw:
                    // Force clear and add new to ensure it renders
                    if (draw.current) {
                        draw.current.deleteAll();
                        draw.current.add(geometryToSet);
                    }

                    setGeometry(geometryToSet);

                    // Zoom to BBox
                    try {
                        const box = bbox(geojson);
                        if (map.current) {
                            map.current.fitBounds(box, { padding: 50 });
                        }
                    } catch (e) {
                        console.error("Fit bounds error", e);
                    }
                } else {
                    alert("No valid geometry found in file");
                }
            }
        } catch (err) {
            console.error(err);
            alert("Error parsing file");
        }
    };

    // ... handleLayerAdd ...

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

            console.log("Adding Layer:", { imageId, target, urlFormat });

            const sourceId = "ee-source-" + target;
            const layerId = "ee-layer-" + target;

            let targetMap;
            if (target === 'single') targetMap = map.current;
            if (target === 'left') targetMap = mapLeft.current;
            if (target === 'right') targetMap = mapRight.current;

            if (!targetMap) {
                console.error("Target map not found:", target);
                return;
            }

            if (targetMap.getLayer(layerId)) targetMap.removeLayer(layerId);
            if (targetMap.getSource(sourceId)) targetMap.removeSource(sourceId);

            targetMap.addSource(sourceId, {
                type: "raster",
                tiles: [urlFormat],
                tileSize: 256,
            });

            // Find the first draw layer to place the raster layer below it
            const layers = targetMap.getStyle().layers;
            const firstDrawLayer = layers.find(l => l.id.startsWith('gl-draw-'));
            const beforeId = firstDrawLayer ? firstDrawLayer.id : undefined;

            targetMap.addLayer({
                id: layerId,
                type: "raster",
                source: sourceId,
                minzoom: 0,
                maxzoom: 22,
            }, beforeId);

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
                            {/* Compare Mode Toggle - Only consistent if we have images */}
                            {images.length >= 2 && (
                                <div
                                    className={`${styles.compareToggle} ${isCompareMode ? styles.toggleActive : ''}`}
                                    onClick={() => setIsCompareMode(!isCompareMode)}
                                >
                                    <span>Compare Mode (Swipe)</span>
                                    <div className={styles.toggleSwitch}>
                                        <div className={styles.toggleKnob}></div>
                                    </div>
                                </div>
                            )}

                            <div className={styles.section}>
                                <label className={styles.label}>Upload Geometry</label>
                                <input
                                    type="file"
                                    accept=".geojson,.json,.kml,.kmz,.zip"
                                    onChange={handleFileUpload}
                                    className={styles.input}
                                />
                                <small style={{ color: '#777', fontSize: '0.75rem' }}>
                                    Supports: GeoJSON, KML, KMZ, Shapefile (zip)
                                </small>
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
                                        {/* Thumbnail Removed */}
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
