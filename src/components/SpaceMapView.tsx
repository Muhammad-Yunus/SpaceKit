import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  useMap,
  useMapsLibrary,
  type MapMouseEvent,
} from '@vis.gl/react-google-maps';
import {
  MapPin,
  Mail,
  Compass,
  Crosshair,
  Plus,
  Minus,
  Search,
  Check,
  Box,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { SpaceRecord, SpaceData } from '../types/space.ts';

interface SpaceMapViewProps {
  space: SpaceRecord;
  data: SpaceData;
  mode: 'view' | 'edit';
  onStartPlaceOnMap?: () => void;
  onSaveLocation: (patch: {
    address: string | null;
    latitude: number;
    longitude: number;
    geoRotation: number;
    geoScale: number;
  }) => Promise<void>;
  onFinishWizard?: () => void;
}

const ATTRIBUTION_IDS = ['gmp_mcp_codeassist_v1_aistudio'];

function buildFootprintLatLngPaths(
  data: SpaceData,
  lat: number,
  lng: number,
  rotationDeg: number,
  scale: number
): Array<Array<{ lat: number; lng: number }>> {
  const lvl = data.levels[0];
  let minX = -6,
    maxX = 6,
    minZ = -4,
    maxZ = 4;

  if (lvl && lvl.walls.length > 0) {
    minX = Infinity;
    maxX = -Infinity;
    minZ = Infinity;
    maxZ = -Infinity;
    for (const w of lvl.walls) {
      minX = Math.min(minX, w.x1, w.x2);
      maxX = Math.max(maxX, w.x1, w.x2);
      minZ = Math.min(minZ, w.z1, w.z2);
      maxZ = Math.max(maxZ, w.z1, w.z2);
    }
  }

  const metersToLat = 1 / 111320;
  const metersToLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  const rad = (rotationDeg * Math.PI) / 180;

  const projectPoint = (px: number, pz: number) => {
    const sx = px * scale;
    const sz = pz * scale;
    const rx = sx * Math.cos(rad) - sz * Math.sin(rad);
    const rz = sx * Math.sin(rad) + sz * Math.cos(rad);
    return {
      lat: lat - rz * metersToLat,
      lng: lng + rx * metersToLng,
    };
  };

  const outerRing = [
    projectPoint(minX, minZ),
    projectPoint(maxX, minZ),
    projectPoint(maxX, maxZ),
    projectPoint(minX, maxZ),
  ];

  const paths: Array<Array<{ lat: number; lng: number }>> = [outerRing];

  if (lvl && lvl.rooms.length > 0) {
    for (const room of lvl.rooms) {
      if (room.polygon.length >= 3) {
        paths.push(room.polygon.map((pt) => projectPoint(pt.x, pt.z)));
      }
    }
  }

  return paths;
}

interface FootprintOverlayProps {
  paths: Array<Array<{ lat: number; lng: number }>>;
}

interface PolygonLike {
  setMap: (map: unknown) => void;
}

const BuildingFootprintOverlay: React.FC<FootprintOverlayProps> = ({ paths }) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const polygonsRef = useRef<PolygonLike[]>([]);

  useEffect(() => {
    if (!map || !mapsLib) return;

    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    paths.forEach((pathCoords, idx) => {
      const isOuter = idx === 0;
      const polygon = new mapsLib.Polygon({
        paths: pathCoords,
        strokeColor: isOuter ? '#1f242c' : '#475569',
        strokeOpacity: isOuter ? 0.9 : 0.6,
        strokeWeight: isOuter ? 2 : 1,
        fillColor: isOuter ? '#cbd5e1' : '#94a3b8',
        fillOpacity: isOuter ? 0.45 : 0.25,
        clickable: false,
      });
      polygon.setMap(map);
      polygonsRef.current.push(polygon);
    });

    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, mapsLib, paths]);

  return null;
};

interface MapViewportControllerProps {
  lat: number;
  lng: number;
  is3DMap: boolean;
  recenterSignal: number;
  zoomDeltaSignal: { seq: number; delta: number };
}

