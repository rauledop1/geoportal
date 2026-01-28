"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import maplibregl, { Map, NavigationControl, Marker } from "maplibre-gl";
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
import * as turf from "@turf/turf";
import {
    SnapPolygonMode,
    SnapLineMode,
    SnapPointMode,
    SnapDirectSelect
} from 'mapbox-gl-draw-snap-mode';

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
    const [activeTab, setActiveTab] = useState('search'); // search, upload, draw

    // Sentinel-2 State
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);

    // Window width for responsive timeline
    const [windowWidth, setWindowWidth] = useState(1000); // Default

    useEffect(() => {
        setWindowWidth(window.innerWidth);
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const [drawMode, setDrawMode] = useState('simple'); // simple, cut
    const [snappingEnabled, setSnappingEnabled] = useState(true);
    const [snapPixelDistance, setSnapPixelDistance] = useState(15);
    const [eraseOverlap, setEraseOverlap] = useState(false); // Autocomplete / Erase Overlap
    const drawModeRef = useRef(drawMode);
    useEffect(() => {
        drawModeRef.current = drawMode;
    }, [drawMode]);

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
        draw.current = null; // Prevent stale access to draw control

        const mapStyle = "https://demotiles.maplibre.org/style.json";
        const initialCenter = geometry ? geometry.coordinates : [-71.5, -33.5];
        const initialZoom = 8;

        if (isCompareMode) {
            // Use setTimeout to allow DOM to settle
            const timer = setTimeout(() => {
                try {
                    // Check if containers are ready
                    if (!leftMapContainer.current || !rightMapContainer.current || !mapContainer.current) return;

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
                    // Ensure mapContainer matches the wrapper for both
                    compare.current = new Compare(mapLeft.current, mapRight.current, mapContainer.current, {});

                    // Restore Active Layer to Left Map if exists
                    if (mapLeft.current) {
                        mapLeft.current.once('load', () => {
                            if (activeLayerId) {
                                console.log("Restoring active layer to Left Map:", activeLayerId);
                                setLeftLayerId(activeLayerId); // SYNC STATE
                                handleLayerAdd(activeLayerId, 'left');
                            }
                        });

                        // Add click listener to Left Map (primary for interaction)
                        mapLeft.current.on('click', (e) => {
                            const { lng, lat } = e.lngLat;
                            const point = { type: "Point", coordinates: [lng, lat] };
                            setGeometry(point);
                            setIsExplorerOpen(true);
                        });
                    }
                } catch (err) {
                    console.error("Critical Swipe Mode Initialization Error:", err);
                }
            }, 0);

            return () => {
                clearTimeout(timer); // Cleanup timer
                if (compare.current) compare.current.remove();
                if (mapLeft.current) mapLeft.current.remove();
                if (mapRight.current) mapRight.current.remove();
                mapLeft.current = null;
                mapRight.current = null;
                compare.current = null;
            };

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
                userProperties: true,
                modes: {
                    ...MapboxDraw.modes,
                    draw_polygon: SnapPolygonMode,
                    draw_line_string: SnapLineMode,
                    draw_point: SnapPointMode,
                    direct_select: SnapDirectSelect
                },
                snap: true,
                snapOptions: {
                    snapPx: snapPixelDistance,
                    snapToMidPoints: true,
                    snapVertexPriorityDistance: 0.0025,
                },
                // Autocomplete / Overlap configuration
                // SnapModeOptions allows 'overlap' property directly on options passed to modes?
                // The library documentation says 'overlap' is a top level option for SnapModeOptions.
                // But MapboxDraw initializes modes with options?
                // Actually, we need to pass these options when modes are setup or via drawControl.
                // The library might read from drawControl.options?
                // Checking usage: The library reads `opts.overlap` in `SnapPolygonMode`.
                // We'll attach it to the draw control options or try to pass it.
                // The standard MapboxDraw way is `userProperties`. 
                // However, mapbox-gl-draw-snap-mode reads config?
                // Let's assume we can update it dynamically like we do for `snap`.
                snapModeOptions: { // Helper checks this?
                    overlap: true // Default
                },
                controls: {
                    polygon: true,
                    trash: true
                },
                // Styles for custom node visibility
                styles: [
                    // ACTIVE (being drawn)
                    // line stroke
                    {
                        "id": "gl-draw-line",
                        "type": "line",
                        "filter": ["all", ["==", "$type", "LineString"], ["!=", "mode", "static"]],
                        "layout": {
                            "line-cap": "round",
                            "line-join": "round"
                        },
                        "paint": {
                            "line-color": "#D20C0C",
                            "line-dasharray": [0.2, 2],
                            "line-width": 2
                        }
                    },
                    // polygon fill
                    {
                        "id": "gl-draw-polygon-fill",
                        "type": "fill",
                        "filter": ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
                        "paint": {
                            "fill-color": "#D20C0C",
                            "fill-outline-color": "#D20C0C",
                            "fill-opacity": 0.1
                        }
                    },
                    // polygon mid points
                    {
                        "id": "gl-draw-polygon-midpoint",
                        "type": "circle",
                        "filter": ["all",
                            ["==", "$type", "Point"],
                            ["==", "meta", "midpoint"]],
                        "paint": {
                            "circle-radius": 5, // Larger
                            "circle-color": "#fbb03b"
                        }
                    },
                    // polygon outline stroke
                    // This doesn't style the first edge of the polygon, which uses the line stroke.
                    {
                        "id": "gl-draw-polygon-stroke-active",
                        "type": "line",
                        "filter": ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
                        "layout": {
                            "line-cap": "round",
                            "line-join": "round"
                        },
                        "paint": {
                            "line-color": "#D20C0C",
                            "line-dasharray": [0.2, 2],
                            "line-width": 2
                        }
                    },
                    // vertex point halos
                    {
                        "id": "gl-draw-polygon-and-line-vertex-halo-active",
                        "type": "circle",
                        "filter": ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "mode", "static"]],
                        "paint": {
                            "circle-radius": 8, // Larger halo
                            "circle-color": "#FFF"
                        }
                    },
                    // vertex points
                    {
                        "id": "gl-draw-polygon-and-line-vertex-active",
                        "type": "circle",
                        "filter": ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "mode", "static"]],
                        "paint": {
                            "circle-radius": 6, // Larger vertex
                            "circle-color": "#D20C0C",
                        }
                    },
                    // INACTIVE (static)
                    {
                        "id": "gl-draw-polygon-fill-static",
                        "type": "fill",
                        "filter": ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"]],
                        "paint": {
                            "fill-color": "#000",
                            "fill-outline-color": "#000",
                            "fill-opacity": 0.1
                        }
                    },
                    {
                        "id": "gl-draw-polygon-stroke-static",
                        "type": "line",
                        "filter": ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"]],
                        "layout": {
                            "line-cap": "round",
                            "line-join": "round"
                        },
                        "paint": {
                            "line-color": "#000",
                            "line-width": 3
                        }
                    }
                ]
            });
            map.current.addControl(drawControl, 'top-left');
            draw.current = drawControl;

            const updateGeometryFromDraw = (e) => {
                const data = drawControl.getAll();
                const features = data.features;

                // AUTOCOMPLETE / ERASE OVERLAP LOGIC
                // Check if we need to clip the *newly created/updated* feature against others.
                if (eraseOverlap && (e.type === 'draw.create' || e.type === 'draw.update')) {
                    const modifiedFeatures = e.features; // Array of features being created/updated

                    modifiedFeatures.forEach(modFeature => {
                        if (modFeature.geometry.type === 'Polygon' || modFeature.geometry.type === 'MultiPolygon') {
                            // Find other polygons
                            const others = features.filter(f =>
                                f.id !== modFeature.id &&
                                (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
                            );

                            if (others.length > 0) {
                                // Union others to create a mask? Or iterate subtract?
                                // Iterative subtract is safer but slower?
                                // Let's try to difference against each overlapping one.

                                let currentGeometry = modFeature;
                                let clipped = false;

                                // Optimization: Filter strictly overlapping?
                                // Turf difference is fast enough for few polygons.

                                for (const other of others) {
                                    try {
                                        const diff = turf.difference(currentGeometry, other);
                                        if (diff) {
                                            currentGeometry = diff;
                                            clipped = true;
                                        } else {
                                            // Fully erased?
                                            currentGeometry = null;
                                            clipped = true;
                                            break;
                                        }
                                    } catch (err) {
                                        console.warn("Clipping error", err);
                                    }
                                }

                                if (clipped) {
                                    if (currentGeometry) {
                                        // Update the feature in draw
                                        // We must preserve ID and properties
                                        currentGeometry.id = modFeature.id;
                                        currentGeometry.properties = modFeature.properties;
                                        drawControl.add(currentGeometry);

                                        // Update internal var for 'lastFeature' logic below if needed
                                        // (Assuming drawControl.getAll() will reflect this in next tick, but for now we proceed)
                                    } else {
                                        // Fully erased, remove it
                                        drawControl.delete(modFeature.id);
                                    }
                                }
                            }
                        }
                    });

                    // Refresh data after modification
                    // data = drawControl.getAll(); // const assignment, can't
                }

                const updatedData = drawControl.getAll(); // Refresh

                // If in CUT mode
                if (drawModeRef.current === 'cut' && e.type === 'draw.create') {
                    const cutter = e.features[0];
                    if (cutter && cutter.geometry.type === 'LineString') {
                        try {
                            const allData = drawControl.getAll();
                            // Target polygons to be cut (exclude the cutter itself)
                            const targets = allData.features.filter(f =>
                                f.id !== cutter.id &&
                                (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
                            );

                            // Buffer the cutter line (minimal buffer to avoid gap)
                            // 1mm = 0.000001 km
                            const cutterPoly = turf.buffer(cutter, 0.000001, { units: 'kilometers' });

                            const newFeatures = [];
                            const idsToDelete = [cutter.id]; // Always remove the cutter line

                            let cutPerformed = false;

                            targets.forEach(target => {
                                const diff = turf.difference(target, cutterPoly);

                                if (diff) {
                                    idsToDelete.push(target.id);

                                    // If result is MultiPolygon, split it into separate features
                                    if (diff.geometry.type === 'MultiPolygon') {
                                        diff.geometry.coordinates.forEach(coords => {
                                            newFeatures.push({
                                                type: 'Feature',
                                                properties: target.properties,
                                                geometry: {
                                                    type: 'Polygon',
                                                    coordinates: coords
                                                }
                                            });
                                        });
                                    } else {
                                        // Keep as simple Polygon
                                        newFeatures.push(diff);
                                    }
                                    cutPerformed = true;
                                } else {
                                    // If diff is null (e.g. fully erased), we don't add anything back
                                }
                            });

                            if (cutPerformed) {
                                drawControl.delete(idsToDelete);
                                if (newFeatures.length > 0) {
                                    drawControl.add({ type: 'FeatureCollection', features: newFeatures });
                                    // Update state with the first valid geometry so something is selected
                                    setGeometry(newFeatures[0].geometry);
                                } else {
                                    setGeometry(null);
                                }
                            }
                        } catch (err) {
                            console.error("Cut error", err);
                            alert("Cut failed: " + err.message);
                        }

                        // Reset to simple select mode to execute the cut visual update
                        // (Wait, 'simple' is our internal state, mapbox-gl-draw mode should also be reset?)
                        // "draw_line_string" was active. We should switch to "simple_select"
                        setTimeout(() => {
                            drawControl.changeMode('simple_select');
                        }, 10);

                        setDrawMode('simple');
                        return;
                    }
                }

                // Normal update
                if (data.features.length > 0) {
                    // Set geometry to the last feature added (assumed most relevant for search)
                    // Or stick to 0? If I draw a second one, it's at end of array?
                    // MapboxDraw usually appends?
                    // Let's use the LAST feature as the "active" geometry for search.
                    const lastFeature = data.features[data.features.length - 1];
                    setGeometry(lastFeature.geometry);
                } else {
                    setGeometry(null);
                }
            };

            map.current.on('draw.create', updateGeometryFromDraw);
            map.current.on('draw.delete', updateGeometryFromDraw);
            map.current.on('draw.update', updateGeometryFromDraw);

            // Initial snap state
            drawControl.options.snap = snappingEnabled;

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

    // Toggle Snapping & Update Distance
    useEffect(() => {
        if (draw.current) {
            draw.current.options.snap = snappingEnabled;
            if (draw.current.options.snapOptions) {
                draw.current.options.snapOptions.snapPx = snapPixelDistance;
            }
        }
    }, [snappingEnabled, snapPixelDistance]);

    // Toggle Autocomplete / Overlap
    // To implement "Erase Overlap" (Autocomplete), we set overlap: false
    useEffect(() => {
        if (draw.current) {
            // We need to pass this to the mode. 
            // mapbox-gl-draw-snap-mode unfortunately reads options mainly at setup for some checks, 
            // but let's try to set it if it's accessible.
            // If not, we might need to re-initialize draw or find where it's stored.
            // Looking at the lib, it often checks `this.options.overlap`. 
            // `this` contexts in modes are derived from MapboxDraw options?
            // Actually, custom modes often don't get re-configured easily.
            // But let's try injecting it into options.
            draw.current.options.overlap = !eraseOverlap;
        }
    }, [eraseOverlap]);

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
            const resultImages = data.images || [];
            setImages(resultImages);

            setImages(resultImages);

            // Auto-select: Only if NO layer is currently active.
            // This prevents overriding user selection on subsequent clicks/searches if they are exploring results.
            // User requirement: "only the first click call auto the scene"
            if (activeLayerId === null && resultImages.length > 0) {
                handleLayerAdd(resultImages[0].id, 'single');
            }

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
                        const box = turf.bbox(geojson);
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

    // Timeline Aggregation Logic
    const groupedImages = useMemo(() => {
        if (!images || images.length === 0) return [];

        // Density Calculation
        // Available width approx 75% of screen
        const availableWidth = windowWidth * 0.75;
        const itemWidth = 60; // Approximate width of a timeline item (dot + margin)
        const maxItems = Math.floor(availableWidth / itemWidth);

        // Counts
        const totalImages = images.length;

        // Calculate distinct months and years to check counts
        const uniqueMonths = new Set(images.map(img => img.date.substring(0, 7))).size;
        const uniqueYears = new Set(images.map(img => img.date.substring(0, 4))).size;

        // Determine Mode
        let mode = 'day';

        if (totalImages <= maxItems) {
            mode = 'day';
        } else if (uniqueMonths <= maxItems) {
            mode = 'month';
        } else if (uniqueYears <= maxItems) {
            mode = 'year';
        } else {
            mode = 'lustrum';
        }

        console.log(`Timeline Density: Width ${windowWidth}px -> Max Items ${maxItems}. Counts: Img ${totalImages}, Mo ${uniqueMonths}, Yr ${uniqueYears} -> Mode: ${mode}`);

        if (mode === 'day') return images;

        const groups = {};

        images.forEach(img => {
            const date = new Date(img.date);
            const year = date.getFullYear();
            let key;

            if (mode === 'lustrum') {
                // block of 5 years: 2020-2024, 2025-2029
                const lustrumStart = Math.floor(year / 5) * 5;
                const lustrumEnd = lustrumStart + 4;
                key = `${lustrumStart}-${lustrumEnd}`;
            }
            else if (mode === 'year') {
                key = year.toString();
            }
            else if (mode === 'month') {
                key = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            }
            else {
                key = img.id; // Fallback
            }

            if (!groups[key]) {
                groups[key] = {
                    id: key, // Use key as ID for group
                    date: key, // Display label
                    cloud: 0,
                    count: 0,
                    images: []
                };
            }
            groups[key].cloud += img.cloud;
            groups[key].count++;
            groups[key].images.push(img);
        });

        return Object.values(groups).map(g => ({
            ...g,
            cloud: g.cloud / g.count, // Average cloud
            isGroup: true
        })).sort((a, b) => a.date.localeCompare(b.date)); // Ensure sorted

    }, [images, windowWidth]); // Re-run when images change or window resizes


    // Auto-Update Effects

    // 1. On Vis Change: Update active layer if exists
    useEffect(() => {
        if (!loading && activeLayerId && !isCompareMode) {
            console.log("Auto-updating layer viz...");
            handleLayerAdd(activeLayerId, 'single');
        }
    }, [visOption]);

    // 2. On Sensor Change Or Geometry Change: Re-run search if geometry exists
    useEffect(() => {
        // Prevent initial run or redundant runs?
        // If geometry is set and we are not already loading...
        // Also check if geometry is valid (not null)
        if (geometry && !loading) {
            console.log("Auto-updating search...");
            handleSearch();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sensor, geometry]);


    // Timeline Interactions
    const handleTimelineClick = (item, side) => {
        let imgId = item.id;

        // If group, pick select best image (lowest cloud) ?? or first?
        // Let's pick lowest cloud
        if (item.isGroup) {
            const best = item.images.reduce((prev, curr) => prev.cloud < curr.cloud ? prev : curr);
            imgId = best.id;
            console.log(`Auto-selected image from group ${item.date}:`, best);
        }

        if (isCompareMode) {
            handleLayerAdd(imgId, side);
        } else {
            handleLayerAdd(imgId, 'single');
        }
    };

    {/* Draw Mode Handlers */ }
    const handleDrawPolygon = () => {
        setDrawMode('simple');
        setEraseOverlap(false); // Standard draw, allow overlap
        if (draw.current) {
            // draw.current.deleteAll(); // Removed to allow multiple polygons
            draw.current.changeMode('draw_polygon');
        }
    };

    const handleCutPolygon = () => {
        if (!geometry) {
            alert("Draw a base polygon first!");
            return;
        }
        setDrawMode('cut');
        if (draw.current) {
            // Start drawing the cutter
            draw.current.changeMode('draw_line_string');
        }
    };

    const handleDrawAutocomplete = () => {
        setDrawMode('simple');
        setEraseOverlap(true); // Enable erase overlap
        if (draw.current) {
            draw.current.changeMode('draw_polygon');
        }
    };

    const handleDeleteSelected = () => {
        if (draw.current) {
            draw.current.trash();
            // Manually trigger update since trash doesn't always fire update immediately if we rely on it
            const data = draw.current.getAll();
            if (data.features.length === 0) setGeometry(null);
            else setGeometry(data.features[0].geometry);
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
                        {/* Tabs */}
                        <div className={styles.tabNav}>
                            <button
                                className={`${styles.tabBtn} ${activeTab === 'search' ? styles.tabBtnActive : ''}`}
                                onClick={() => setActiveTab('search')}
                            >
                                Search
                            </button>
                            <button
                                className={`${styles.tabBtn} ${activeTab === 'upload' ? styles.tabBtnActive : ''}`}
                                onClick={() => setActiveTab('upload')}
                            >
                                Upload
                            </button>
                            <button
                                className={`${styles.tabBtn} ${activeTab === 'draw' ? styles.tabBtnActive : ''}`}
                                onClick={() => setActiveTab('draw')}
                            >
                                Draw
                            </button>
                        </div>

                        {/* SEARCH TAB */}
                        {activeTab === 'search' && (
                            <>
                                <div className={styles.title}>Refine Search</div>
                                <div className={styles.subtitle}>Configure filters below</div>

                                <div className={styles.section}>
                                    {/* Compare Mode Toggle */}
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

                                    <div className={styles.instruction}>
                                        {geometry ? "✅ Location selected" : "Click map or upload/draw geometry"}
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
                            </>
                        )}

                        {/* UPLOAD TAB */}
                        {activeTab === 'upload' && (
                            <>
                                <div className={styles.title}>Upload Geometry</div>
                                <div className={styles.subtitle}>Drag & drop or click to upload</div>

                                <div className={styles.section}>
                                    <div className={styles.dropZone}>
                                        <span>📂 Click or Drag File Here</span>
                                        <br />
                                        <small>(GeoJSON, KML, KMZ, Shapefile .zip)</small>
                                        <input
                                            type="file"
                                            accept=".geojson,.json,.kml,.kmz,.zip"
                                            onChange={handleFileUpload}
                                        />
                                    </div>

                                    <div className={styles.instruction}>
                                        {geometry ? "✅ Geometry loaded" : "No geometry loaded"}
                                    </div>
                                </div>
                            </>
                        )}

                        {/* DRAW TAB */}
                        {activeTab === 'draw' && (
                            <>
                                <div className={styles.title}>Draw Geometry</div>
                                <div className={styles.subtitle}>Use tools to create polygons</div>

                                <div className={styles.section}>
                                    <div className={styles.toolBtn} onClick={handleDrawPolygon}>
                                        <span className={styles.toolIcon}>⬠</span>
                                        <span>Draw Polygon</span>
                                    </div>
                                    <div className={`${styles.toolBtn} ${drawMode === 'cut' ? styles.toolBtnActive : ''}`} onClick={handleCutPolygon}>
                                        <span className={styles.toolIcon}>✂️</span>
                                        <span>Cut Polygon (Draw Line)</span>
                                    </div>
                                    <div className={styles.toolBtn} onClick={handleDrawAutocomplete}>
                                        <span className={styles.toolIcon}>🧩</span>
                                        <span>Draw w/ Autocomplete</span>
                                    </div>
                                    <div className={styles.toolBtn} onClick={handleDeleteSelected}>
                                        <span className={styles.toolIcon}>🗑️</span>
                                        <span>Delete Selected</span>
                                    </div>

                                    <div className={styles.checkboxContainer} style={{ marginTop: '10px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={snappingEnabled}
                                                onChange={(e) => setSnappingEnabled(e.target.checked)}
                                            />
                                            <span>Energy Snapping</span>
                                        </label>
                                        {snappingEnabled && (
                                            <div style={{ marginLeft: '24px', marginTop: '4px' }}>
                                                <small>Dist (px): </small>
                                                <input
                                                    type="number"
                                                    value={snapPixelDistance}
                                                    onChange={(e) => setSnapPixelDistance(Number(e.target.value))}
                                                    style={{ width: '50px', marginLeft: '5px' }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <div className={styles.checkboxContainer} style={{ marginTop: '5px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={eraseOverlap}
                                                onChange={(e) => setEraseOverlap(e.target.checked)}
                                            />
                                            <span>Autocomplete (Erase Overlap)</span>
                                        </label>
                                    </div>


                                    <div className={styles.instruction}>
                                        <small>
                                            • Click &quot;Draw Polygon&quot; to start.<br />
                                            • Click points on map.<br />
                                            • Double click to finish.<br />
                                            • Click a polygon to select it for editing or deletion.
                                        </small>
                                    </div>
                                </div>
                            </>
                        )}

                    </div>
                </div>

                {/* Timeline Results */}
                {groupedImages.length > 0 && (
                    <div className={styles.timelineContainer}>
                        <div className={styles.timelineScroll}>
                            {groupedImages.map((img) => (
                                <div key={img.id} className={styles.timelineItem}>
                                    <div className={styles.timelinePopover}>
                                        {/* Thumbnail Removed */}
                                        <div className={styles.popoverInfo}>
                                            <b>{img.date}</b><br />
                                            {Math.round(img.cloud)}% Clouds
                                            {img.isGroup && <><br /><small>({img.count} items)</small></>}
                                        </div>

                                        {!isCompareMode ? (
                                            <button className={styles.popoverBtn} onClick={() => handleTimelineClick(img, 'single')}>Visualize</button>
                                        ) : (
                                            <div className={styles.popoverRow}>
                                                <button className={styles.popoverBtn} onClick={() => handleTimelineClick(img, 'left')}>Left</button>
                                                <button className={styles.popoverBtn} onClick={() => handleTimelineClick(img, 'right')}>Right</button>
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
