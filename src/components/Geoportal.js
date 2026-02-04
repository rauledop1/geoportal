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
    const viewState = useRef({ center: [-71.5, -33.5], zoom: 8 });

    // UI State
    const [isExplorerOpen, setIsExplorerOpen] = useState(false);
    const [isCompareMode, setIsCompareMode] = useState(false);
    const [activeTab, setActiveTab] = useState('search'); // search, upload, draw, monitor
    const [showTimeline, setShowTimeline] = useState(true);

    // Monitor State
    const [comunas, setComunas] = useState([]);
    const [selectedComuna, setSelectedComuna] = useState('');
    const [monitorData, setMonitorData] = useState([]);
    const [baselineYear, setBaselineYear] = useState('');
    const [analysisResult, setAnalysisResult] = useState(null);
    const [selectedMonitorImage, setSelectedMonitorImage] = useState(null);

    // Geomorphology State
    const [selectedGeomComuna, setSelectedGeomComuna] = useState('');
    const [geomType, setGeomType] = useState('Slope'); // Slope, Aspect, Hillshade, DEM
    const [geomResult, setGeomResult] = useState(null);


    // Initial Load of Comunas (Shared)
    useEffect(() => {
        fetch("/api/ee", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "get-comunas" })
        })
            .then(res => res.json())
            .then(data => {
                if (data.comunas) setComunas(data.comunas);
            })
            .catch(err => console.error("Error loading comunas", err));
    }, []);

    const handleMonitorSearch = async () => {
        if (!selectedComuna) return;
        setLoading(true);
        setMonitorData([]);
        setError(null);
        try {
            const res = await fetch("/api/ee", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "monitor-search",
                    comuna: selectedComuna,
                    startDate,
                    endDate
                })
            });
            const data = await res.json();
            if (data.data) {
                // Sort by date just in case
                const sorted = data.data.sort((a, b) => new Date(a.date) - new Date(b.date));
                setMonitorData(sorted);
            }
        } catch (e) {
            setError("Monitor search failed: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleMonitorAnalysis = async () => {
        if (!selectedMonitorImage || !selectedComuna) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/ee", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "monitor-analysis",
                    comuna: selectedComuna,
                    imageId: selectedMonitorImage.id,
                    baselineYear: baselineYear || null
                })
            });
            const data = await res.json();

            // Add layers to Map
            // Clear existing logic if needed?
            // "When monitor-analysis returns, clear previous layers."
            // We can reuse handleLayerAdd logic OR direct map manipulation.

            // For simplicity, let's treat these as special layers.
            // But we need to handle "Swipe Mode" awareness. 
            // If in Swipe Mode, maybe show Target Left, Diff Right? 
            // Or just single map for Monitor?
            // Let's force Single Mode for now or respect current mode.

            if (data.bounds) {
                // Bounds from EE are GeoJSON Polygon.
                // We need to find the extent (bbox) for fitBounds.
                // Quick bbox from polygon coordinates.
                const coords = data.bounds.coordinates[0]; // Ring 0
                const lngs = coords.map(c => c[0]);
                const lats = coords.map(c => c[1]);
                const minLng = Math.min(...lngs);
                const maxLng = Math.max(...lngs);
                const minLat = Math.min(...lats);
                const maxLat = Math.max(...lats);

                map.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 20 });
            }

            setAnalysisResult(data);

            if (map.current) {
                // Remove old layers
                if (map.current.getLayer('monitor-target')) map.current.removeLayer('monitor-target');
                if (map.current.getSource('monitor-target')) map.current.removeSource('monitor-target');
                if (map.current.getLayer('monitor-diff')) map.current.removeLayer('monitor-diff');
                if (map.current.getSource('monitor-diff')) map.current.removeSource('monitor-diff');

                // Add Target (RGB)
                map.current.addSource('monitor-target', {
                    type: 'raster',
                    tiles: [data.targetMap],
                    tileSize: 256
                });
                map.current.addLayer({
                    id: 'monitor-target',
                    type: 'raster',
                    source: 'monitor-target'
                });

                // Add Diff
                map.current.addSource('monitor-diff', {
                    type: 'raster',
                    tiles: [data.diffMap],
                    tileSize: 256
                });
                map.current.addLayer({
                    id: 'monitor-diff',
                    type: 'raster',
                    source: 'monitor-diff'
                });
            }

        } catch (e) {
            setError("Analysis failed: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleGeomAnalysis = async () => {
        if (!selectedGeomComuna) return;
        setLoading(true);
        setError(null);
        setGeomResult(null);

        try {
            const res = await fetch("/api/ee", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "geom-analysis",
                    comuna: selectedGeomComuna,
                    type: geomType
                })
            });
            const data = await res.json();

            setGeomResult(data);

            if (map.current) {
                // Clear Monitor Layers if any
                if (map.current.getLayer('monitor-target')) map.current.removeLayer('monitor-target');
                if (map.current.getSource('monitor-target')) map.current.removeSource('monitor-target');
                if (map.current.getLayer('monitor-diff')) map.current.removeLayer('monitor-diff');
                if (map.current.getSource('monitor-diff')) map.current.removeSource('monitor-diff');

                // Clear Geom Layers
                if (map.current.getLayer('geom-layer')) map.current.removeLayer('geom-layer');
                if (map.current.getSource('geom-layer')) map.current.removeSource('geom-layer');
                if (map.current.getLayer('geom-border')) map.current.removeLayer('geom-border');
                if (map.current.getSource('geom-border')) map.current.removeSource('geom-border');

                // Add Geom Layer
                map.current.addSource('geom-layer', {
                    type: 'raster',
                    tiles: [data.mapUrl],
                    tileSize: 256
                });
                map.current.addLayer({
                    id: 'geom-layer',
                    type: 'raster',
                    source: 'geom-layer'
                });

                // Add Border (Optional, tile based)
                map.current.addSource('geom-border', {
                    type: 'raster',
                    tiles: [data.borderUrl],
                    tileSize: 256
                });
                map.current.addLayer({
                    id: 'geom-border',
                    type: 'raster',
                    source: 'geom-border'
                });

                if (data.bounds) {
                    const coords = data.bounds.coordinates[0];
                    const lngs = coords.map(c => c[0]);
                    const lats = coords.map(c => c[1]);
                    const minLng = Math.min(...lngs);
                    const maxLng = Math.max(...lngs);
                    const minLat = Math.min(...lats);
                    const maxLat = Math.max(...lats);

                    map.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 20 });
                }
                if (data.bounds) {
                    const coords = data.bounds.coordinates[0];
                    const lngs = coords.map(c => c[0]);
                    const lats = coords.map(c => c[1]);
                    const minLng = Math.min(...lngs);
                    const maxLng = Math.max(...lngs);
                    const minLat = Math.min(...lats);
                    const maxLat = Math.max(...lats);

                    map.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 20 });
                }
            }

        } catch (e) {
            setError("Geomorphology analysis failed: " + e.message);
        } finally {
            setLoading(false);
        }
    };


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
    const [sensor, setSensor] = useState("Sentinel Harmonized");
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

    // Draw Configuration
    const drawOptions = useMemo(() => ({
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
        snapModeOptions: {
            overlap: true
        },
        controls: {
            polygon: true,
            trash: true
        },
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
                    "line-width": 2
                }
            }
        ]
    }), [snapPixelDistance, snappingEnabled]);

    // Draw Configuration
    // ... (drawOptions is here) ...

    // Helper for Draw Creation (Geometry Update + Cut Logic)

    // Helper for Draw Creation (Geometry Update + Cut Logic + Autocomplete)
    const handleDrawCreate = (e, currentDrawControl) => {
        // 1. Autocomplete / Erase Overlap
        if (eraseOverlap && (e.type === 'draw.create' || e.type === 'draw.update')) {
            setTimeout(() => {
                const features = currentDrawControl.getAll().features;
                const modifiedFeatures = e.features; // Array of features being created/updated

                modifiedFeatures.forEach(modFeature => {
                    if (modFeature.geometry.type === 'Polygon' || modFeature.geometry.type === 'MultiPolygon') {
                        // Find other polygons
                        const others = features.filter(f =>
                            f.id !== modFeature.id &&
                            (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
                        );

                        if (others.length > 0) {
                            let currentGeometry = modFeature;
                            let clipped = false;

                            for (const other of others) {
                                try {
                                    // Clean up geometry with buffer(0) to fix self-intersections
                                    const cleanedCurrent = turf.buffer(currentGeometry, 0);
                                    const cleanedOther = turf.buffer(other, 0);

                                    const diff = turf.difference(cleanedCurrent, cleanedOther);
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
                                    console.warn("Clipping error in Autocomplete", err);
                                }
                            }

                            if (clipped) {
                                if (currentGeometry) {
                                    // Update the feature in draw
                                    currentGeometry.id = modFeature.id;
                                    currentGeometry.properties = modFeature.properties;
                                    currentDrawControl.add(currentGeometry);
                                } else {
                                    // Fully erased, remove it
                                    currentDrawControl.delete(modFeature.id);
                                }
                            }
                        }
                    }
                });
            }, 50);
        }

        // 2. Cut Logic
        if (drawModeRef.current === 'cut' && e.type === 'draw.create') {
            const cutter = e.features[0];
            if (cutter && cutter.geometry.type === 'LineString') {
                setTimeout(() => {
                    try {
                        const allData = currentDrawControl.getAll();
                        const targets = allData.features.filter(f =>
                            f.id !== cutter.id &&
                            (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
                        );

                        // Increased buffer to 10cm (0.0001 km) for better reliability
                        const cutterPoly = turf.buffer(cutter, 0.0001, { units: 'kilometers' });

                        const newFeatures = [];
                        const idsToDelete = [cutter.id];

                        let cutPerformed = false;

                        targets.forEach(target => {
                            try {
                                const cleanedTarget = turf.buffer(target, 0);
                                const diff = turf.difference(cleanedTarget, cutterPoly);

                                if (diff) {
                                    idsToDelete.push(target.id);
                                    if (diff.geometry.type === 'MultiPolygon') {
                                        diff.geometry.coordinates.forEach(coords => {
                                            newFeatures.push({
                                                type: 'Feature',
                                                properties: target.properties,
                                                geometry: { type: 'Polygon', coordinates: coords }
                                            });
                                        });
                                    } else {
                                        newFeatures.push(diff);
                                    }
                                    cutPerformed = true;
                                }
                            } catch (err) {
                                console.warn("Cut error for target", target.id, err);
                            }
                        });

                        if (cutPerformed) {
                            currentDrawControl.delete(idsToDelete);
                            if (newFeatures.length > 0) {
                                currentDrawControl.add({ type: 'FeatureCollection', features: newFeatures });
                                setGeometry(newFeatures[0].geometry);
                            } else {
                                setGeometry(null);
                            }
                        } else {
                            currentDrawControl.delete([cutter.id]);
                        }
                    } catch (err) {
                        console.error("Cut error", err);
                    }

                    setTimeout(() => {
                        currentDrawControl.changeMode('simple_select');
                    }, 50);
                    setDrawMode('simple');
                }, 50);
            }
        }

        // 3. Update Geometry State
        setTimeout(() => {
            const finalData = currentDrawControl.getAll();
            if (finalData.features.length > 0) {
                const lastFeature = finalData.features[finalData.features.length - 1];
                setGeometry(lastFeature.geometry);
            } else {
                setGeometry(null);
            }
        }, 100);
    };

    // Initialize Map(s) based on mode
    useEffect(() => {
        // Cleanup previous maps
        if (map.current) {
            try { map.current.remove(); } catch (e) { console.warn("Error removing map", e); }
        }
        if (compare.current) {
            try { compare.current.remove(); } catch (e) { console.warn("Error removing compare", e); }
        }
        if (mapLeft.current) {
            try { mapLeft.current.remove(); } catch (e) { console.warn("Error removing mapLeft", e); }
        }
        if (mapRight.current) {
            try { mapRight.current.remove(); } catch (e) { console.warn("Error removing mapRight", e); }
        }

        map.current = null;
        mapLeft.current = null;
        mapRight.current = null;
        compare.current = null;
        marker.current = null;
        draw.current = null; // Prevent stale access to draw control

        const mapStyle = "https://demotiles.maplibre.org/style.json";
        // Use viewState if available to persist view across mode switches
        const initialCenter = viewState.current.center;
        const initialZoom = viewState.current.zoom;

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
                        // Initialize Draw Control for Left Map
                        const drawControl = new MapboxDraw(drawOptions);
                        mapLeft.current.addControl(drawControl, 'bottom-right'); // Or top-left? Single map puts it? No default pos.
                        // Actually, Single map puts nav bottom-right. Let's look further down.
                        // Single map adds navigation then draw. Let's do same.
                        mapLeft.current.addControl(new NavigationControl(), 'bottom-right');

                        draw.current = drawControl; // Persist for helper functions

                        // Restore Geometry if exists
                        if (geometry) {
                            try {
                                drawControl.add(geometry);
                            } catch (err) {
                                console.error("Error restoring geometry in Swipe Mode:", err);
                            }
                        }

                        // Event Listeners for Draw
                        const onDrawUpdate = (e) => handleDrawCreate(e, drawControl);

                        mapLeft.current.on('draw.create', onDrawUpdate);
                        mapLeft.current.on('draw.delete', onDrawUpdate);
                        mapLeft.current.on('draw.update', onDrawUpdate);

                        // Initial snap state
                        drawControl.options.snap = snappingEnabled;

                        mapLeft.current.once('load', () => {
                            if (activeLayerId) {
                                console.log("Restoring active layer to Left Map:", activeLayerId);
                                setLeftLayerId(activeLayerId); // SYNC STATE
                                handleLayerAdd(activeLayerId, 'left');
                            }
                        });

                        // Add click listener to Left Map (primary for interaction)
                        mapLeft.current.on('click', (e) => {
                            // Prevent interfering with drawing modes
                            if (drawControl.getMode() !== 'simple_select') return;

                            const { lng, lat } = e.lngLat;
                            // Only Point if draw is empty (same logic as single map or simpler?)
                            if (drawControl.getAll().features.length === 0) {
                                const point = { type: "Point", coordinates: [lng, lat] };
                                setGeometry(point);
                            }
                            setIsExplorerOpen(true);
                        });

                        // Sync viewState on move
                        mapLeft.current.on('move', () => {
                            const center = mapLeft.current.getCenter();
                            const zoom = mapLeft.current.getZoom();
                            viewState.current = { center: [center.lng, center.lat], zoom };
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
            const drawControl = new MapboxDraw(drawOptions);
            map.current.addControl(drawControl, 'top-left');
            draw.current = drawControl;

            // Restoring previous geometry if exists
            if (geometry) {
                try {
                    drawControl.add(geometry);
                } catch (err) {
                    console.error("Error restoring geometry in Single Mode:", err);
                }
            }

            const updateGeometryFromDraw = (e) => handleDrawCreate(e, drawControl);

            map.current.on('draw.create', updateGeometryFromDraw);
            map.current.on('draw.delete', updateGeometryFromDraw);
            map.current.on('draw.update', updateGeometryFromDraw);


            // Initial snap state
            drawControl.options.snap = snappingEnabled;

            map.current.on('click', (e) => {
                // Prevent interfering with drawing modes
                if (drawControl.getMode() !== 'simple_select') return;
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

            // Sync viewState on move
            map.current.on('move', () => {
                const center = map.current.getCenter();
                const zoom = map.current.getZoom();
                viewState.current = { center: [center.lng, center.lat], zoom };
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

    const groupedImages = useMemo(() => {
        if (!images || images.length === 0) return [];
        // Disable aggregation - show all images as requested
        return images;
    }, [images, windowWidth]);
    // Re-run when images change or window resizes


    // Auto-Update Effects

    // 1. On Vis Change: Update active layer if exists
    useEffect(() => {
        if (!loading && activeLayerId && !isCompareMode) {
            console.log("Auto-updating layer viz...");
            handleLayerAdd(activeLayerId, 'single');
        }
    }, [visOption]);

    // 2. On Sensor Change Or Geometry Change: Re-run search if geometry exists
    // DISABLED: User wants manual search only.
    /*
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
    */


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
            {/* Floating Super Res Controls */}

            <nav className={styles.navbar}>
                <div className={styles.brand}>
                    <span>GEE Explorer</span>
                    <button
                        className={`${styles.explorerBtn} ${isExplorerOpen ? styles.explorerBtnActive : ''}`}
                        onClick={() => {
                            setIsExplorerOpen(!isExplorerOpen);
                            if (!isExplorerOpen) setActiveTab('search');
                        }}
                    >
                        Explorador {isExplorerOpen ? '▲' : '▼'}
                    </button>

                    <button
                        className={`${styles.explorerBtn} ${activeTab === 'monitor' ? styles.explorerBtnActive : ''}`}
                        onClick={() => {
                            setActiveTab('monitor');
                            setIsExplorerOpen(true);
                        }}
                    >
                        Monitor
                    </button>

                    <button
                        className={`${styles.explorerBtn} ${activeTab === 'geomorphology' ? styles.explorerBtnActive : ''}`}
                        onClick={() => {
                            setActiveTab('geomorphology');
                            setIsExplorerOpen(true);
                        }}
                    >
                        Geomorphology
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
                                            <option value="Landsat (Pan-sharpened)">Landsat (Pan-sharpened)</option>
                                            <option value="Sentinel Harmonized">Sentinel Harmonized</option>
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

                        {/* MONITOR TAB */}
                        {activeTab === 'monitor' && (
                            <>
                                <div className={styles.title}>Monitor Territory</div>
                                <div className={styles.subtitle}>Cloud stats & Change Detection</div>

                                <div className={styles.section}>
                                    <label className={styles.label}>Select Comuna</label>
                                    <select
                                        className={styles.select}
                                        value={selectedComuna}
                                        onChange={(e) => setSelectedComuna(e.target.value)}
                                    >
                                        <option value="">-- Choose Comuna --</option>
                                        {comunas.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>

                                    <div style={{ marginTop: '10px' }}>
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

                                    <button
                                        className={styles.button}
                                        onClick={handleMonitorSearch}
                                        disabled={loading || !selectedComuna}
                                        style={{ marginTop: '15px' }}
                                    >
                                        {loading ? "Searching..." : "Analyze Cloud Series"}
                                    </button>

                                    {/* Simple Chart / List */}
                                    {monitorData.length > 0 && (
                                        <div style={{ marginTop: '20px', maxHeight: '200px', overflowY: 'auto' }}>
                                            <div className={styles.label}>Select Image for Analysis:</div>
                                            {monitorData.map((d) => (
                                                <div
                                                    key={d.id}
                                                    onClick={() => {
                                                        setSelectedMonitorImage(d);
                                                        setAnalysisResult(null); // Reset analysis
                                                    }}
                                                    style={{
                                                        padding: '8px',
                                                        border: selectedMonitorImage?.id === d.id ? '2px solid #0070f3' : '1px solid #ccc',
                                                        borderRadius: '4px',
                                                        marginBottom: '5px',
                                                        cursor: 'pointer',
                                                        background: '#fff',
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        fontSize: '12px'
                                                    }}
                                                >
                                                    <span>{d.date}</span>
                                                    <span>☁ {Math.round(d.cloud)}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {selectedMonitorImage && (
                                        <div style={{ marginTop: '20px', borderTop: '1px solid #ccc', paddingTop: '10px' }}>
                                            <div className={styles.label}>Change Detection</div>
                                            <div className={styles.instruction}>
                                                Target: {selectedMonitorImage.date}
                                            </div>

                                            <label className={styles.label} style={{ marginTop: '10px' }}>Baseline Year (Optional)</label>
                                            <input
                                                type="number"
                                                className={styles.input}
                                                placeholder="e.g. 2024"
                                                value={baselineYear}
                                                onChange={(e) => setBaselineYear(e.target.value)}
                                            />

                                            <button
                                                className={styles.button}
                                                onClick={handleMonitorAnalysis}
                                                disabled={loading}
                                                style={{ marginTop: '10px', background: '#e00' }}
                                            >
                                                {loading ? "Processing..." : "Calculate Differences"}
                                            </button>
                                        </div>
                                    )}

                                    {analysisResult && (
                                        <div style={{ marginTop: '15px', padding: '10px', background: '#f0f9ff', borderRadius: '4px' }}>
                                            <div>✅ Analysis Complete</div>
                                            {analysisResult.downloadUrl && (
                                                <a
                                                    href={analysisResult.downloadUrl}
                                                    target="_blank"
                                                    className={styles.link}
                                                    style={{ display: 'block', marginTop: '5px', color: '#0070f3' }}
                                                >
                                                    💾 Download KMZ
                                                </a>
                                            )}
                                        </div>
                                    )}

                                    {error && <div className={styles.error} style={{ marginTop: '10px' }}>{error}</div>}
                                </div>
                            </>
                        )}

                        {/* GEOMORPHOLOGY TAB */}
                        {activeTab === 'geomorphology' && (
                            <>
                                <div className={styles.title}>Geomorphology</div>
                                <div className={styles.subtitle}>Terrain Analysis</div>

                                <div className={styles.section}>
                                    <label className={styles.label}>Select Comuna</label>
                                    <select
                                        className={styles.select}
                                        value={selectedGeomComuna}
                                        onChange={(e) => setSelectedGeomComuna(e.target.value)}
                                    >
                                        <option value="">-- Choose Comuna --</option>
                                        {comunas.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>

                                    <label className={styles.label} style={{ marginTop: '10px' }}>Analysis Type</label>
                                    <select
                                        className={styles.select}
                                        value={geomType}
                                        onChange={(e) => setGeomType(e.target.value)}
                                    >
                                        <option value="Slope">Slope (Pendiente)</option>
                                        <option value="Aspect">Aspect (Exposición)</option>
                                        <option value="Hillshade">Hillshade (Sombra)</option>
                                        <option value="DEM">DEM (Elevación)</option>
                                    </select>

                                    <button
                                        className={styles.button}
                                        onClick={handleGeomAnalysis}
                                        disabled={loading || !selectedGeomComuna}
                                        style={{ marginTop: '15px' }}
                                    >
                                        {loading ? "Generating..." : "Generate Analysis"}
                                    </button>

                                    {geomResult && (
                                        <div style={{ marginTop: '15px', padding: '10px', background: '#f0f9ff', borderRadius: '4px' }}>
                                            <div>✅ Analysis Complete</div>
                                            {geomResult.downloadUrl && (
                                                <a
                                                    href={geomResult.downloadUrl}
                                                    target="_blank"
                                                    className={styles.link}
                                                    style={{ display: 'block', marginTop: '5px', color: '#0070f3' }}
                                                >
                                                    💾 Download GeoTIFF
                                                </a>
                                            )}
                                        </div>
                                    )}

                                    {error && <div className={styles.error} style={{ marginTop: '10px' }}>{error}</div>}
                                </div>
                            </>
                        )}


                    </div>
                </div>

                {/* Map Container - Handles both Single and Compare modes */}
                <div className={styles.mapContainer} ref={mapContainer}>
                    {isCompareMode && (
                        <>
                            <div ref={leftMapContainer} className={styles.mapLeft}></div>
                            <div ref={rightMapContainer} className={styles.mapRight}></div>
                        </>
                    )}

                    {/* Show/Hide Timeline Button - Centered Bottom */}
                    <div style={{
                        position: 'absolute',
                        bottom: '10px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 1001,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        pointerEvents: 'auto'
                    }}>
                        {/* Only show if images exist */}
                        {groupedImages.length > 0 && !showTimeline && (
                            <button
                                onClick={() => setShowTimeline(true)}
                                style={{
                                    background: 'white',
                                    color: '#333',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: '40px',
                                    height: '40px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                    cursor: 'pointer',
                                    fontSize: '18px'
                                }}
                                title="Show Timeline"
                            >
                                ↺
                            </button>
                        )}
                    </div>

                    {/* Timeline Results - Fixed Bottom */}
                    {groupedImages.length > 0 && showTimeline && (
                        <div className={styles.timelineContainer}>
                            <button
                                className={styles.timelineCloseBtn}
                                onClick={() => setShowTimeline(false)}
                                title="Hide Timeline"
                            >
                                ✕
                            </button>

                            <div className={styles.timelineScroll}>
                                {groupedImages.map((img) => (
                                    <div
                                        key={img.id}
                                        className={styles.timelineItem}
                                        onClick={() => handleTimelineClick(img, isCompareMode ? 'right' : 'single')}
                                    >
                                        <div
                                            className={`
                        ${styles.timelineDot} 
                        ${!isCompareMode && img.id === activeLayerId ? styles.timelineDotActive : ''}
                        ${isCompareMode && img.id === leftLayerId ? styles.timelineDotLeft : ''}
                        ${isCompareMode && img.id === rightLayerId ? styles.timelineDotRight : ''}
                        `}
                                            style={{ backgroundColor: getDotColor(img.cloud) }}
                                        ></div>

                                        <div className={styles.timelineDatePill}>{img.date}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