const MapViewportController: React.FC<MapViewportControllerProps> = ({
  lat,
  lng,
  is3DMap,
  recenterSignal,
  zoomDeltaSignal,
}) => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    map.setTilt(is3DMap ? 45 : 0);
    map.setHeading(is3DMap ? -16 : 0);
  }, [map, is3DMap]);

  useEffect(() => {
    if (!map || recenterSignal === 0) return;
    map.panTo({ lat, lng });
    map.setZoom(18);
  }, [map, recenterSignal, lat, lng]);

  useEffect(() => {
    if (!map || zoomDeltaSignal.seq === 0) return;
    const current = map.getZoom() ?? 16;
    map.setZoom(current + zoomDeltaSignal.delta);
  }, [map, zoomDeltaSignal]);

  return null;
};

export const SpaceMapView: React.FC<SpaceMapViewProps> = ({
  space,
  data,
  mode,
  onStartPlaceOnMap,
  onSaveLocation,
  onFinishWizard,
}) => {
  const defaultLat = space.latitude ?? -6.2615;
  const defaultLng = space.longitude ?? 106.8106;

  const [lat, setLat] = useState<number>(defaultLat);
  const [lng, setLng] = useState<number>(defaultLng);
  const [address, setAddress] = useState<string>(space.address ?? '');
  const [geoRotation, setGeoRotation] = useState<number>(space.geoRotation ?? 0);
  const [geoScale, setGeoScale] = useState<number>(space.geoScale ?? 1);
  const [is3DMap, setIs3DMap] = useState<boolean>(mode === 'view');
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(2);
  const [subCheck, setSubCheck] = useState<0 | 1 | 2>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GMAPS_API_KEY || ''
  );
  const [mapsConfigLoading, setMapsConfigLoading] = useState<boolean>(
    !import.meta.env.VITE_GMAPS_API_KEY
  );
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [zoomDeltaSignal, setZoomDeltaSignal] = useState({ seq: 0, delta: 0 });

  const hasSavedLocation = space.latitude !== null && space.longitude !== null;

  useEffect(() => {
    let cancelled = false;
    api
      .getMapsConfig()
      .then((res) => {
        if (!cancelled && res.apiKey) {
          setMapsApiKey(res.apiKey);
        }
      })
      .catch(() => {
        // Keep env fallback if set
      })
      .finally(() => {
        if (!cancelled) setMapsConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLat(space.latitude ?? -6.2615);
    setLng(space.longitude ?? 106.8106);
    setAddress(space.address ?? '');
    setGeoRotation(space.geoRotation ?? 0);
    setGeoScale(space.geoScale ?? 1);
  }, [space.id, space.latitude, space.longitude, space.address, space.geoRotation, space.geoScale]);

  const footprintPaths = useMemo(
    () => buildFootprintLatLngPaths(data, lat, lng, geoRotation, geoScale),
    [data, lat, lng, geoRotation, geoScale]
  );

  const handleMapClick = (e: MapMouseEvent) => {
    if (mode !== 'edit') return;
    const latLng = e.detail?.latLng;
    if (!latLng) return;
    setLat(Number(latLng.lat.toFixed(6)));
    setLng(Number(latLng.lng.toFixed(6)));
  };

  const handleMarkerDragEnd = (e: {
    latLng?: { lat: () => number; lng: () => number } | null;
  }) => {
    if (mode !== 'edit' || !e.latLng) return;
    setLat(Number(e.latLng.lat().toFixed(6)));
    setLng(Number(e.latLng.lng().toFixed(6)));
  };

  const handleGeocodeSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.geocodeAddress(q);
      if (res.results.length > 0) {
        const first = res.results[0];
        setLat(Number(first.lat.toFixed(6)));
        setLng(Number(first.lng.toFixed(6)));
        setAddress(first.formattedAddress);
        setRecenterSignal((s) => s + 1);
      } else {
        setSearchError('No matching address found.');
      }
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Address lookup failed.'
      );
    } finally {
      setSearching(false);
    }
  };

  const handlePersistLocation = async () => {
    setSaving(true);
    try {
      await onSaveLocation({
        address: address.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        latitude: lat,
        longitude: lng,
        geoRotation,
        geoScale,
      });
      onFinishWizard?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex flex-1 h-full min-h-0 overflow-hidden bg-[#eef2f6]">
      {/* Edit Mode: Left 3-Step Placement Wizard matching Screenshot 3 */}
      {mode === 'edit' && (
        <aside className="w-72 shrink-0 bg-white border-r border-[#e5e8ec] flex flex-col justify-between p-4 z-10 overflow-y-auto">
          <div className="space-y-5">
            {/* Stepper 1 - 2 - 3 */}
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="flex items-center gap-1.5"
              >
                <span className="w-5 h-5 rounded-full border border-[#1f242c] flex items-center justify-center text-[10px]">
                  {wizardStep > 1 ? <Check className="w-3 h-3" /> : '1'}
                </span>
                <span className="font-medium text-[#1f242c]">Locate</span>
              </button>
              <div className="flex-1 h-px bg-[#d6dce3] mx-2" />
              <button
                type="button"
                onClick={() => setWizardStep(2)}
                className="flex items-center gap-1.5"
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                    wizardStep === 2
                      ? 'bg-[#1f242c] text-white'
                      : 'border border-[#d6dce3] text-slate-500'
                  }`}
                >
                  2
                </span>
                <span
                  className={
                    wizardStep === 2
                      ? 'font-semibold text-[#1f242c]'
                      : 'text-slate-500'
                  }
                >
                  Position
                </span>
              </button>
              <div className="flex-1 h-px bg-[#d6dce3] mx-2" />
              <button
                type="button"
                onClick={() => setWizardStep(3)}
                className="flex items-center gap-1.5"
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    wizardStep === 3
                      ? 'bg-[#1f242c] text-white'
                      : 'border border-[#d6dce3] text-slate-400'
                  }`}
                >
                  3
                </span>
                <span
                  className={
                    wizardStep === 3
                      ? 'font-semibold text-[#1f242c]'
                      : 'text-slate-400'
                  }
                >
                  Finalize
                </span>
              </button>
            </div>

            {wizardStep === 1 && (
              <div className="space-y-3 text-xs">
                <div className="bg-[#f4f6f9] rounded-md p-3">
                  <p className="font-semibold text-[#1f242c] mb-1">
                    Search address or click map
                  </p>
                  <p className="text-slate-500">
                    Locate the building plot on Google Maps, or enter GPS coordinates directly.
                  </p>
                </div>

                <form onSubmit={handleGeocodeSearch} className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Search city or street..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 border border-[#d6dce3] rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#1f242c]"
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    className="px-2.5 py-1.5 bg-[#1f242c] text-white rounded-md disabled:opacity-60"
                  >
                    {searching ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                  </button>
                </form>

                {searchError && (
                  <p className="text-[11px] text-red-600">{searchError}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={lat}
                      onChange={(e) => {
                        setLat(Number(e.target.value) || 0);
                        setRecenterSignal((s) => s + 1);
                      }}
                      className="w-full border border-[#d6dce3] rounded px-2 py-1.5 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={lng}
                      onChange={(e) => {
                        setLng(Number(e.target.value) || 0);
                        setRecenterSignal((s) => s + 1);
                      }}
                      className="w-full border border-[#d6dce3] rounded px-2 py-1.5 tabular-nums"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="w-full py-2 bg-[#1f242c] text-white rounded-md font-medium"
                >
                  Confirm location
                </button>
              </div>
            )}

            {wizardStep === 2 && (
              <>
                <div className="bg-[#f4f6f9] rounded-md p-3 text-xs">
                  <p className="font-semibold text-[#1f242c]">
                    Before we continue...
                  </p>
                  <p className="text-slate-600 mt-1">
                    Let&apos;s make sure your space is positioned correctly.
                  </p>
                </div>

                {/* Orientation & Scale sliders */}
                <div className="space-y-3 text-xs border-b border-[#eef1f5] pb-4">
                  <div>
                    <div className="flex justify-between text-slate-600 mb-1">
                      <span>Footprint rotation</span>
                      <span className="tabular-nums font-medium">
                        {geoRotation}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={geoRotation}
                      onChange={(e) => setGeoRotation(Number(e.target.value))}
                      className="w-full accent-[#1f242c]"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-slate-600 mb-1">
                      <span>Footprint scale</span>
                      <span className="tabular-nums font-medium">
                        {geoScale.toFixed(2)}×
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step="0.05"
                      value={geoScale}
                      onChange={(e) => setGeoScale(Number(e.target.value))}
                      className="w-full accent-[#1f242c]"
                    />
                  </div>
                </div>

                {/* 3-item check flow matching Screenshot 3 */}
                <div className="space-y-4 text-xs">
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                        subCheck === 0 ? 'bg-[#1f242c]' : 'bg-slate-300'
                      }`}
                    />
                    <div className="space-y-2">
                      <p className="font-medium text-[#1f242c]">
                        Check if 2D map view looks good
                      </p>
                      {subCheck === 0 && (
                        <>
                          <p className="text-slate-500">
                            Is the floor plan within the plot/building footprint and at right position and scale?
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setIs3DMap(true);
                              setSubCheck(1);
                            }}
                            className="px-3 py-1.5 bg-[#1f242c] text-white rounded text-xs font-medium"
                          >
                            Next
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                        subCheck === 1 ? 'bg-[#1f242c]' : 'bg-slate-300'
                      }`}
                    />
                    <div className="space-y-2">
                      <p className="font-medium text-[#1f242c]">
                        Check if 3D map view looks good
                      </p>
                      {subCheck === 1 && (
                        <button
                          type="button"
                          onClick={() => setSubCheck(2)}
                          className="px-3 py-1.5 bg-[#1f242c] text-white rounded text-xs font-medium"
                        >
                          Next
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                        subCheck === 2 ? 'bg-[#1f242c]' : 'bg-slate-300'
                      }`}
                    />
                    <div className="space-y-2">
                      <p className="font-medium text-[#1f242c]">
                        Check if space preview looks good
                      </p>
                      {subCheck === 2 && (
                        <button
                          type="button"
                          onClick={() => setWizardStep(3)}
                          className="px-3 py-1.5 bg-[#1f242c] text-white rounded text-xs font-medium"
                        >
                          Continue to Finalize
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {wizardStep === 3 && (
              <div className="space-y-3 text-xs">
                <div className="bg-[#f4f6f9] rounded-md p-3">
                  <p className="font-semibold text-[#1f242c]">
                    Ready to save geospatial coordinates
                  </p>
                  <p className="text-slate-500 mt-1 tabular-nums">
                    {lat.toFixed(6)}, {lng.toFixed(6)} · Rot {geoRotation}°
                  </p>
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">
                    Address label
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. Jl. Nangka I No. 12, Jakarta"
                    className="w-full border border-[#d6dce3] rounded px-2.5 py-1.5"
                  />
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handlePersistLocation}
                  className="w-full py-2 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md font-medium disabled:opacity-60"
                >
                  {saving ? 'Saving location...' : 'Save space location'}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[#e5e8ec] gap-2">
            <button
              type="button"
              onClick={() => setWizardStep(1)}
              className="px-3 py-1.5 border border-[#d6dce3] rounded text-xs font-medium text-[#1f242c] hover:bg-slate-50"
            >
              Change position
            </button>
            <button
              type="button"
              onClick={() =>
                wizardStep < 3
                  ? setWizardStep((s) => (s + 1) as 2 | 3)
                  : handlePersistLocation()
              }
              className="px-3 py-1.5 bg-[#1f242c] text-white rounded text-xs font-medium"
            >
              {wizardStep === 3 ? 'Save & finish' : 'Next step'}
            </button>
          </div>
        </aside>
      )}

      {/* Map Canvas */}
      <div className="relative flex-1 h-full">
        {mapsConfigLoading ? (
          <div className="w-full h-full flex items-center justify-center bg-[#eef2f6]">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading Google Maps...</span>
            </div>
          </div>
        ) : !mapsApiKey ? (
          <div className="w-full h-full flex items-center justify-center bg-[#eef2f6] p-6">
            <div className="max-w-md bg-white border border-[#e5e8ec] rounded-lg shadow-sm p-6 text-xs space-y-3">
              <div className="flex items-center gap-2 text-[#1f242c] font-semibold text-sm">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Google Maps API key not configured</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Add <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">GMAPS_API_KEY</code> in{' '}
                <strong>Settings &gt; Secrets</strong> to render interactive Google Maps 2D/3D geospatial placement and address search.
              </p>
              <div className="pt-2 border-t border-[#eef1f5] text-slate-500 tabular-nums">
                Current coordinates: {lat.toFixed(6)}, {lng.toFixed(6)}
              </div>
            </div>
          </div>
        ) : (
          <APIProvider apiKey={mapsApiKey}>
            <GoogleMap
              mapId="DEMO_MAP_ID"
              internalUsageAttributionIds={ATTRIBUTION_IDS}
              defaultCenter={{ lat, lng }}
              defaultZoom={mode === 'view' ? 17 : 14}
              defaultTilt={is3DMap ? 45 : 0}
              defaultHeading={is3DMap ? -16 : 0}
              disableDefaultUI={true}
              gestureHandling="greedy"
              onClick={handleMapClick}
              style={{ width: '100%', height: '100%' }}
            >
              <MapViewportController
                lat={lat}
                lng={lng}
                is3DMap={is3DMap}
                recenterSignal={recenterSignal}
                zoomDeltaSignal={zoomDeltaSignal}
              />
              <BuildingFootprintOverlay paths={footprintPaths} />
              <AdvancedMarker
                position={{ lat, lng }}
                draggable={mode === 'edit'}
                onDragEnd={handleMarkerDragEnd}
                title={space.name}
              >
                <Pin
                  background="#1f242c"
                  borderColor="#ffffff"
                  glyphColor="#ffffff"
                />
              </AdvancedMarker>
            </GoogleMap>
          </APIProvider>
        )}

        {/* View Mode: Floating Space Location Card matching Screenshot 5 */}
        {mode === 'view' && (
          <div className="absolute top-4 left-4 z-10 w-80 bg-white border border-[#e5e8ec] rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#eef1f5]">
              <h3 className="text-sm font-semibold text-[#1f242c]">
                Space location
              </h3>
              {onStartPlaceOnMap && (
                <button
                  type="button"
                  onClick={onStartPlaceOnMap}
                  className="px-2.5 py-1.5 border border-[#d6dce3] rounded-md text-xs font-medium text-[#1f242c] hover:bg-slate-50 flex items-center gap-1.5"
                >
                  <MapPin className="w-3.5 h-3.5 text-slate-600" />
                  <span>Place on map</span>
                </button>
              )}
            </div>

            <div className="pt-3 space-y-2.5 text-xs text-slate-600">
              <div className="flex items-start gap-2.5">
                <Mail className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>{space.address || 'No address was set yet'}</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Compass className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span className="tabular-nums">
                  {hasSavedLocation
                    ? `${space.latitude!.toFixed(5)}, ${space.longitude!.toFixed(5)}`
                    : 'No location was set yet'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Edit Mode: Top-left 2D/3D map badge matching Screenshot 3 */}
        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => setIs3DMap((v) => !v)}
            className="absolute top-4 left-4 z-10 bg-white border border-[#dce1e7] shadow-sm rounded-md px-3 py-1.5 text-xs font-medium text-[#1f242c] hover:bg-slate-50"
          >
            {is3DMap ? '3D map' : '2D map'}
          </button>
        )}

        {/* Right Floating Map Controls matching Screenshot 3 & 5 */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setIs3DMap((v) => !v)}
            className="w-9 h-9 bg-white border border-[#dce1e7] rounded-md shadow-sm flex items-center justify-center text-slate-700 hover:bg-slate-50"
            title="Toggle 2D / 3D map"
          >
            <Box className="w-4 h-4" />
          </button>
          <div className="bg-white border border-[#dce1e7] rounded-md shadow-sm flex flex-col divide-y divide-[#eef1f5]">
            <button
              type="button"
              onClick={() => setRecenterSignal((s) => s + 1)}
              className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-50"
              title="Center on space"
            >
              <Crosshair className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                setZoomDeltaSignal((prev) => ({ seq: prev.seq + 1, delta: 1 }))
              }
              className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-50"
              title="Zoom in"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                setZoomDeltaSignal((prev) => ({ seq: prev.seq + 1, delta: -1 }))
              }
              className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-50"
              title="Zoom out"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
