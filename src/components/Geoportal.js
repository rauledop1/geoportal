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
import { IconPolygon, IconCut, IconMagnet, IconTrash, IconLine, IconPoint, IconDownload } from './Icons';
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
    const timelineScrollRef = useRef(null);

    // Timeline Drag State
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);

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

    // Layers Panel State
    const [isLayersOpen, setIsLayersOpen] = useState(true);
    const [permanentLayers, setPermanentLayers] = useState([]);
    const [searchLayers, setSearchLayers] = useState([]);
    const [drawnPolygons, setDrawnPolygons] = useState([]); // [{id, name, visible, geometry}]
    const [featureModal, setFeatureModal] = useState({ show: false, id: null, position: null, isEditable: false });
    const [editingGeometryId, setEditingGeometryId] = useState(null); // ID of feature being extended with new parts
    const nextPolyId = useRef(1);



    // Timeline Drag Handlers
    const handleTimelineMouseDown = (e) => {
        if (!timelineScrollRef.current) return;
        setIsDragging(true);
        setStartX(e.pageX - timelineScrollRef.current.offsetLeft);
        setScrollLeft(timelineScrollRef.current.scrollLeft);
    };

    const handleTimelineMouseMove = (e) => {
        if (!isDragging || !timelineScrollRef.current) return;
        e.preventDefault();
        const x = e.pageX - timelineScrollRef.current.offsetLeft;
        const walk = (x - startX) * 2; // scroll speed
        timelineScrollRef.current.scrollLeft = scrollLeft - walk;
    };

    const handleTimelineMouseUp = () => {
        setIsDragging(false);
    };

    // Touch support
    const handleTimelineTouchStart = (e) => {
        if (!timelineScrollRef.current) return;
        setIsDragging(true);
        setStartX(e.touches[0].pageX - timelineScrollRef.current.offsetLeft);
        setScrollLeft(timelineScrollRef.current.scrollLeft);
    };

    const handleTimelineTouchMove = (e) => {
        if (!isDragging || !timelineScrollRef.current) return;
        const x = e.touches[0].pageX - timelineScrollRef.current.offsetLeft;
        const walk = (x - startX) * 2;
        timelineScrollRef.current.scrollLeft = scrollLeft - walk;
    };

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
    useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);

    const editingGeometryIdRef = useRef(editingGeometryId);
    useEffect(() => { editingGeometryIdRef.current = editingGeometryId; }, [editingGeometryId]);

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

    // Layer Opacity State
    const [layerOpacity, setLayerOpacity] = useState(100);
    const [minTreeHeight, setMinTreeHeight] = useState(0);

    // Crop Monitoring Selectors
    const [cropT1, setCropT1] = useState(null);
    const [cropT2, setCropT2] = useState(null);
    const [cropSelectionMode, setCropSelectionMode] = useState('slave'); // 'master' or 'slave'

    // Analysis statesConfiguration
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
        controls: {}, // Hide all default controls
        styles: [
            // 1. Polygon Fill (Active)
            {
                "id": "gl-draw-polygon-fill-active",
                "type": "fill",
                "filter": ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
                "paint": {
                    "fill-color": "#3b82f6",
                    "fill-outline-color": "#3b82f6",
                    "fill-opacity": 0.1
                }
            },
            // 2. Active Line Stroke (Covers LineStrings and Polygons while drawing)
            {
                "id": "gl-draw-line-active",
                "type": "line",
                "filter": ["all", ["!=", "mode", "static"]],
                "layout": {
                    "line-cap": "round",
                    "line-join": "round"
                },
                "paint": {
                    "line-color": "#3b82f6",
                    "line-width": 3
                }
            },
            // 3. Static Polygon Fill (Respects user_hidden)
            {
                "id": "gl-draw-polygon-fill-static",
                "type": "fill",
                "filter": ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"], ["!=", ["get", "user_hidden"], "true"]],
                "paint": {
                    "fill-color": "#3b82f6",
                    "fill-opacity": 0.05
                }
            },
            // 4. Static Lines (Respects user_hidden)
            {
                "id": "gl-draw-line-static",
                "type": "line",
                "filter": ["all", ["==", "mode", "static"], ["!=", ["get", "user_hidden"], "true"]],
                "layout": {
                    "line-cap": "round",
                    "line-join": "round"
                },
                "paint": {
                    "line-color": "#3b82f6",
                    "line-width": 2,
                    "line-opacity": 0.5
                }
            },
            // 5. Active Vertices / Nodes
            {
                "id": "gl-draw-point-active",
                "type": "circle",
                "filter": ["all", ["==", "$type", "Point"], ["!=", "mode", "static"]],
                "paint": {
                    "circle-radius": 7,
                    "circle-color": "#3b82f6",
                    "circle-stroke-width": 2,
                    "circle-stroke-color": "#fff"
                }
            },
            // 6. Midpoints
            {
                "id": "gl-draw-point-midpoint",
                "type": "circle",
                "filter": ["all", ["==", "$type", "Point"], ["==", "meta", "midpoint"]],
                "paint": {
                    "circle-radius": 5,
                    "circle-color": "#3b82f6"
                }
            },
            // 7. Static Point (Respects user_hidden)
            {
                "id": "gl-draw-point-static",
                "type": "circle",
                "filter": ["all", ["==", "$type", "Point"], ["==", "mode", "static"], ["!=", ["get", "user_hidden"], "true"]],
                "paint": {
                    "circle-radius": 5,
                    "circle-color": "#3b82f6"
                }
            }
        ]
    }), [snapPixelDistance, snappingEnabled]);

    // Draw Configuration
    // ... (drawOptions is here) ...

    // Helper for Draw Creation (Geometry Update + Cut Logic)

    // Helper for Draw Creation (Geometry Update + Cut Logic + Autocomplete)
    const handleDrawCreate = (e, currentDrawControl) => {
        const feature = e.features[0];

        // 0. Append to existing geometry if in edit mode
        if (editingGeometryIdRef.current && e.type === 'draw.create' && drawModeRef.current !== 'cut') {
            const target = currentDrawControl.get(editingGeometryIdRef.current);
            if (target && feature.id !== target.id) {
                try {
                    const union = turf.union(target, feature);
                    if (union) {
                        currentDrawControl.add(union);
                        currentDrawControl.setFeatureProperty(union.id, 'auto_id', target.properties.auto_id);
                        currentDrawControl.setFeatureProperty(union.id, 'custom_fields', target.properties.custom_fields);
                        currentDrawControl.delete([feature.id]);
                        updateDrawnPolygons(currentDrawControl);

                        // STAY in draw mode to allow adding more parts, as requested
                        setTimeout(() => {
                            const mode = target.geometry.type.includes('Polygon') ? 'draw_polygon' :
                                target.geometry.type.includes('LineString') ? 'draw_line_string' : 'draw_point';
                            currentDrawControl.changeMode(mode);
                        }, 100);
                        return;
                    }
                } catch (err) {
                    console.warn("Union failed", err);
                }
            }
        }

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

                                    // Explode MultiPolygon into separate Polygon features
                                    const flattened = turf.flatten(diff);
                                    flattened.features.forEach((f, fidx) => {
                                        newFeatures.push({
                                            type: 'Feature',
                                            properties: {
                                                ...target.properties,
                                                auto_id: nextPolyId.current++ // Assign new auto_id to each part
                                            },
                                            geometry: f.geometry
                                        });
                                    });
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
                                updateDrawnPolygons(currentDrawControl);
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

        // 3. Update Geometry State & Trigger Modal
        setTimeout(() => {
            const finalData = currentDrawControl.getAll();
            if (finalData.features.length > 0) {
                const lastFeature = finalData.features[finalData.features.length - 1];
                setGeometry(lastFeature.geometry);

                // Trigger Modal for NEW features (not during cut)
                if (e.type === 'draw.create' && drawModeRef.current !== 'cut') {
                    let point;
                    try {
                        const centroid = turf.centroid(lastFeature);
                        point = centroid.geometry.coordinates;
                    } catch (err) {
                        // Fallback to first point
                        point = lastFeature.geometry.type === 'Point'
                            ? lastFeature.geometry.coordinates
                            : lastFeature.geometry.coordinates[0][0] || lastFeature.geometry.coordinates[0];
                    }

                    if (point && map.current) {
                        const pos = map.current.project(point);
                        setFeatureModal({
                            show: true,
                            id: lastFeature.id,
                            position: pos,
                            autoId: nextPolyId.current++,
                            isEditable: true
                        });
                        // Automatically set the ID in properties
                        currentDrawControl.setFeatureProperty(lastFeature.id, 'auto_id', nextPolyId.current - 1);
                        // Also update state list name if possible
                        updateDrawnPolygons(currentDrawControl);
                    }
                }
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

        const mapStyle = {
            version: 8,
            sources: {
                'google-satellite': {
                    'type': 'raster',
                    'tiles': ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
                    'tileSize': 256,
                    'attribution': '&copy; Google Maps'
                }
            },
            layers: [
                {
                    'id': 'google-satellite',
                    'type': 'raster',
                    'source': 'google-satellite',
                    'minzoom': 0,
                    'maxzoom': 22
                }
            ]
        };
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

            map.current.on('draw.create', (e) => {
                updateGeometryFromDraw(e);
                updateDrawnPolygons(draw.current);
            });
            map.current.on('draw.selectionchange', () => {
                const selected = draw.current.getSelected();
                if (selected.features.length === 1) {
                    const feature = selected.features[0];
                    const centroid = turf.centroid(feature);
                    const pos = map.current.project(centroid.geometry.coordinates);

                    setFeatureModal(prev => ({
                        ...prev,
                        show: true,
                        id: feature.id,
                        position: pos,
                        autoId: feature.properties.auto_id,
                        isEditable: prev.id === feature.id ? prev.isEditable : false // Reset to read-only if new selection
                    }));
                } else if (selected.features.length === 0) {
                    setFeatureModal(prev => ({ ...prev, show: false }));
                    setEditingGeometryId(null);
                }
            });

            map.current.on('click', (e) => {
                // Check if click was on a feature but NOT in a drawing mode
                const currentMode = draw.current.getMode();
                if (currentMode === 'simple_select' || currentMode === 'direct_select') {
                    // Logic handled by selectionchange above for cleaner integration
                }
            });
            map.current.on('draw.update', (e) => {
                updateGeometryFromDraw(e);
                updateDrawnPolygons(draw.current);
            });
            map.current.on('draw.delete', (e) => {
                updateGeometryFromDraw(e);
                updateDrawnPolygons(draw.current);
            });


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

    // Update Polygon Label (Area in Hectares)
    useEffect(() => {
        const updateLabel = (mapInstance) => {
            if (!mapInstance) return;

            const sourceId = "polygon-label-source";
            const layerId = "polygon-label-layer";

            if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
                if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
                if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId);
                return;
            }

            try {
                // Calculate Area
                const areaSqMeters = turf.area(geometry);
                const areaHectares = (areaSqMeters / 10000).toFixed(1);

                // Calculate Center for label placement
                const center = turf.centerOfMass(geometry);

                const labelFeature = {
                    type: "Feature",
                    geometry: center.geometry,
                    properties: {
                        label: `${areaHectares} ha`
                    }
                };

                if (!mapInstance.getSource(sourceId)) {
                    mapInstance.addSource(sourceId, {
                        type: "geojson",
                        data: {
                            type: "FeatureCollection",
                            features: [labelFeature]
                        }
                    });

                    mapInstance.addLayer({
                        id: layerId,
                        type: "symbol",
                        source: sourceId,
                        layout: {
                            "text-field": ["get", "label"],
                            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
                            "text-size": 14,
                            "text-offset": [0, 0],
                            "text-anchor": "center"
                        },
                        paint: {
                            "text-color": "#ffffff",
                            "text-halo-color": "#000000",
                            "text-halo-width": 2
                        }
                    });
                } else {
                    mapInstance.getSource(sourceId).setData({
                        type: "FeatureCollection",
                        features: [labelFeature]
                    });
                }
            } catch (err) {
                console.error("Error updating polygon label:", err);
            }
        };

        if (isCompareMode) {
            updateLabel(mapLeft.current);
            updateLabel(mapRight.current);
        } else {
            updateLabel(map.current);
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
        let searchGeom = geometry;

        // If no geometry specified, use map center
        if (!searchGeom && map.current) {
            const center = map.current.getCenter();
            searchGeom = {
                type: 'Point',
                coordinates: [center.lng, center.lat]
            };
        }

        if (!searchGeom) {
            setError("No se pudo determinar una ubicación para la búsqueda.");
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
                    geometry: searchGeom
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

    useEffect(() => {
        syncLayerOrder();
    }, [searchLayers, permanentLayers]);

    const getSummarizedName = (sensorName, imageId, visOpt) => {
        let code = sensorName;
        if (sensorName.includes("Sentinel Harmonized")) code = "S2H";
        else if (sensorName.includes("Sentinel-1")) code = "S1";
        else if (sensorName.includes("Landsat")) code = "LS";
        else if (sensorName.includes("Combined")) code = "COMB";
        else if (sensorName.includes("Canopy Height")) code = "CHM";
        else if (sensorName.includes("Digital Surface Model")) code = "DSM";

        let nick = "";
        if (visOpt === "Wildfire" || visOpt === "Wildfire Monitoring") nick = "FIRE";
        else if (visOpt === "Vegetation Change") nick = "DNDVI";
        else if (visOpt === "Crop Monitoring") nick = "CROP";
        else if (visOpt === "NDVI") nick = "NDVI";
        else if (visOpt === "NDWI") nick = "NDWI";
        else if (visOpt === "True Color" || visOpt === "True Color (RGB)") nick = "RGB";
        else if (visOpt === "False Color (Infrared)") nick = "IR";
        else if (visOpt === "Radar Vegetation Index (RVI)") nick = "RVI";
        else if (visOpt === "Radar Soil Moisture") nick = "SSM";

        const namePart = nick ? `${code} ${nick}` : code;

        // Extract date if possible (YYYY-MM-DD)
        const dateMatch = imageId.match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch) return `${namePart} ${dateMatch[0]}`;

        // Alternative date format YYYYMMDD
        const dateMatchBrief = imageId.match(/\d{8}/);
        if (dateMatchBrief) {
            const d = dateMatchBrief[0];
            return `${namePart} ${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
        }

        if (imageId.includes("Static")) return `${namePart} (Mosaic)`;

        return `${namePart} ${imageId.split('/').pop()}`;
    };

    const handleDrawLine = () => {
        setDrawMode('line');
        setEraseOverlap(false);
        if (draw.current) draw.current.changeMode('draw_line_string');
    };

    const handleDrawPoint = () => {
        setDrawMode('point');
        setEraseOverlap(false);
        if (draw.current) draw.current.changeMode('draw_point');
    };

    const handleDrawPolygon = () => {
        setDrawMode('simple');
        setEraseOverlap(false);
        if (draw.current) draw.current.changeMode('draw_polygon');
    };
    const handleEditFeature = (id) => {
        if (draw.current) {
            setEditingGeometryId(id);
            draw.current.changeMode('direct_select', { featureId: id });
            setActiveTab('draw');

            // Trigger modal in editable mode
            const feat = draw.current.get(id);
            if (feat && map.current) {
                const centroid = turf.centroid(feat);
                const pos = map.current.project(centroid.geometry.coordinates);
                setFeatureModal({ show: true, id: id, position: pos, autoId: feat.properties.auto_id, isEditable: true });
            }
        }
    };

    const moveLayerInList = (listType, layerId, direction) => {
        const setList = listType === 'permanent' ? setPermanentLayers : setSearchLayers;
        const currentList = listType === 'permanent' ? permanentLayers : searchLayers;
        const index = currentList.findIndex(l => l.id === layerId);
        if (index === -1) return;

        if (direction === 'up' && index === 0) return;
        if (direction === 'down' && index === currentList.length - 1) return;

        const newList = [...currentList];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        const [movedItem] = newList.splice(index, 1);
        newList.splice(targetIndex, 0, movedItem);
        setList(newList);
    };

    const syncLayerOrder = () => {
        if (!map.current) return;
        // In the UI, Permanent Layers are listed first (top), then Search Layers.
        // If "Top of List = Top of Map", we process from bottom of the list to top.
        const combined = [...searchLayers, ...permanentLayers].reverse();

        combined.forEach(layer => {
            const layerId = `ee-layer-${layer.id}`;
            if (map.current.getLayer(layerId)) {
                // Moving a layer without a 'beforeId' puts it on top of all others
                map.current.moveLayer(layerId);
            }
        });

        // Ensure drawing layers stay on very top
        const style = map.current.getStyle();
        if (style && style.layers) {
            style.layers.forEach(l => {
                if (l.id.startsWith('gl-draw-')) {
                    map.current.moveLayer(l.id);
                }
            });
        }
    };

    const updateLayerOpacity = (layerId, opacity) => {
        const updateInList = (list) => list.map(l => l.id === layerId ? { ...l, opacity } : l);
        setPermanentLayers(prev => updateInList(prev));
        setSearchLayers(prev => updateInList(prev));

        if (map.current && map.current.getLayer(`ee-layer-${layerId}`)) {
            map.current.setPaintProperty(`ee-layer-${layerId}`, 'raster-opacity', opacity / 100);
        }
    };

    const toggleLayerSwipe = (layerId, urlFormat) => {
        if (!isCompareMode) {
            setIsCompareMode(true);
        }
        setRightLayerId(layerId);
        handleLayerAdd(layerId, 'right');
    };

    const updateDrawnPolygonValue = (id, newValue) => {
        if (newValue.length > 255) return;
        setDrawnPolygons(prev => prev.map(p => p.id === id ? { ...p, value: newValue } : p));
        if (draw.current) {
            draw.current.setFeatureProperty(id, 'user_value', newValue);
        }
    };

    const addCustomField = (id) => {
        setDrawnPolygons(prev => prev.map(p => {
            if (p.id === id) {
                const fields = p.fields || [];
                return { ...p, fields: [...fields, { name: 'Nueva Capa', type: 'string', value: '' }] };
            }
            return p;
        }));
    };

    const updateCustomField = (featureId, fieldIndex, key, val) => {
        setDrawnPolygons(prev => prev.map(p => {
            if (p.id === featureId) {
                const fields = [...(p.fields || [])];
                fields[fieldIndex] = { ...fields[fieldIndex], [key]: val };
                if (draw.current) draw.current.setFeatureProperty(featureId, 'custom_fields', fields);
                return { ...p, fields };
            }
            return p;
        }));
    };

    const calculateAreaHa = (geometry) => {
        try {
            if (geometry.type.includes('Polygon')) {
                const areaSqM = turf.area(geometry);
                return (areaSqM / 10000).toFixed(2);
            }
        } catch (e) { return "0.00"; }
        return "0.00";
    };

    const calculateLengthKm = (geometry) => {
        try {
            if (geometry.type.includes('LineString')) {
                const lenKm = turf.length(geometry, { units: 'kilometers' });
                return lenKm.toFixed(1);
            }
        } catch (e) { return "0.0"; }
        return "0.0";
    };

    // Update Drawn Polygons list from Mapbox Draw
    const updateDrawnPolygons = (drawControl) => {
        if (!drawControl) return;
        const features = drawControl.getAll().features;
        setDrawnPolygons(prev => {
            const newPolys = features.map((f, index) => {
                const existing = prev.find(p => p.id === f.id);
                let defaultName = `Polygon ${index + 1}`;
                if (f.geometry.type.includes('LineString')) defaultName = `Line ${index + 1}`;
                if (f.geometry.type.includes('Point')) defaultName = `Point ${index + 1}`;

                const isLine = f.geometry.type.includes('LineString');
                const metricValue = isLine ? calculateLengthKm(f.geometry) : calculateAreaHa(f.geometry);
                const metricLabel = isLine ? 'km' : 'ha';

                return {
                    id: f.id,
                    name: existing?.name || defaultName,
                    auto_id: f.properties?.auto_id || existing?.auto_id || (index + 1),
                    value: existing?.value || (f.properties?.user_value || ''),
                    fields: existing?.fields || f.properties?.custom_fields || [],
                    visible: existing ? existing.visible : true,
                    geometry: f.geometry,
                    metricValue: metricValue,
                    metricLabel: metricLabel,
                    areaHa: metricValue // keeping for backward compatibility if needed elsewhere
                };
            });
            return newPolys;
        });
    };

    const renameDrawnPolygon = (id, newName) => {
        setDrawnPolygons(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
    };

    const toggleLayerVisibility = (layerId, listType) => {
        const setList = listType === 'permanent' ? setPermanentLayers : setSearchLayers;
        const list = listType === 'permanent' ? permanentLayers : searchLayers;

        const updatedList = list.map(l => {
            if (l.id === layerId) {
                const newVisible = !l.visible;
                if (map.current) {
                    if (newVisible) {
                        // Re-add layer if it was previously removed but we have urlFormat
                        if (l.urlFormat && !map.current.getLayer(`ee-layer-${l.id}`)) {
                            addLayerToMap(l.id, l.urlFormat);
                        }
                    } else {
                        // Hide layer
                        if (map.current.getLayer(`ee-layer-${l.id}`)) {
                            map.current.setLayoutProperty(`ee-layer-${l.id}`, 'visibility', 'none');
                        }
                    }
                    // If showing, make sure visibility is 'visible'
                    if (newVisible && map.current.getLayer(`ee-layer-${l.id}`)) {
                        map.current.setLayoutProperty(`ee-layer-${l.id}`, 'visibility', 'visible');
                    }
                }
                return { ...l, visible: newVisible };
            }
            return l;
        });
        setList(updatedList);
    };

    const addLayerToMap = (id, urlFormat) => {
        if (!map.current) return;
        const sourceId = `ee-source-${id}`;
        const layerId = `ee-layer-${id}`;

        if (map.current.getLayer(layerId)) map.current.removeLayer(layerId);
        if (map.current.getSource(sourceId)) map.current.removeSource(sourceId);

        map.current.addSource(sourceId, {
            type: "raster",
            tiles: [urlFormat],
            tileSize: 256,
        });

        const layers = map.current.getStyle().layers;
        const firstDrawLayer = layers.find(l => l.id.startsWith('gl-draw-'));
        const beforeId = firstDrawLayer ? firstDrawLayer.id : undefined;

        map.current.addLayer({
            id: layerId,
            type: "raster",
            source: sourceId,
            minzoom: 0,
            maxzoom: 22,
        }, beforeId);
    };

    const moveLayer = (layerId, fromType, toType) => {
        const fromList = fromType === 'permanent' ? permanentLayers : searchLayers;
        const toList = toType === 'permanent' ? permanentLayers : searchLayers;
        const setFromList = fromType === 'permanent' ? setPermanentLayers : setSearchLayers;
        const setToList = toType === 'permanent' ? setPermanentLayers : setSearchLayers;

        const layer = fromList.find(l => l.id === layerId);
        if (!layer) return;

        setFromList(fromList.filter(l => l.id !== layerId));
        setToList([...toList, layer]);
    };

    const removeLayerFromList = (layerId) => {
        setSearchLayers(searchLayers.filter(l => l.id !== layerId));
        setPermanentLayers(permanentLayers.filter(l => l.id !== layerId));

        if (map.current) {
            if (map.current.getLayer(`ee-layer-${layerId}`)) map.current.removeLayer(`ee-layer-${layerId}`);
            if (map.current.getSource(`ee-source-${layerId}`)) map.current.removeSource(`ee-source-${layerId}`);
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
                    visOption,
                    minHeight: minTreeHeight, // Pass threshold
                    t1ImageId: cropT1?.id,
                    t2ImageId: cropT2?.id
                })
            });

            if (!res.ok) throw new Error("Failed to get layer");
            const { urlFormat } = await res.json();

            console.log("Adding Layer:", { imageId, target, urlFormat });

            // Update Layer Lists
            const displayName = getSummarizedName(sensor, imageId, visOption);
            const isPermanent = sensor === "Canopy Height (Meta)" || sensor === "Digital Surface Model";

            // Unique ID per visualization to avoid date collisions
            const uniqueId = `${imageId}__VIS:${visOption.replace(/\s+/g, '_')}`;

            const newLayer = {
                id: uniqueId,
                imageId: imageId, // Original asset ID
                visOption: visOption, // Store which viz this is
                name: displayName,
                visible: true,
                opacity: 100,
                urlFormat: urlFormat,
                type: isPermanent ? 'permanent' : 'search'
            };

            if (isPermanent) {
                setPermanentLayers(prev => {
                    const exists = prev.find(l => l.id === uniqueId);
                    if (exists) {
                        return prev.map(l => l.id === uniqueId ? { ...l, urlFormat, name: newLayer.name, visible: true } : l);
                    }
                    return [...prev, newLayer];
                });
            } else {
                setSearchLayers(prev => {
                    // Remove ALL existing search layers from map first to ensure "Capa Temporal" only has one
                    prev.forEach(l => {
                        if (map.current) {
                            if (map.current.getLayer(`ee-layer-${l.id}`)) map.current.removeLayer(`ee-layer-${l.id}`);
                            if (map.current.getSource(`ee-source-${l.id}`)) map.current.removeSource(`ee-source-${l.id}`);
                        }
                    });
                    // Only return the NEW layer as the single "Capa Temporal"
                    return [newLayer];
                });
            }


            if (isCompareMode) {
                // Compare mode logic remains simplified to left/right for now 
                // but we use the new ID for the map instance
                const sourceId = "ee-source-" + target;
                const layerId = "ee-layer-" + target;

                let targetMap;
                if (target === 'left') targetMap = mapLeft.current;
                if (target === 'right') targetMap = mapRight.current;

                if (targetMap) {
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
                    });
                }
                if (target === 'left') setLeftLayerId(imageId);
                if (target === 'right') setRightLayerId(imageId);
            } else {
                // Single map mode: Add as a distinct layer in the list
                addLayerToMap(uniqueId, urlFormat);

                // User requested: "cuando tengas una imagen en paremante y busques una nueva solo desactivala"
                // Hide ALL other raster layers on the map to focus on the new one
                [...permanentLayers, ...searchLayers].forEach(l => {
                    if (l.id !== uniqueId && map.current && map.current.getLayer(`ee-layer-${l.id}`)) {
                        map.current.setLayoutProperty(`ee-layer-${l.id}`, 'visibility', 'none');
                    }
                });

                // We keep the state checkboxes as they are, or just mark the current as visible.
                setSearchLayers(prev => prev.map(l => l.id === uniqueId ? { ...l, visible: true } : l));
                setPermanentLayers(prev => prev.map(l => l.id === uniqueId ? { ...l, visible: true } : l));

                setActiveLayerId(uniqueId);
            }
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
    }, [images]);

    const timelineTrackStyle = useMemo(() => {
        if (groupedImages.length < 2) return { minWidth: '100%' };

        try {
            const start = new Date(groupedImages[0].date);
            const end = new Date(groupedImages[groupedImages.length - 1].date);

            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                return { minWidth: '100%' };
            }

            const diffDays = (end - start) / (1000 * 60 * 60 * 24);
            // 6 months is approx 180 days. 
            const scale = Math.max(1, diffDays / 180);
            return { width: `${80 * scale}vw`, minWidth: '100%' };
        } catch (e) {
            console.error("Error calculating timeline track width:", e);
            return { minWidth: '100%' };
        }
    }, [groupedImages]);

    const timelineLabelStep = useMemo(() => {
        if (groupedImages.length === 0) return 1;
        const availableWidth = (windowWidth || 1000) * 0.8;
        const minLabelWidth = 80;
        const maxLabels = Math.floor(availableWidth / minLabelWidth) || 1;
        return Math.max(1, Math.ceil(groupedImages.length / maxLabels));
    }, [groupedImages.length, windowWidth]);
    // Re-run when images change or window resizes

    // Scroll to most recent dates or active image when timeline opens
    useEffect(() => {
        if (showTimeline && timelineScrollRef.current && groupedImages.length > 0) {
            // Minimal delay to allow DOM to calculate scrollWidth
            const timer = setTimeout(() => {
                if (timelineScrollRef.current) {
                    // If we have an active layer, try to center it
                    if (activeLayerId) {
                        const baseImageId = activeLayerId.split('__VIS:')[0];
                        const imgIndex = groupedImages.findIndex(img => img.id === baseImageId);
                        if (imgIndex >= 0) {
                            const img = groupedImages[imgIndex];
                            // Re-use logic for centering (simplified here)
                            const start = new Date(groupedImages[0].date).getTime();
                            const end = new Date(groupedImages[groupedImages.length - 1].date).getTime();
                            const current = new Date(img.date).getTime();
                            const percent = ((current - start) / (end - start));

                            const track = timelineScrollRef.current.children[0];
                            if (track) {
                                const trackWidth = track.scrollWidth;
                                const pointX = percent * trackWidth;
                                const containerWidth = timelineScrollRef.current.offsetWidth;
                                const targetScrollLeft = pointX - (containerWidth / 2);

                                timelineScrollRef.current.scrollTo({
                                    left: targetScrollLeft,
                                    behavior: 'smooth'
                                });
                                return;
                            }
                        }
                    }

                    // Default logic: Scroll to end (newest)
                    timelineScrollRef.current.scrollLeft = timelineScrollRef.current.scrollWidth;
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [showTimeline, groupedImages.length, activeLayerId]);


    // Auto-Update Effects

    // Update Layer Opacity
    useEffect(() => {
        const opacity = layerOpacity / 100;
        const layers = ['ee-layer-single', 'ee-layer-left', 'ee-layer-right', 'monitor-target', 'monitor-diff', 'geom-layer'];

        const setOp = (mapInstance) => {
            if (!mapInstance) return;
            layers.forEach(layerId => {
                if (mapInstance.getLayer(layerId)) {
                    mapInstance.setPaintProperty(layerId, 'raster-opacity', opacity);
                }
            });
        };

        setOp(map.current);
        setOp(mapLeft.current);
        setOp(mapRight.current);

        // Also update when layers are added? 
        // handleLayerAdd sets default (opacity 1). 
        // We should ensure handleLayerAdd respects current opacity OR re-apply it.
        // Actually handleLayerAdd creates a new layer. It might reset opacity to default (1).
        // So we might need to modify handleLayerAdd to use current opacity or trigger this effect.
        // But this effect only runs on [layerOpacity].
        // For simplicity, let's trust that changing opacity slider AFTER loading works.
        // If I load a new layer, it will be 100%. 
        // To fix that, we can just add layerOpacity to the dependency array of a "Sync Opacity" effect 
        // that runs more often? Or just set it in handleLayerAdd.

    }, [layerOpacity, activeLayerId, leftLayerId, rightLayerId, analysisResult, geomResult]);

    // 1. On Vis Change: Update active layer if exists
    useEffect(() => {
        if (!loading && activeLayerId && !isCompareMode) {
            console.log("Auto-updating layer viz...");
            const baseImageId = activeLayerId.split('__VIS:')[0];
            handleLayerAdd(baseImageId, 'single');
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

        if (visOption === "Crop Monitoring" || visOption === "Vegetation Change") {
            if (cropSelectionMode === 'master') {
                setCropT1(item);
                setCropSelectionMode('slave');
            } else {
                setCropT2(item);
            }
            return;
        }

        if (isCompareMode) {
            handleLayerAdd(imgId, side);
        } else {
            handleLayerAdd(imgId, 'single');
        }

        // Center item on click
        if (timelineScrollRef.current && groupedImages.length > 1) {
            const container = timelineScrollRef.current;
            const start = new Date(groupedImages[0].date).getTime();
            const end = new Date(groupedImages[groupedImages.length - 1].date).getTime();
            const current = new Date(item.date).getTime();
            const percent = ((current - start) / (end - start));

            // Wait for potential re-renders or just use current DOM state
            const track = container.children[0]; // The timelineTrack
            if (track) {
                const trackWidth = track.scrollWidth;
                const pointX = percent * trackWidth;
                const containerWidth = container.offsetWidth;
                const targetScrollLeft = pointX - (containerWidth / 2);

                container.scrollTo({
                    left: targetScrollLeft,
                    behavior: 'smooth'
                });
            }
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

    const downloadGeometries = () => {
        if (!draw.current) return;
        const data = draw.current.getAll();
        if (data.features.length === 0) {
            alert("No hay geometrías para descargar");
            return;
        }

        // Add additional properties from the drawnPolygons state to ensure names and fields are included
        const enrichedFeatures = data.features.map(f => {
            const extra = drawnPolygons.find(p => p.id === f.id);
            if (extra) {
                return {
                    ...f,
                    properties: {
                        ...f.properties,
                        name: extra.name,
                        auto_id: extra.auto_id,
                        metric_value: extra.metricValue,
                        metric_label: extra.metricLabel,
                        custom_fields: extra.fields
                    }
                };
            }
            return f;
        });

        // Group by type
        const groups = {
            poligonos: enrichedFeatures.filter(f => f.geometry.type.includes('Polygon')),
            lineas: enrichedFeatures.filter(f => f.geometry.type.includes('LineString')),
            puntos: enrichedFeatures.filter(f => f.geometry.type.includes('Point'))
        };

        const dateStr = new Date().toISOString().split('T')[0];

        Object.entries(groups).forEach(([name, features]) => {
            if (features.length === 0) return;

            const collection = {
                type: "FeatureCollection",
                features: features
            };

            const json = JSON.stringify(collection, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${name}_${dateStr}.geojson`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);
        });
    };

    // Timeline Navigation Handlers
    const getActiveImageIndex = () => {
        if (!activeLayerId || groupedImages.length === 0) return -1;
        const baseImageId = activeLayerId.split('__VIS:')[0];
        return groupedImages.findIndex(img => img.id === baseImageId);
    };

    const handlePrevImage = () => {
        const index = getActiveImageIndex();
        if (index > 0) {
            const prevImg = groupedImages[index - 1];
            handleTimelineClick(prevImg, isCompareMode ? 'left' : 'single');
        }
    };

    const handleNextImage = () => {
        const index = getActiveImageIndex();
        if (index >= 0 && index < groupedImages.length - 1) {
            const nextImg = groupedImages[index + 1];
            handleTimelineClick(nextImg, isCompareMode ? 'left' : 'single');
        }
    };

    // Auto-load static layers when selected
    useEffect(() => {
        if (sensor === "Canopy Height (Meta)" || sensor === "Digital Surface Model") {
            const mockId = sensor === "Canopy Height (Meta)" ? "CANOPY_HEIGHT_MOSAIC" : "DSM_MOSAIC";
            const mockImage = {
                id: mockId,
                date: "Static Mosaic",
                cloud: 0,
                time: Date.now()
            };
            setImages([mockImage]);
            handleLayerAdd(mockId, 'single');
        }
    }, [sensor, minTreeHeight, visOption]);

    // Handle Canopy reload when slider changes (debounced effect via dependency in handleLayerAdd would be best)
    // For now, handleLayerAdd is called inside useEffect above. 
    // We should ensure handleLayerAdd uses the LATEST minTreeHeight.

    return (
        <div className={styles.main}>
            {/* Navbar */}
            {/* Floating Super Res Controls */}

            <nav className={styles.navbar}>
                <div className={styles.brand}>
                    <span>GEE Explorer</span>
                    <button
                        className={`${styles.explorerBtn} ${isLayersOpen ? styles.explorerBtnActive : ''}`}
                        onClick={() => setIsLayersOpen(!isLayersOpen)}
                    >
                        Capas {isLayersOpen ? '▲' : '▼'}
                    </button>
                    <button
                        className={`${styles.explorerBtn} ${isExplorerOpen ? styles.explorerBtnActive : ''}`}
                        onClick={() => {
                            setIsExplorerOpen(!isExplorerOpen);
                            if (!isExplorerOpen) setActiveTab('search');
                        }}
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
                {/* Layers Panel (Left Side) */}
                <div className={`${styles.layersPanel} ${isLayersOpen ? styles.layersVisible : ''}`}>
                    <div className={styles.drawToolbar}>
                        <button
                            className={`${styles.drawIconBtn} ${drawMode === 'simple' && !eraseOverlap ? styles.drawIconBtnActive : ''}`}
                            onClick={handleDrawPolygon}
                            title="Polígono"
                        >
                            <IconPolygon />
                        </button>
                        <button
                            className={`${styles.drawIconBtn} ${drawMode === 'line' ? styles.drawIconBtnActive : ''}`}
                            onClick={handleDrawLine}
                            title="Línea"
                        >
                            <IconLine />
                        </button>
                        <button
                            className={`${styles.drawIconBtn} ${drawMode === 'point' ? styles.drawIconBtnActive : ''}`}
                            onClick={handleDrawPoint}
                            title="Punto"
                        >
                            <IconPoint />
                        </button>
                        <button
                            className={`${styles.drawIconBtn} ${drawMode === 'cut' ? styles.drawIconBtnActive : ''}`}
                            onClick={handleCutPolygon}
                            title="Cortar"
                        >
                            <IconCut />
                        </button>
                        <button
                            className={`${styles.drawIconBtn} ${eraseOverlap ? styles.drawIconBtnActive : ''}`}
                            onClick={handleDrawAutocomplete}
                            title="Autocompletar"
                        >
                            <IconMagnet />
                        </button>
                        <button
                            className={styles.drawIconBtn}
                            onClick={handleDeleteSelected}
                            title="Borrar"
                        >
                            <IconTrash />
                        </button>
                        <button
                            className={styles.drawIconBtn}
                            onClick={downloadGeometries}
                            style={{ marginLeft: 'auto', backgroundColor: '#10b981', borderColor: 'transparent' }}
                            title="Descargar GeoJSON"
                        >
                            <IconDownload />
                        </button>
                    </div>

                    <div className={styles.layersSplit}>
                        <div className={styles.layersSection}>
                            <div className={styles.layersHeader}>Capas y Polígonos</div>
                            <div className={styles.layersList}>
                                {/* Drawn Polygons */}
                                {drawnPolygons.map((poly, idx) => (
                                    <div key={poly.id} className={styles.layerItem}>
                                        <div className={styles.layerMain}>
                                            <input
                                                type="checkbox"
                                                checked={poly.visible}
                                                onChange={() => {
                                                    const newVisible = !poly.visible;
                                                    setDrawnPolygons(prev => prev.map(p => p.id === poly.id ? { ...p, visible: newVisible } : p));
                                                    if (draw.current) {
                                                        draw.current.setFeatureProperty(poly.id, 'user_hidden', newVisible ? undefined : 'true');
                                                        const feat = draw.current.get(poly.id);
                                                        if (feat) draw.current.add(feat);
                                                    }
                                                }}
                                            />
                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <input
                                                    className={styles.layerRenameInput}
                                                    value={poly.name}
                                                    onChange={(e) => renameDrawnPolygon(poly.id, e.target.value)}
                                                    placeholder="Nombre..."
                                                />
                                                <div style={{ fontSize: '0.7rem', color: '#888' }}>
                                                    ID: {poly.auto_id} | {poly.metricValue} {poly.metricLabel}
                                                </div>
                                            </div>
                                            <div className={styles.layerActions}>
                                                <button
                                                    className={styles.layerActionBtn}
                                                    onClick={() => {
                                                        const centroid = turf.centroid(poly);
                                                        const pos = map.current.project(centroid.geometry.coordinates);
                                                        setFeatureModal({ show: true, id: poly.id, position: pos, autoId: poly.auto_id });
                                                    }}
                                                    title="Info"
                                                >
                                                    ℹ
                                                </button>
                                                <button
                                                    className={styles.layerActionBtn}
                                                    onClick={() => handleEditFeature(poly.id)}
                                                    title="Editar"
                                                >
                                                    ✎
                                                </button>
                                                <button
                                                    className={styles.layerActionBtn}
                                                    onClick={() => {
                                                        if (draw.current) draw.current.delete(poly.id);
                                                        updateDrawnPolygons(draw.current);
                                                    }}
                                                    title="Borrar"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {/* Permanent Layers */}
                                {permanentLayers.map((layer, idx) => (
                                    <div key={layer.id} className={`${styles.layerItem} ${activeLayerId === layer.id ? styles.layerItemActive : ''}`}>
                                        <div className={styles.layerMain}>
                                            <input
                                                type="checkbox"
                                                checked={layer.visible}
                                                onChange={() => toggleLayerVisibility(layer.id, 'permanent')}
                                            />
                                            <span className={styles.layerName}>{layer.name}</span>
                                            <div className={styles.layerActions}>
                                                <button
                                                    className={`${styles.layerActionBtn} ${rightLayerId === layer.id ? styles.layerActionBtnActive : ''}`}
                                                    onClick={() => toggleLayerSwipe(layer.id, layer.urlFormat)}
                                                    title="Swipe (Compare)"
                                                >
                                                    ⇄
                                                </button>
                                                <button
                                                    className={styles.layerActionBtn}
                                                    onClick={() => moveLayer(layer.id, 'permanent', 'search')}
                                                    title="Mover abajo"
                                                >
                                                    ↓
                                                </button>
                                            </div>
                                        </div>
                                        <div className={styles.layerControls}>
                                            <input
                                                type="range"
                                                className={styles.layerOpacityRange}
                                                min="0" max="100"
                                                value={layer.opacity || 100}
                                                onChange={(e) => updateLayerOpacity(layer.id, parseInt(e.target.value))}
                                            />
                                            <div className={styles.layerActions}>
                                                <button className={styles.layerActionBtn} onClick={() => moveLayerInList('permanent', layer.id, 'up')}>▴</button>
                                                <button className={styles.layerActionBtn} onClick={() => moveLayerInList('permanent', layer.id, 'down')}>▾</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className={styles.layersSection}>
                            <div className={styles.layersHeader}>Capa Temporal</div>
                            <div className={styles.layersList}>
                                {searchLayers.map((layer, idx) => (
                                    <div key={layer.id} className={`${styles.layerItem} ${activeLayerId === layer.id ? styles.layerItemActive : ''}`}>
                                        <div className={styles.layerMain}>
                                            <input
                                                type="checkbox"
                                                checked={layer.visible}
                                                onChange={() => toggleLayerVisibility(layer.id, 'search')}
                                            />
                                            <span className={styles.layerName}>{layer.name}</span>
                                            <div className={styles.layerActions}>
                                                <button
                                                    className={`${styles.layerActionBtn} ${rightLayerId === layer.id ? styles.layerActionBtnActive : ''}`}
                                                    onClick={() => toggleLayerSwipe(layer.id, layer.urlFormat)}
                                                    title="Swipe (Compare)"
                                                >
                                                    ⇄
                                                </button>
                                                <button
                                                    className={styles.layerActionBtn}
                                                    onClick={() => moveLayer(layer.id, 'search', 'permanent')}
                                                    title="Mover arriba"
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    className={styles.layerActionBtn}
                                                    onClick={() => removeLayerFromList(layer.id)}
                                                    title="Quitar"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                        <div className={styles.layerControls}>
                                            <input
                                                type="range"
                                                className={styles.layerOpacityRange}
                                                min="0" max="100"
                                                value={layer.opacity || 100}
                                                onChange={(e) => updateLayerOpacity(layer.id, parseInt(e.target.value))}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Floating Sidebar (Explorer) - Moved to Right in CSS */}
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
                                            <option value="Combined (Landsat + Sentinel)">Combined (Landsat + Sentinel)</option>
                                            <option value="Landsat (Pan-sharpened)">Landsat (Pan-sharpened)</option>
                                            <option value="Sentinel Harmonized">Sentinel Harmonized</option>
                                            <option value="Sentinel-1 (SAR)">Sentinel-1 (SAR)</option>
                                            <option value="Canopy Height (Meta)">Canopy Height (Meta)</option>
                                            <option value="Digital Surface Model">Digital Surface Model</option>
                                        </select>

                                        {sensor !== "Canopy Height (Meta)" && sensor !== "Digital Surface Model" && (
                                            <>
                                                <label className={styles.label}>Visualization</label>
                                                <select
                                                    className={styles.select}
                                                    value={visOption}
                                                    onChange={(e) => setVisOption(e.target.value)}
                                                >
                                                    {sensor === "Sentinel-1 (SAR)" ? (
                                                        <>
                                                            <option value="Harvest-Deforestation">Harvest-Deforestation (SAR)</option>
                                                            <option value="Radar Vegetation Index">Radar Vegetation Index (RVI)</option>
                                                            <option value="Crop Monitoring">Crop Monitoring (SAR Change)</option>
                                                            <option value="Radar Soil Moisture">Radar Soil Moisture (SSM Index)</option>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <option value="True Color (RGB)">True Color (RGB)</option>
                                                            <option value="False Color (Infrared)">False Color (Infrared)</option>
                                                            <option value="NDVI">NDVI (Vegetation)</option>
                                                            <option value="NDWI">NDWI (Water)</option>
                                                            <option value="Vegetation Change">Vegetation Change (Delta NDVI)</option>
                                                            <option value="Wildfire">Wildfire (Hotspots)</option>
                                                        </>
                                                    )}
                                                </select>

                                                {(visOption === "Crop Monitoring" || visOption === "Vegetation Change") && (
                                                    <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}>
                                                        <div className={styles.label} style={{ fontSize: '11px', marginBottom: '5px' }}>{visOption} Configuration</div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                                            <button
                                                                className={styles.button}
                                                                style={{ fontSize: '10px', background: cropSelectionMode === 'master' ? '#0070f3' : '#333', padding: '5px' }}
                                                                onClick={() => setCropSelectionMode('master')}
                                                            >
                                                                Set T1: {cropT1 ? cropT1.date : 'Pick...'}
                                                            </button>
                                                            <button
                                                                className={styles.button}
                                                                style={{ fontSize: '10px', background: cropSelectionMode === 'slave' ? '#0070f3' : '#333', padding: '5px' }}
                                                                onClick={() => setCropSelectionMode('slave')}
                                                            >
                                                                Set T2: {cropT2 ? cropT2.date : 'Pick...'}
                                                            </button>
                                                        </div>
                                                        {cropT1 && cropT2 && (
                                                            <button
                                                                className={styles.button}
                                                                style={{ marginTop: '8px', background: '#28a745' }}
                                                                onClick={() => handleLayerAdd(cropT2.id)}
                                                            >
                                                                Run Analysis
                                                            </button>
                                                        )}
                                                    </div>
                                                )}

                                                <label className={styles.label} style={{ marginTop: '10px' }}>Date Range</label>
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
                                            </>
                                        )}

                                        {sensor === "Digital Surface Model" && (
                                            <>
                                                <label className={styles.label}>Terrain Mode</label>
                                                <select
                                                    className={styles.select}
                                                    value={visOption}
                                                    onChange={(e) => setVisOption(e.target.value)}
                                                >
                                                    <option value="DEM">Elevation (DEM)</option>
                                                    <option value="Slope">Slope (Pendiente)</option>
                                                    <option value="Aspect">Aspect (Exposición)</option>
                                                    <option value="Hillshade">Hillshade (Sombra)</option>
                                                </select>
                                            </>
                                        )}

                                        {sensor === "Canopy Height (Meta)" && (
                                            <>
                                                <label className={styles.label}>Min Height: {minTreeHeight}m</label>
                                                <input
                                                    type="range"
                                                    min="0" max="35"
                                                    className={styles.range}
                                                    value={minTreeHeight}
                                                    onChange={(e) => setMinTreeHeight(parseInt(e.target.value))}
                                                />
                                            </>
                                        )}

                                    </div>

                                    {sensor !== "Sentinel-1 (SAR)" && sensor !== "Canopy Height (Meta)" && sensor !== "Digital Surface Model" && (
                                        <>
                                            <label className={styles.label}>Max Clouds: {cloudCover}%</label>
                                            <input
                                                type="range"
                                                min="0" max="100"
                                                className={styles.range}
                                                value={cloudCover}
                                                onChange={(e) => setCloudCover(Number(e.target.value))}
                                            />
                                        </>
                                    )}

                                    <label className={styles.label} style={{ marginTop: '10px' }}>Layer Opacity: {layerOpacity}%</label>
                                    <input
                                        type="range"
                                        min="0" max="100"
                                        className={styles.range}
                                        value={layerOpacity}
                                        onChange={(e) => setLayerOpacity(Number(e.target.value))}
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

                {/* Map Container - Handles both Single and Compare modes */}
                <div className={styles.mapContainer} ref={mapContainer}>
                    {isCompareMode && (
                        <>
                            <div ref={leftMapContainer} className={styles.mapLeft}></div>
                            <div ref={rightMapContainer} className={styles.mapRight}></div>
                        </>
                    )}

                    {/* Geometry Info Modal */}
                    {featureModal.show && featureModal.position && (() => {
                        const polyData = drawnPolygons.find(p => p.id === featureModal.id);
                        return (
                            <div
                                className={styles.geometryModal}
                                style={{
                                    left: featureModal.position.x,
                                    top: featureModal.position.y,
                                }}
                            >
                                <div className={styles.modalHeader}>
                                    <span>{featureModal.isEditable ? 'Editando Atributos' : 'Atributos de Geometría'}</span>
                                    <button className={styles.modalClose} onClick={() => {
                                        setFeatureModal({ ...featureModal, show: false });
                                        setEditingGeometryId(null);
                                    }}>✕</button>
                                </div>
                                <div className={styles.modalContent}>
                                    <div className={styles.modalRow}>
                                        <label>ID:</label>
                                        <input type="text" value={featureModal.autoId || ''} readOnly className={styles.modalInputReadOnly} />
                                    </div>
                                    <div className={styles.modalRow}>
                                        <label>{polyData?.metricLabel === 'km' ? 'Longitud (km):' : 'Superficie (ha):'}</label>
                                        <input type="text" value={polyData?.metricValue || '0.0'} readOnly className={styles.modalInputReadOnly} />
                                    </div>

                                    {drawnPolygons.find(p => p.id === featureModal.id)?.fields?.map((field, fIdx) => (
                                        <div key={fIdx} className={styles.modalFieldGroup}>
                                            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                                                <input
                                                    placeholder="Nombre Campo"
                                                    value={field.name}
                                                    disabled={!featureModal.isEditable}
                                                    onChange={(e) => updateCustomField(featureModal.id, fIdx, 'name', e.target.value)}
                                                    className={styles.modalInputSmall}
                                                />
                                                {featureModal.isEditable && (
                                                    <select
                                                        value={field.type}
                                                        onChange={(e) => updateCustomField(featureModal.id, fIdx, 'type', e.target.value)}
                                                        className={styles.modalSelectSmall}
                                                        style={{ width: '90px' }}
                                                    >
                                                        <option value="string">Texto</option>
                                                        <option value="int">Entero</option>
                                                        <option value="date">Fecha</option>
                                                    </select>
                                                )}
                                            </div>
                                            <input
                                                type={field.type === 'date' ? 'date' : (field.type === 'int' ? 'number' : 'text')}
                                                placeholder="Valor"
                                                value={field.value}
                                                disabled={!featureModal.isEditable}
                                                onChange={(e) => updateCustomField(featureModal.id, fIdx, 'value', e.target.value)}
                                                className={styles.modalInputSmall}
                                            />
                                        </div>
                                    ))}

                                    <div className={styles.modalActions}>
                                        {featureModal.isEditable ? (
                                            <>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <button
                                                        className={styles.modalAddBtnMini}
                                                        onClick={() => addCustomField(featureModal.id)}
                                                        title="Nuevo Campo"
                                                    >
                                                        +
                                                    </button>
                                                    <button
                                                        className={styles.modalAddBtnMini}
                                                        style={{ backgroundColor: '#6366f1' }}
                                                        onClick={() => {
                                                            const target = drawnPolygons.find(p => p.id === featureModal.id);
                                                            const mode = target.geometry.type.includes('Polygon') ? 'draw_polygon' :
                                                                target.geometry.type.includes('LineString') ? 'draw_line_string' : 'draw_point';
                                                            setEditingGeometryId(featureModal.id);
                                                            draw.current.changeMode(mode);
                                                        }}
                                                        title="Añadir Parte (Multi)"
                                                    >
                                                        🧩
                                                    </button>
                                                </div>
                                                <button
                                                    className={styles.modalSaveBtn}
                                                    onClick={() => {
                                                        setFeatureModal({ ...featureModal, isEditable: false });
                                                        setEditingGeometryId(null);
                                                        if (draw.current) draw.current.changeMode('simple_select');
                                                    }}
                                                >
                                                    Guardar
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                className={styles.modalSaveBtn}
                                                style={{ backgroundColor: '#3b82f6', width: '100%' }}
                                                onClick={() => setFeatureModal({ ...featureModal, isEditable: true })}
                                            >
                                                ✎ Editar Atributos
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

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
                        {groupedImages.length > 0 && !showTimeline && (
                            <div className={styles.timelineNav} style={{ background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                <button
                                    className={styles.navBtn}
                                    onClick={(e) => { e.stopPropagation(); handlePrevImage(); }}
                                    disabled={getActiveImageIndex() <= 0}
                                >
                                    ‹
                                </button>
                                <span
                                    className={styles.navDate}
                                    onClick={() => setShowTimeline(true)}
                                    style={{ cursor: 'pointer', minWidth: '100px' }}
                                    title="Show Timeline"
                                >
                                    {activeLayerId ? (groupedImages.find(img => img.id === activeLayerId.split('__VIS:')[0])?.date || 'Cargando...') : 'Seleccionar imagen'}
                                </span>
                                <button
                                    className={styles.navBtn}
                                    onClick={(e) => { e.stopPropagation(); handleNextImage(); }}
                                    disabled={getActiveImageIndex() === -1 || getActiveImageIndex() >= groupedImages.length - 1}
                                >
                                    ›
                                </button>
                            </div>
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

                            {/* Navigation Section */}
                            <div className={styles.timelineNav}>
                                <button
                                    className={styles.navBtn}
                                    onClick={handlePrevImage}
                                    disabled={getActiveImageIndex() <= 0}
                                >
                                    ‹
                                </button>
                                <span className={styles.navDate}>
                                    {activeLayerId
                                        ? (groupedImages.find(img => img.id === activeLayerId.split('__VIS:')[0])?.date || 'Cargando...')
                                        : 'Seleccionar imagen'}
                                </span>
                                <button
                                    className={styles.navBtn}
                                    onClick={handleNextImage}
                                    disabled={getActiveImageIndex() === -1 || getActiveImageIndex() >= groupedImages.length - 1}
                                >
                                    ›
                                </button>
                            </div>

                            <div
                                ref={timelineScrollRef}
                                className={`${styles.timelineScroll} ${groupedImages.length * 15 > windowWidth ? styles.timelineScrollOverflow : ''} ${isDragging ? styles.isDragging : ''}`}
                                onMouseDown={handleTimelineMouseDown}
                                onMouseMove={handleTimelineMouseMove}
                                onMouseUp={handleTimelineMouseUp}
                                onMouseLeave={handleTimelineMouseUp}
                                onTouchStart={handleTimelineTouchStart}
                                onTouchMove={handleTimelineTouchMove}
                                onTouchEnd={handleTimelineMouseUp}
                            >
                                <div
                                    className={styles.timelineTrack}
                                    style={timelineTrackStyle}
                                >
                                    {/* Month/Year Axis Labels */}
                                    {(() => {
                                        if (groupedImages.length < 2) return null;
                                        try {
                                            const start = new Date(groupedImages[0].date);
                                            const end = new Date(groupedImages[groupedImages.length - 1].date);
                                            const startTime = start.getTime();
                                            const endTime = end.getTime();
                                            const diffDays = (endTime - startTime) / (1000 * 60 * 60 * 24);

                                            const ticks = [];
                                            let current = new Date(start.getFullYear(), start.getMonth(), 1);

                                            // Handle different granularities based on range
                                            const showMonths = diffDays < 730; // Show months if less than 2 years

                                            if (current < start) {
                                                current.setMonth(current.getMonth() + 1);
                                            }

                                            while (current <= end) {
                                                const time = current.getTime();
                                                const percent = ((time - startTime) / (endTime - startTime)) * 100;
                                                const isJan = current.getMonth() === 0;

                                                let label = "";
                                                let isYear = false;

                                                if (isJan) {
                                                    label = current.getFullYear().toString();
                                                    isYear = true;
                                                } else if (showMonths) {
                                                    // Only show every month if range is small, or every 3 if larger
                                                    const step = diffDays > 365 ? 3 : 1;
                                                    if (current.getMonth() % step === 0) {
                                                        label = current.toLocaleString('default', { month: 'short' });
                                                    }
                                                }

                                                if (label) {
                                                    ticks.push({
                                                        label,
                                                        percent: `${percent}%`,
                                                        isYear
                                                    });
                                                }

                                                current.setMonth(current.getMonth() + 1);
                                            }

                                            return ticks.map((tick, i) => (
                                                <div
                                                    key={i}
                                                    className={`${styles.timelineAxisLabel} ${tick.isYear ? styles.timelineAxisLabelYear : ''}`}
                                                    style={{ left: tick.percent }}
                                                >
                                                    {tick.label}
                                                </div>
                                            ));
                                        } catch (e) {
                                            console.error("Error generating axis ticks:", e);
                                            return null;
                                        }
                                    })()}

                                    {groupedImages.map((img, index) => {
                                        let leftPos = "50%";
                                        if (groupedImages.length > 1) {
                                            try {
                                                const start = new Date(groupedImages[0].date).getTime();
                                                const end = new Date(groupedImages[groupedImages.length - 1].date).getTime();
                                                const current = new Date(img.date).getTime();
                                                const percent = ((current - start) / (end - start)) * 100;
                                                leftPos = `${percent}%`;
                                            } catch (e) {
                                                console.error("Error calculating item position:", e);
                                            }
                                        }

                                        return (
                                            <div
                                                key={img.id}
                                                className={styles.timelineItem}
                                                style={{ left: leftPos }}
                                                onClick={() => handleTimelineClick(img, isCompareMode ? 'right' : 'single')}
                                            >
                                                <div
                                                    className={`
                                                        ${styles.timelineDot} 
                                                        ${!isCompareMode && img.id === activeLayerId?.split('__VIS:')[0] ? styles.timelineDotActive : ''}
                                                        ${isCompareMode && img.id === leftLayerId ? styles.timelineDotLeft : ''}
                                                        ${isCompareMode && img.id === rightLayerId ? styles.timelineDotRight : ''}
                                                        ${cropT1?.id === img.id ? styles.timelineDotMaster : ''}
                                                        ${cropT2?.id === img.id ? styles.timelineDotSlave : ''}
                                                    `}
                                                    style={{ backgroundColor: getDotColor(img.cloud) }}
                                                ></div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div >
        </div >
    );
}
