import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MousePointer2,
  PenTool,
  Hand,
  Undo2,
  Redo2,
  ZoomOut,
  Crosshair,
  ZoomIn,
  CloudUpload,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  Settings,
  CheckCircle2,
  DoorOpen,
  Square,
  Trash2,
  Maximize2,
  Layers,
  Tag,
} from 'lucide-react';
import type {
  SpaceData,
  SpaceRecord,
  WallSegment,
  DoorOpening,
  WindowOpening,
  SpaceAnnotation,
} from '../types/space.ts';
import { Space3DViewer } from './Space3DViewer.tsx';

type CadTool = 'select' | 'wall' | 'door' | 'window' | 'annotation' | 'pan';

interface CadEditor2DProps {
  space: SpaceRecord;
  draftData: SpaceData;
  onChangeDraft: (next: SpaceData) => void;
  onPublish: () => Promise<void>;
  onDiscard: () => Promise<void>;
  onOpenCadUpload: () => void;
  onOpenAiChat: () => void;
  onFullPreview: () => void;
  isSaving?: boolean;
}

export const CadEditor2D: React.FC<CadEditor2DProps> = ({
  space,
  draftData,
  onChangeDraft,
  onPublish,
  onDiscard,
  onOpenCadUpload,
  onOpenAiChat,
  onFullPreview,
  isSaving = false,
}) => {
  const [activeLevelIdx, setActiveLevelIdx] = useState(0);
  const [tool, setTool] = useState<CadTool>('select');
  const [rightTab, setRightTab] = useState<'settings' | 'defaults' | 'advanced'>('settings');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    walls: false,
    doors: false,
    windows: false,
    annotations: false,
  });
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedDoorId, setSelectedDoorId] = useState<string | null>(null);
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  // Viewport transform (pixels per meter + pan offset)
  const [pxPerMeter, setPxPerMeter] = useState(34);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [svgSize, setSvgSize] = useState({ width: 800, height: 600 });

  // Drawing state
  const [wallStart, setWallStart] = useState<{ x: number; z: number } | null>(null);
  const [hoverWorld, setHoverWorld] = useState<{ x: number; z: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [draggingNode, setDraggingNode] = useState<{
    wallId: string;
    endpoint: 'start' | 'end';
  } | null>(null);
  const nodeDragSnapshotRef = useRef<SpaceData | null>(null);

  // History for Undo/Redo
  const [undoStack, setUndoStack] = useState<SpaceData[]>([]);
  const [redoStack, setRedoStack] = useState<SpaceData[]>([]);

  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const updateSize = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setSvgSize({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);

    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      setPxPerMeter((p) =>
        Math.max(12, Math.min(90, p * (e.deltaY < 0 ? 1.1 : 0.9)))
      );
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheelNative);
    };
  }, []);

  const level = draftData.levels[activeLevelIdx] || draftData.levels[0];

  const pushChange = (nextData: SpaceData) => {
    setUndoStack((prev) => [...prev.slice(-24), draftData]);
    setRedoStack([]);
    onChangeDraft(nextData);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [...r, draftData]);
    onChangeDraft(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, draftData]);
    onChangeDraft(next);
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, z: 0 };
    const rect = svg.getBoundingClientRect();
    const cx = rect.width / 2 + pan.x;
    const cy = rect.height / 2 + pan.y;
    let wx = (clientX - rect.left - cx) / pxPerMeter;
    let wz = (clientY - rect.top - cy) / pxPerMeter;

    if (draftData.settings.snapToGrid) {
      const step = draftData.settings.gridSize || 0.5;
      wx = Math.round(wx / step) * step;
      wz = Math.round(wz / step) * step;
    }
    return { x: Number(wx.toFixed(2)), z: Number(wz.toFixed(2)) };
  };

  const findNearestWall = (wx: number, wz: number) => {
    let best: { wall: WallSegment; x: number; z: number; angle: number; dist: number } | null = null;
    for (const w of level.walls) {
      const dx = w.x2 - w.x1;
      const dz = w.z2 - w.z1;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 1e-6) continue;
      const t = Math.max(0.05, Math.min(0.95, ((wx - w.x1) * dx + (wz - w.z1) * dz) / lenSq));
      const px = w.x1 + t * dx;
      const pz = w.z1 + t * dz;
      const dist = Math.hypot(wx - px, wz - pz);
      if (dist < 0.7 && (!best || dist < best.dist)) {
        best = {
          wall: w,
          x: Number(px.toFixed(2)),
          z: Number(pz.toFixed(2)),
          angle: Number(((Math.atan2(dz, dx) * 180) / Math.PI).toFixed(1)),
          dist,
        };
      }
    }
    return best;
  };

  const updateLevel = (updater: (lvl: typeof level) => typeof level) => {
    const nextLevels = draftData.levels.map((l, idx) =>
      idx === activeLevelIdx ? updater(l) : l
    );
    pushChange({ ...draftData, levels: nextLevels });
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === 'pan' || e.button === 1) {
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);

    if (tool === 'wall') {
      if (!wallStart) {
        setWallStart(world);
      } else {
        const len = Math.hypot(world.x - wallStart.x, world.z - wallStart.z);
        if (len >= 0.25) {
          const newWall: WallSegment = {
            id: `wall_${Date.now().toString(36)}`,
            x1: wallStart.x,
            z1: wallStart.z,
            x2: world.x,
            z2: world.z,
            height: draftData.settings.wallHeight || 2.8,
            thickness: draftData.settings.wallThickness || 0.18,
            isExterior: true,
          };
          updateLevel((l) => ({ ...l, walls: [...l.walls, newWall] }));
          setWallStart(world);
        }
      }
      return;
    }

    if (tool === 'door') {
      const hit = findNearestWall(world.x, world.z);
      const newDoor: DoorOpening = {
        id: `door_${Date.now().toString(36)}`,
        x: hit ? hit.x : world.x,
        z: hit ? hit.z : world.z,
        width: 0.9,
        height: 2.1,
        angle: hit ? hit.angle : 0,
        swing: 'left',
      };
      updateLevel((l) => ({ ...l, doors: [...l.doors, newDoor] }));
      return;
    }

    if (tool === 'window') {
      const hit = findNearestWall(world.x, world.z);
      const newWin: WindowOpening = {
        id: `win_${Date.now().toString(36)}`,
        x: hit ? hit.x : world.x,
        z: hit ? hit.z : world.z,
        width: 1.6,
        height: 1.4,
        sillHeight: 0.85,
        angle: hit ? hit.angle : 0,
      };
      updateLevel((l) => ({ ...l, windows: [...l.windows, newWin] }));
      return;
    }

    if (tool === 'annotation') {
      const newAnn: SpaceAnnotation = {
        id: `ann_${Date.now().toString(36)}`,
        text: `Zone ${level.annotations.length + 1}`,
        x: world.x,
        z: world.z,
        y: 0.35,
      };
      updateLevel((l) => ({ ...l, annotations: [...l.annotations, newAnn] }));
      setSelectedAnnotationId(newAnn.id);
      setSelectedWallId(null);
      setSelectedDoorId(null);
      setSelectedWindowId(null);
      setTool('select');
      return;
    }

    if (tool === 'select') {
      setSelectedWallId(null);
      setSelectedDoorId(null);
      setSelectedWindowId(null);
      setSelectedAnnotationId(null);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isPanning) {
      setPan({
        x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
      });
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);
    setHoverWorld(world);

    if (draggingNode) {
      const nextLevels = draftData.levels.map((l, idx) => {
        if (idx !== activeLevelIdx) return l;
        return {
          ...l,
          walls: l.walls.map((w) => {
            if (w.id !== draggingNode.wallId) return w;
            return draggingNode.endpoint === 'start'
              ? { ...w, x1: world.x, z1: world.z }
              : { ...w, x2: world.x, z2: world.z };
          }),
        };
      });
      onChangeDraft({ ...draftData, levels: nextLevels });
    }
  };

  const handleSvgPointerUp = () => {
    setIsPanning(false);
    if (draggingNode) {
      if (nodeDragSnapshotRef.current) {
        setUndoStack((prev) => [...prev.slice(-24), nodeDragSnapshotRef.current!]);
        setRedoStack([]);
        nodeDragSnapshotRef.current = null;
      }
      setDraggingNode(null);
    }
  };

  const deleteSelection = () => {
    if (selectedWallId) {
      updateLevel((l) => ({
        ...l,
        walls: l.walls.filter((w) => w.id !== selectedWallId),
      }));
      setSelectedWallId(null);
    } else if (selectedDoorId) {
      updateLevel((l) => ({
        ...l,
        doors: l.doors.filter((d) => d.id !== selectedDoorId),
      }));
      setSelectedDoorId(null);
    } else if (selectedWindowId) {
      updateLevel((l) => ({
        ...l,
        windows: l.windows.filter((w) => w.id !== selectedWindowId),
      }));
      setSelectedWindowId(null);
    } else if (selectedAnnotationId) {
      updateLevel((l) => ({
        ...l,
        annotations: l.annotations.filter((a) => a.id !== selectedAnnotationId),
      }));
      setSelectedAnnotationId(null);
    }
  };

  const selectedWall = level.walls.find((w) => w.id === selectedWallId) ?? null;
  const selectedDoor = level.doors.find((d) => d.id === selectedDoorId) ?? null;
  const selectedWindow = level.windows.find((w) => w.id === selectedWindowId) ?? null;
  const selectedAnnotation =
    level.annotations.find((a) => a.id === selectedAnnotationId) ?? null;

  const stats = useMemo(() => {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const w of level.walls) {
      minX = Math.min(minX, w.x1, w.x2);
      maxX = Math.max(maxX, w.x1, w.x2);
      minZ = Math.min(minZ, w.z1, w.z2);
      maxZ = Math.max(maxZ, w.z1, w.z2);
    }
    const sqm =
      Number.isFinite(minX) && maxX > minX && maxZ > minZ
        ? (maxX - minX) * (maxZ - minZ)
        : 0;
    const sqft = Math.round(sqm * 10.7639);
    const totalEq = draftData.levels.reduce((acc, l) => acc + l.equipment.length, 0);
    const sizeKb = Math.max(
      1,
      Math.ceil(JSON.stringify(draftData).length / 1024)
    );
    return { sqm, sqft, totalEq, sizeKb };
  }, [draftData, level]);

  const hasUnpublished = Boolean(space.unpublishedData);

  const toggleGroup = (k: string) =>
    setExpandedGroups((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden bg-[#eef2f6]">
      {/* Left Structural Inspector Sidebar matching Screenshot 7 */}
      <aside className="w-52 shrink-0 bg-white border-r border-[#e5e8ec] flex flex-col justify-between select-none">
        <div className="p-3 overflow-y-auto">
          <div className="flex items-center gap-1.5 mb-3">
            <div className="relative flex-1">
              <select
                value={activeLevelIdx}
                onChange={(e) => setActiveLevelIdx(Number(e.target.value))}
                className="w-full appearance-none bg-white border border-[#d6dce3] rounded-md px-2.5 py-1.5 pr-7 text-xs font-medium text-[#1f242c] focus:outline-none focus:border-[#1f242c]"
              >
                {draftData.levels.map((l, idx) => (
                  <option key={l.id} value={idx}>
                    {l.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
            </div>
            <button
              type="button"
              onClick={() => {
                const idx = draftData.levels.length + 1;
                pushChange({
                  ...draftData,
                  levels: [
                    ...draftData.levels,
                    {
                      id: `level_${idx}`,
                      name: `Level ${idx}`,
                      elevation: (idx - 1) * 3.0,
                      floorHeight: 2.8,
                      walls: [],
                      doors: [],
                      windows: [],
                      rooms: [],
                      equipment: [],
                      annotations: [],
                      stairs: [],
                    },
                  ],
                });
                setActiveLevelIdx(idx - 1);
              }}
              className="w-8 h-8 border border-[#d6dce3] rounded-md flex items-center justify-center text-slate-600 hover:bg-slate-50"
              title="Add level"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5 text-xs text-[#3b434f]">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-[#f4f6f9] font-medium text-[#1f242c]">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>Floor plan</span>
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggleGroup('walls')}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-50"
              >
                <span className="flex items-center gap-1.5">
                  {expandedGroups.walls ? (
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-slate-400" />
                  )}
                  <span>Walls</span>
                </span>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {level.walls.length}
                </span>
              </button>
              {expandedGroups.walls && (
                <div className="pl-6 space-y-0.5 max-h-36 overflow-y-auto">
                  {level.walls.map((w, i) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        setSelectedWallId(w.id);
                        setSelectedDoorId(null);
                        setSelectedWindowId(null);
                      }}
                      className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center justify-between ${
                        selectedWallId === w.id
                          ? 'bg-amber-50 text-amber-900 font-medium'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span>Wall {i + 1}</span>
                      <span className="tabular-nums text-slate-400">
                        {Math.hypot(w.x2 - w.x1, w.z2 - w.z1).toFixed(1)}m
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggleGroup('doors')}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-50"
              >
                <span className="flex items-center gap-1.5">
                  {expandedGroups.doors ? (
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-slate-400" />
                  )}
                  <span>Doors</span>
                </span>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {level.doors.length}
                </span>
              </button>
              {expandedGroups.doors && (
                <div className="pl-6 space-y-0.5 max-h-28 overflow-y-auto">
                  {level.doors.map((d, i) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        setSelectedDoorId(d.id);
                        setSelectedWallId(null);
                        setSelectedWindowId(null);
                      }}
                      className={`w-full text-left px-2 py-1 rounded text-[11px] ${
                        selectedDoorId === d.id
                          ? 'bg-amber-50 text-amber-900 font-medium'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Door {i + 1} ({d.width.toFixed(1)}m)
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggleGroup('windows')}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-50"
              >
                <span className="flex items-center gap-1.5">
                  {expandedGroups.windows ? (
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-slate-400" />
                  )}
                  <span>Windows</span>
                </span>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {level.windows.length}
                </span>
              </button>
              {expandedGroups.windows && (
                <div className="pl-6 space-y-0.5 max-h-28 overflow-y-auto">
                  {level.windows.map((w, i) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        setSelectedWindowId(w.id);
                        setSelectedWallId(null);
                        setSelectedDoorId(null);
                      }}
                      className={`w-full text-left px-2 py-1 rounded text-[11px] ${
                        selectedWindowId === w.id
                          ? 'bg-amber-50 text-amber-900 font-medium'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Window {i + 1} ({w.width.toFixed(1)}m)
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggleGroup('annotations')}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-50"
              >
                <span className="flex items-center gap-1.5">
                  {expandedGroups.annotations ? (
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-slate-400" />
                  )}
                  <span>Annotations</span>
                </span>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {level.annotations.length + level.rooms.length}
                </span>
              </button>
              {expandedGroups.annotations && (
                <div className="pl-6 space-y-0.5 max-h-36 overflow-y-auto">
                  {level.rooms.map((r) => (
                    <div
                      key={r.id}
                      className="px-2 py-1 text-[11px] text-slate-500 truncate flex items-center justify-between"
                    >
                      <span className="truncate">{r.name}</span>
                      <span className="text-[10px] text-slate-400">room</span>
                    </div>
                  ))}
                  {level.annotations.map((ann) => (
                    <button
                      key={ann.id}
                      type="button"
                      onClick={() => {
                        setSelectedAnnotationId(ann.id);
                        setSelectedWallId(null);
                        setSelectedDoorId(null);
                        setSelectedWindowId(null);
                      }}
                      className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center justify-between ${
                        selectedAnnotationId === ann.id
                          ? 'bg-amber-50 text-amber-900 font-medium'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate">{ann.text}</span>
                      <span className="text-[10px] text-slate-400">label</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-[#e5e8ec]">
          <button
            type="button"
            onClick={() => setRightTab('settings')}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-[#1f242c] bg-[#f4f6f9] hover:bg-[#e9edf2] rounded-md transition-colors"
          >
            <Settings className="w-3.5 h-3.5 text-slate-600" />
            <span>Layout settings</span>
          </button>
        </div>
      </aside>

      {/* Center 2D CAD Canvas matching Screenshot 7 */}
      <div
        className={`relative flex-1 min-w-0 h-full overflow-hidden ${
          draftData.settings.showGrid ? 'cad-grid-bg' : 'bg-[#f4f6f9]'
        }`}
      >
        {/* Status pill at top center */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-white border border-[#e5e8ec] shadow-sm rounded-md px-3 py-1.5 flex items-center gap-2 text-xs font-medium text-[#1f242c]">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>
              {isSaving
                ? 'Saving changes...'
                : hasUnpublished
                ? 'Unpublished draft synced'
                : 'Space loaded'}
            </span>
          </div>
        </div>

        {/* Selected element delete quick action */}
        {(selectedWallId || selectedDoorId || selectedWindowId || selectedAnnotationId) && (
          <div className="absolute top-3 right-4 z-10">
            <button
              type="button"
              onClick={deleteSelection}
              className="bg-white border border-red-200 text-red-600 hover:bg-red-50 shadow-sm rounded-md px-3 py-1.5 text-xs font-medium flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete selected</span>
            </button>
          </div>
        )}

        <svg
          ref={svgRef}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          className={`w-full h-full ${
            tool === 'pan' || isPanning
              ? 'cursor-grab active:cursor-grabbing'
              : tool === 'wall' || tool === 'door' || tool === 'window' || tool === 'annotation'
              ? 'cursor-crosshair'
              : 'cursor-default'
          }`}
        >
          <g
            transform={`translate(${svgSize.width / 2 + pan.x}, ${
              svgSize.height / 2 + pan.y
            })`}
          >
            {/* Optional 2D CAD Image tracing underlay */}
            {level.underlayImageUrl && (
              <image
                href={level.underlayImageUrl}
                x={-10 * (level.underlayScale ?? 1) * pxPerMeter}
                y={-10 * (level.underlayScale ?? 1) * pxPerMeter}
                width={20 * (level.underlayScale ?? 1) * pxPerMeter}
                height={20 * (level.underlayScale ?? 1) * pxPerMeter}
                opacity={level.underlayOpacity ?? 0.25}
                preserveAspectRatio="xMidYMid meet"
              />
            )}

            {/* Room zones */}
            {level.rooms.map((room) => {
              if (room.polygon.length < 3) return null;
              const pts = room.polygon
                .map((p) => `${p.x * pxPerMeter},${p.z * pxPerMeter}`)
                .join(' ');
              const cx =
                (room.polygon.reduce((a, p) => a + p.x, 0) / room.polygon.length) *
                pxPerMeter;
              const cz =
                (room.polygon.reduce((a, p) => a + p.z, 0) / room.polygon.length) *
                pxPerMeter;
              return (
                <g key={room.id}>
                  <polygon
                    points={pts}
                    fill="rgba(255,255,255,0.45)"
                    stroke="#cbd5e1"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                  />
                  <text
                    x={cx}
                    y={cz}
                    textAnchor="middle"
                    className="fill-slate-500 text-[11px] font-medium pointer-events-none select-none"
                  >
                    {room.name}
                  </text>
                </g>
              );
            })}

            {/* Walls */}
            {level.walls.map((w) => {
              const isSel = selectedWallId === w.id;
              return (
                <g key={w.id}>
                  <line
                    x1={w.x1 * pxPerMeter}
                    y1={w.z1 * pxPerMeter}
                    x2={w.x2 * pxPerMeter}
                    y2={w.z2 * pxPerMeter}
                    stroke={isSel ? '#ea580c' : '#4b5563'}
                    strokeWidth={Math.max(4, w.thickness * pxPerMeter)}
                    strokeLinecap="round"
                    onClick={(e) => {
                      if (tool !== 'select') return;
                      e.stopPropagation();
                      setSelectedWallId(w.id);
                      setSelectedDoorId(null);
                      setSelectedWindowId(null);
                      setSelectedAnnotationId(null);
                    }}
                    className="cursor-pointer"
                  />
                  {/* Node handles matching Screenshot 7 */}
                  <circle
                    cx={w.x1 * pxPerMeter}
                    cy={w.z1 * pxPerMeter}
                    r={4.5}
                    fill="#ffffff"
                    stroke={isSel ? '#ea580c' : '#4b5563'}
                    strokeWidth={1.8}
                    onPointerDown={(e) => {
                      if (tool !== 'select') return;
                      e.stopPropagation();
                      nodeDragSnapshotRef.current = draftData;
                      setSelectedWallId(w.id);
                      setSelectedDoorId(null);
                      setSelectedWindowId(null);
                      setSelectedAnnotationId(null);
                      setDraggingNode({ wallId: w.id, endpoint: 'start' });
                    }}
                    className="cursor-move"
                  />
                  <circle
                    cx={w.x2 * pxPerMeter}
                    cy={w.z2 * pxPerMeter}
                    r={4.5}
                    fill="#ffffff"
                    stroke={isSel ? '#ea580c' : '#4b5563'}
                    strokeWidth={1.8}
                    onPointerDown={(e) => {
                      if (tool !== 'select') return;
                      e.stopPropagation();
                      nodeDragSnapshotRef.current = draftData;
                      setSelectedWallId(w.id);
                      setSelectedDoorId(null);
                      setSelectedWindowId(null);
                      setSelectedAnnotationId(null);
                      setDraggingNode({ wallId: w.id, endpoint: 'end' });
                    }}
                    className="cursor-move"
                  />
                </g>
              );
            })}

            {/* Windows */}
            {level.windows.map((win) => {
              const isSel = selectedWindowId === win.id;
              const lenPx = win.width * pxPerMeter;
              return (
                <g
                  key={win.id}
                  transform={`translate(${win.x * pxPerMeter}, ${
                    win.z * pxPerMeter
                  }) rotate(${win.angle})`}
                  onClick={(e) => {
                    if (tool !== 'select') return;
                    e.stopPropagation();
                    setSelectedWindowId(win.id);
                    setSelectedWallId(null);
                    setSelectedDoorId(null);
                    setSelectedAnnotationId(null);
                  }}
                  className="cursor-pointer"
                >
                  <rect
                    x={-lenPx / 2}
                    y={-4}
                    width={lenPx}
                    height={8}
                    fill="#ffffff"
                    stroke={isSel ? '#ea580c' : '#64748b'}
                    strokeWidth={1.5}
                  />
                  <line
                    x1={-lenPx / 2}
                    y1={0}
                    x2={lenPx / 2}
                    y2={0}
                    stroke={isSel ? '#ea580c' : '#94a3b8'}
                    strokeWidth={1}
                  />
                </g>
              );
            })}

            {/* Doors with architectural swing arc matching Screenshot 7 */}
            {level.doors.map((d) => {
              const isSel = selectedDoorId === d.id;
              const rPx = d.width * pxPerMeter;
              return (
                <g
                  key={d.id}
                  transform={`translate(${d.x * pxPerMeter}, ${
                    d.z * pxPerMeter
                  }) rotate(${d.angle})`}
                  onClick={(e) => {
                    if (tool !== 'select') return;
                    e.stopPropagation();
                    setSelectedDoorId(d.id);
                    setSelectedWallId(null);
                    setSelectedWindowId(null);
                    setSelectedAnnotationId(null);
                  }}
                  className="cursor-pointer"
                >
                  <line
                    x1={-rPx / 2}
                    y1={0}
                    x2={rPx / 2}
                    y2={0}
                    stroke="#eef2f6"
                    strokeWidth={8}
                  />
                  <line
                    x1={-rPx / 2}
                    y1={0}
                    x2={-rPx / 2}
                    y2={d.swing === 'right' ? rPx : -rPx}
                    stroke={isSel ? '#ea580c' : '#4b5563'}
                    strokeWidth={1.75}
                  />
                  <path
                    d={
                      d.swing === 'right'
                        ? `M ${-rPx / 2} ${rPx} A ${rPx} ${rPx} 0 0 0 ${rPx / 2} 0`
                        : `M ${-rPx / 2} ${-rPx} A ${rPx} ${rPx} 0 0 1 ${rPx / 2} 0`
                    }
                    fill="none"
                    stroke={isSel ? '#ea580c' : '#64748b'}
                    strokeWidth={1.1}
                  />
                </g>
              );
            })}

            {/* Annotation labels */}
            {level.annotations.map((ann) => {
              const isSel = selectedAnnotationId === ann.id;
              return (
                <g
                  key={ann.id}
                  transform={`translate(${ann.x * pxPerMeter}, ${ann.z * pxPerMeter})`}
                  onClick={(e) => {
                    if (tool !== 'select') return;
                    e.stopPropagation();
                    setSelectedAnnotationId(ann.id);
                    setSelectedWallId(null);
                    setSelectedDoorId(null);
                    setSelectedWindowId(null);
                  }}
                  className="cursor-pointer"
                >
                  <rect
                    x={-36}
                    y={-10}
                    width={72}
                    height={20}
                    rx={4}
                    fill={isSel ? '#fff7ed' : '#ffffff'}
                    stroke={isSel ? '#ea580c' : '#cbd5e1'}
                    strokeWidth={1}
                  />
                  <text
                    x={0}
                    y={4}
                    textAnchor="middle"
                    className={`text-[10px] font-medium select-none ${
                      isSel ? 'fill-amber-900' : 'fill-slate-700'
                    }`}
                  >
                    {ann.text}
                  </text>
                </g>
              );
            })}

            {/* Active Wall Drawing Preview */}
            {tool === 'wall' && wallStart && hoverWorld && (
              <g>
                <line
                  x1={wallStart.x * pxPerMeter}
                  y1={wallStart.z * pxPerMeter}
                  x2={hoverWorld.x * pxPerMeter}
                  y2={hoverWorld.z * pxPerMeter}
                  stroke="#0284c7"
                  strokeWidth={5}
                  strokeDasharray="5 4"
                />
                <text
                  x={((wallStart.x + hoverWorld.x) / 2) * pxPerMeter}
                  y={((wallStart.z + hoverWorld.z) / 2) * pxPerMeter - 10}
                  textAnchor="middle"
                  className="fill-sky-700 text-[11px] font-mono font-semibold"
                >
                  {Math.hypot(
                    hoverWorld.x - wallStart.x,
                    hoverWorld.z - wallStart.z
                  ).toFixed(2)}{' '}
                  m
                </text>
              </g>
            )}
          </g>
        </svg>

        {/* Bottom-right 2m architectural scale bar */}
        <div className="absolute bottom-4 right-5 flex items-center gap-1.5 text-[11px] font-mono text-slate-600 pointer-events-none">
          <span>2m</span>
          <div
            style={{ width: `${Math.round(pxPerMeter * 2)}px` }}
            className="h-1.5 border-b border-l border-r border-slate-500"
          />
        </div>

        {/* Bottom Floating CAD Toolbar matching Screenshot 7 */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          <div className="bg-white border border-[#dce1e7] shadow-md rounded-md p-1 flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                setTool('select');
                setWallStart(null);
              }}
              className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                tool === 'select'
                  ? 'bg-[#e8edf2] text-[#1f242c]'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
              title="Select"
            >
              <MousePointer2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setTool('wall');
                setWallStart(null);
              }}
              className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                tool === 'wall'
                  ? 'bg-[#e8edf2] text-[#1f242c]'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
              title="Draw wall"
            >
              <PenTool className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setTool('door');
                setWallStart(null);
              }}
              className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                tool === 'door'
                  ? 'bg-[#e8edf2] text-[#1f242c]'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
              title="Place door on wall"
            >
              <DoorOpen className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setTool('window');
                setWallStart(null);
              }}
              className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                tool === 'window'
                  ? 'bg-[#e8edf2] text-[#1f242c]'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
              title="Place window on wall"
            >
              <Square className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setTool('annotation');
                setWallStart(null);
              }}
              className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                tool === 'annotation'
                  ? 'bg-[#e8edf2] text-[#1f242c]'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
              title="Place text annotation label"
            >
              <Tag className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setTool('pan');
                setWallStart(null);
              }}
              className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                tool === 'pan'
                  ? 'bg-[#e8edf2] text-[#1f242c]'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
              title="Pan canvas"
            >
              <Hand className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-[#e5e8ec] mx-1" />
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="w-8 h-8 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-35"
              title="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="w-8 h-8 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-35"
              title="Redo"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-white border border-[#dce1e7] shadow-md rounded-md p-1 flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setPxPerMeter((p) => Math.max(12, p * 0.85))}
              className="w-8 h-8 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setPan({ x: 0, y: 0 });
                setPxPerMeter(34);
              }}
              className="w-8 h-8 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50"
              title="Fit to screen"
            >
              <Crosshair className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setPxPerMeter((p) => Math.min(90, p * 1.15))}
              className="w-8 h-8 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenCadUpload}
            className="bg-white border border-[#dce1e7] shadow-md rounded-md w-10 h-10 flex items-center justify-center text-slate-700 hover:bg-slate-50"
            title="Upload 2D CAD image & translate to 3D with AI"
          >
            <CloudUpload className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenAiChat}
            className="bg-[#1f242c] hover:bg-[#2c333e] text-white shadow-md rounded-md w-10 h-10 flex items-center justify-center"
            title="Open SpaceKit AI Copilot"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Right Settings + Live 3D Mini-Preview Sidebar matching Screenshot 7 */}
      <aside className="w-72 shrink-0 bg-white border-l border-[#e5e8ec] flex flex-col justify-between">
        <div className="flex-1 overflow-y-auto">
          {/* Tabs */}
          <div className="flex items-center border-b border-[#e5e8ec] px-3 pt-2 gap-4 text-xs font-medium">
            {(['settings', 'defaults', 'advanced'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightTab(tab)}
                className={`pb-2.5 capitalize border-b-2 transition-colors ${
                  rightTab === tab
                    ? 'border-[#1f242c] text-[#1f242c]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-4">
            <button
              type="button"
              onClick={onFullPreview}
              className="w-full py-2 px-3 border border-[#d6dce3] rounded-md text-xs font-medium text-[#1f242c] hover:bg-slate-50 transition-colors"
            >
              Full preview
            </button>

            {(selectedWall || selectedDoor || selectedWindow || selectedAnnotation) && (
              <div className="p-3 bg-[#f8fafc] border border-[#e5e8ec] rounded-md space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#1f242c]">
                    {selectedWall
                      ? 'Selected Wall'
                      : selectedDoor
                      ? 'Selected Door'
                      : selectedWindow
                      ? 'Selected Window'
                      : 'Selected Label'}
                  </span>
                  <button
                    type="button"
                    onClick={deleteSelection}
                    className="text-red-600 hover:text-red-700 text-[11px] font-medium"
                  >
                    Delete
                  </button>
                </div>

                {selectedWall && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Height (m)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        value={selectedWall.height}
                        onChange={(e) => {
                          const val = Math.max(0.5, Number(e.target.value) || 2.8);
                          updateLevel((l) => ({
                            ...l,
                            walls: l.walls.map((w) =>
                              w.id === selectedWall.id ? { ...w, height: val } : w
                            ),
                          }));
                        }}
                        className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Thickness (m)
                      </label>
                      <input
                        type="number"
                        step="0.02"
                        min="0.05"
                        value={selectedWall.thickness}
                        onChange={(e) => {
                          const val = Math.max(0.05, Number(e.target.value) || 0.18);
                          updateLevel((l) => ({
                            ...l,
                            walls: l.walls.map((w) =>
                              w.id === selectedWall.id ? { ...w, thickness: val } : w
                            ),
                          }));
                        }}
                        className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                      />
                    </div>
                  </div>
                )}

                {selectedDoor && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Width (m)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.4"
                        value={selectedDoor.width}
                        onChange={(e) => {
                          const val = Math.max(0.4, Number(e.target.value) || 0.9);
                          updateLevel((l) => ({
                            ...l,
                            doors: l.doors.map((d) =>
                              d.id === selectedDoor.id ? { ...d, width: val } : d
                            ),
                          }));
                        }}
                        className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Swing
                      </label>
                      <select
                        value={selectedDoor.swing || 'left'}
                        onChange={(e) =>
                          updateLevel((l) => ({
                            ...l,
                            doors: l.doors.map((d) =>
                              d.id === selectedDoor.id
                                ? { ...d, swing: e.target.value as 'left' | 'right' }
                                : d
                            ),
                          }))
                        }
                        className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1"
                      >
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>
                )}

                {selectedWindow && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Width
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.3"
                        value={selectedWindow.width}
                        onChange={(e) => {
                          const val = Math.max(0.3, Number(e.target.value) || 1.6);
                          updateLevel((l) => ({
                            ...l,
                            windows: l.windows.map((w) =>
                              w.id === selectedWindow.id ? { ...w, width: val } : w
                            ),
                          }));
                        }}
                        className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Height
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.3"
                        value={selectedWindow.height}
                        onChange={(e) => {
                          const val = Math.max(0.3, Number(e.target.value) || 1.4);
                          updateLevel((l) => ({
                            ...l,
                            windows: l.windows.map((w) =>
                              w.id === selectedWindow.id ? { ...w, height: val } : w
                            ),
                          }));
                        }}
                        className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Sill (m)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={selectedWindow.sillHeight}
                        onChange={(e) => {
                          const val = Math.max(0, Number(e.target.value) || 0.85);
                          updateLevel((l) => ({
                            ...l,
                            windows: l.windows.map((w) =>
                              w.id === selectedWindow.id ? { ...w, sillHeight: val } : w
                            ),
                          }));
                        }}
                        className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                      />
                    </div>
                  </div>
                )}

                {selectedAnnotation && (
                  <div className="space-y-2">
                    <label className="block text-[11px] text-slate-500">
                      Label text
                    </label>
                    <input
                      type="text"
                      value={selectedAnnotation.text}
                      onChange={(e) =>
                        updateLevel((l) => ({
                          ...l,
                          annotations: l.annotations.map((a) =>
                            a.id === selectedAnnotation.id
                              ? { ...a, text: e.target.value }
                              : a
                          ),
                        }))
                      }
                      className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1"
                    />
                  </div>
                )}
              </div>
            )}

            {rightTab === 'settings' && (
              <>
                <div className="space-y-3 text-xs">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[#3b434f]">Show lower floor</span>
                    <input
                      type="checkbox"
                      checked={draftData.settings.showLowerFloor}
                      onChange={(e) =>
                        pushChange({
                          ...draftData,
                          settings: {
                            ...draftData.settings,
                            showLowerFloor: e.target.checked,
                          },
                        })
                      }
                      className="sr-only peer"
                    />
                    <span className="w-8 h-4.5 bg-slate-200 peer-checked:bg-[#1f242c] rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-3.5 after:h-3.5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-3.5" />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[#3b434f]">Show grid</span>
                    <input
                      type="checkbox"
                      checked={draftData.settings.showGrid}
                      onChange={(e) =>
                        pushChange({
                          ...draftData,
                          settings: {
                            ...draftData.settings,
                            showGrid: e.target.checked,
                          },
                        })
                      }
                      className="sr-only peer"
                    />
                    <span className="w-8 h-4.5 bg-slate-200 peer-checked:bg-[#1f242c] rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-3.5 after:h-3.5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-3.5" />
                  </label>
                </div>

                <div className="text-[11px] leading-relaxed text-slate-500 pt-2 border-t border-[#eef1f5] space-y-1 tabular-nums">
                  <p>
                    This space is {space.status}. Last updated{' '}
                    {new Date(space.updatedAt).toLocaleDateString()}.
                  </p>
                  <p>
                    Area, digitized: {stats.sqft.toLocaleString()}sqft (
                    {stats.sqm.toFixed(2)}sqm)
                  </p>
                  <p>Estimated size: {stats.sizeKb} KB</p>
                  <p>Equipment: {stats.totalEq} pieces</p>
                  <p>
                    Walls: {level.walls.length} · Doors: {level.doors.length} ·
                    Windows: {level.windows.length}
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={onDiscard}
                    disabled={!hasUnpublished}
                    className="w-full py-2 px-3 rounded-md text-xs font-medium bg-[#dc3545] hover:bg-[#c82333] text-white disabled:opacity-45 transition-colors"
                  >
                    Discard unpublished changes
                  </button>
                  <button
                    type="button"
                    onClick={onPublish}
                    className="w-full py-2 px-3 rounded-md text-xs font-medium bg-[#1f242c] hover:bg-[#2c333e] text-white transition-colors"
                  >
                    Publish new version
                  </button>
                </div>
              </>
            )}

            {rightTab === 'defaults' && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-500 mb-1">
                    Default wall height (m)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={draftData.settings.wallHeight}
                    onChange={(e) =>
                      pushChange({
                        ...draftData,
                        settings: {
                          ...draftData.settings,
                          wallHeight: Number(e.target.value) || 2.8,
                        },
                      })
                    }
                    className="w-full border border-[#d6dce3] rounded px-2.5 py-1.5 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">
                    Default wall thickness (m)
                  </label>
                  <input
                    type="number"
                    step="0.02"
                    value={draftData.settings.wallThickness}
                    onChange={(e) =>
                      pushChange({
                        ...draftData,
                        settings: {
                          ...draftData.settings,
                          wallThickness: Number(e.target.value) || 0.18,
                        },
                      })
                    }
                    className="w-full border border-[#d6dce3] rounded px-2.5 py-1.5 tabular-nums"
                  />
                </div>
                <label className="flex items-center justify-between cursor-pointer pt-1">
                  <span className="text-[#3b434f]">Snap to 0.5m grid</span>
                  <input
                    type="checkbox"
                    checked={draftData.settings.snapToGrid}
                    onChange={(e) =>
                      pushChange({
                        ...draftData,
                        settings: {
                          ...draftData.settings,
                          snapToGrid: e.target.checked,
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}

            {rightTab === 'advanced' && (
              <div className="space-y-4 text-xs text-slate-600">
                <p>
                  Upload a 2D CAD floor plan image to automatically re-digitize
                  walls, doors, windows, and equipment using Agentic Vision AI.
                </p>
                <button
                  type="button"
                  onClick={onOpenCadUpload}
                  className="w-full py-2 px-3 border border-[#d6dce3] rounded-md font-medium text-[#1f242c] hover:bg-slate-50"
                >
                  Import 2D CAD Image
                </button>

                {level.underlayImageUrl && (
                  <div className="pt-3 border-t border-[#eef1f5] space-y-3">
                    <div className="font-semibold text-[#1f242c]">
                      2D CAD Underlay Tracing
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span>Opacity</span>
                        <span className="tabular-nums">
                          {Math.round((level.underlayOpacity ?? 0.25) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={level.underlayOpacity ?? 0.25}
                        onChange={(e) =>
                          updateLevel((l) => ({
                            ...l,
                            underlayOpacity: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-[#1f242c]"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span>Underlay scale</span>
                        <span className="tabular-nums">
                          {(level.underlayScale ?? 1).toFixed(2)}×
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.4}
                        max={2.5}
                        step={0.05}
                        value={level.underlayScale ?? 1}
                        onChange={(e) =>
                          updateLevel((l) => ({
                            ...l,
                            underlayScale: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-[#1f242c]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateLevel((l) => ({
                          ...l,
                          underlayImageUrl: undefined,
                        }))
                      }
                      className="w-full py-1.5 px-3 border border-red-200 text-red-600 rounded-md font-medium hover:bg-red-50"
                    >
                      Remove CAD underlay
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom-right Live 3D Mini-Preview matching Screenshot 7 */}
        <div className="relative h-56 border-t border-[#e5e8ec] bg-[#cfd7df]">
          <Space3DViewer
            data={draftData}
            showControlsToolbar={false}
            compactPreview={true}
          />
          <button
            type="button"
            onClick={onFullPreview}
            className="absolute top-2 right-2 w-7 h-7 bg-white border border-[#dce1e7] rounded shadow-sm flex items-center justify-center text-slate-600 hover:text-[#1f242c]"
            title="Expand 3D preview"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>
    </div>
  );
};
