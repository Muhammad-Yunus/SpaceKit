import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Undo2,
  Redo2,
  HelpCircle,
  Copy,
  Trash2,
  Link2,
} from 'lucide-react';
import type {
  SpaceData,
  EquipmentItem,
  EquipmentKind,
} from '../types/space.ts';
import { Space3DViewer } from './Space3DViewer.tsx';

interface EquipmentEditorProps {
  draftData: SpaceData;
  onChangeDraft: (next: SpaceData) => void;
  onOpenAiChat: () => void;
}

const EQUIPMENT_CATALOG: Array<{
  kind: EquipmentKind;
  name: string;
  length: number;
  width: number;
  height: number;
  elevation?: number;
}> = [
  { kind: 'desk', name: 'Desk', length: 140, width: 70, height: 75 },
  { kind: 'triangular_desk', name: 'Triangular desk', length: 130, width: 60, height: 70 },
  { kind: 'conference_table', name: 'Conference table', length: 240, width: 110, height: 75 },
  { kind: 'office_chair', name: 'Office chair', length: 58, width: 58, height: 95 },
  { kind: 'chair', name: 'Chair', length: 48, width: 48, height: 82 },
  { kind: 'sofa_3', name: '3-seater sofa', length: 210, width: 90, height: 80 },
  { kind: 'sofa_2', name: '2-seater sofa', length: 155, width: 85, height: 80 },
  { kind: 'armchair', name: 'Armchair', length: 82, width: 80, height: 78 },
  { kind: 'coffee_table', name: 'Coffee table', length: 90, width: 90, height: 42 },
  { kind: 'shelves', name: 'Shelves', length: 160, width: 40, height: 185 },
  { kind: 'sink', name: 'Sink', length: 65, width: 50, height: 85 },
  { kind: 'toilet', name: 'Toilet', length: 42, width: 68, height: 78 },
  { kind: 'ac_unit', name: 'AC unit', length: 95, width: 24, height: 30, elevation: 215 },
  { kind: 'bed', name: 'Bed', length: 160, width: 205, height: 85 },
  { kind: 'plant', name: 'Plant', length: 45, width: 45, height: 110 },
];

export const EquipmentEditor: React.FC<EquipmentEditorProps> = ({
  draftData,
  onChangeDraft,
  onOpenAiChat,
}) => {
  const [activeLevelIdx, setActiveLevelIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(
    draftData.levels[0]?.equipment[0]?.id ?? null
  );
  const [rightTab, setRightTab] = useState<'properties' | 'add'>('properties');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [listExpanded, setListExpanded] = useState(true);
  const [lockRatio, setLockRatio] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [undoStack, setUndoStack] = useState<SpaceData[]>([]);
  const [redoStack, setRedoStack] = useState<SpaceData[]>([]);

  const level = draftData.levels[activeLevelIdx] || draftData.levels[0];
  const selectedItem = level.equipment.find((e) => e.id === selectedId) ?? null;

  const filteredCatalog = EQUIPMENT_CATALOG.filter((item) =>
    item.name.toLowerCase().includes(catalogSearch.trim().toLowerCase())
  );

  const handleLevelChange = (nextIdx: number) => {
    setActiveLevelIdx(nextIdx);
    const nextLvl = draftData.levels[nextIdx];
    setSelectedId(nextLvl?.equipment[0]?.id ?? null);
  };

  const commitData = (next: SpaceData) => {
    setUndoStack((u) => [...u.slice(-24), draftData]);
    setRedoStack([]);
    onChangeDraft(next);
  };

  const updateItem = (id: string, patch: Partial<EquipmentItem>) => {
    const nextLevels = draftData.levels.map((l, idx) => {
      if (idx !== activeLevelIdx) return l;
      return {
        ...l,
        equipment: l.equipment.map((eq) =>
          eq.id === id ? { ...eq, ...patch } : eq
        ),
      };
    });
    commitData({ ...draftData, levels: nextLevels });
  };

  const addEquipment = (template: (typeof EQUIPMENT_CATALOG)[number]) => {
    let cx = 0;
    let cz = 0;
    if (level.walls.length > 0) {
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
      if (Number.isFinite(minX)) {
        cx = Number(((minX + maxX) / 2).toFixed(2));
        cz = Number(((minZ + maxZ) / 2).toFixed(2));
      }
    }
    const stagger = (level.equipment.length % 5) * 0.35;
    const newItem: EquipmentItem = {
      id: `eq_${Date.now().toString(36)}`,
      kind: template.kind,
      name: template.name,
      x: Number((cx + stagger).toFixed(2)),
      z: Number((cz + stagger).toFixed(2)),
      elevation: template.elevation ?? 0,
      rotation: 0,
      length: template.length,
      width: template.width,
      height: template.height,
      locatedOutdoors: false,
    };
    const nextLevels = draftData.levels.map((l, idx) =>
      idx === activeLevelIdx
        ? { ...l, equipment: [...l.equipment, newItem] }
        : l
    );
    commitData({ ...draftData, levels: nextLevels });
    setSelectedId(newItem.id);
    setRightTab('properties');
  };

  const duplicateSelected = () => {
    if (!selectedItem) return;
    const copy: EquipmentItem = {
      ...selectedItem,
      id: `eq_${Date.now().toString(36)}`,
      x: Number((selectedItem.x + 0.8).toFixed(2)),
      z: Number((selectedItem.z + 0.8).toFixed(2)),
    };
    const nextLevels = draftData.levels.map((l, idx) =>
      idx === activeLevelIdx
        ? { ...l, equipment: [...l.equipment, copy] }
        : l
    );
    commitData({ ...draftData, levels: nextLevels });
    setSelectedId(copy.id);
  };

  const removeSelected = () => {
    if (!selectedItem) return;
    const nextLevels = draftData.levels.map((l, idx) =>
      idx === activeLevelIdx
        ? { ...l, equipment: l.equipment.filter((e) => e.id !== selectedItem.id) }
        : l
    );
    commitData({ ...draftData, levels: nextLevels });
    setSelectedId(null);
  };

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden bg-[#cfd7df]">
      {/* Left Equipment Hierarchy Sidebar matching Screenshot 4 */}
      <aside className="w-52 shrink-0 bg-white border-r border-[#e5e8ec] flex flex-col overflow-hidden select-none">
        <div className="p-3 border-b border-[#eef1f5]">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <select
                value={activeLevelIdx}
                onChange={(e) => handleLevelChange(Number(e.target.value))}
                className="w-full appearance-none bg-white border border-[#d6dce3] rounded-md px-2.5 py-1.5 pr-7 text-xs font-medium text-[#1f242c]"
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
              onClick={() => setRightTab('add')}
              className="w-8 h-8 border border-[#d6dce3] rounded-md flex items-center justify-center text-slate-600 hover:bg-slate-50"
              title="Add equipment"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 text-xs">
          <button
            type="button"
            onClick={() => setListExpanded((v) => !v)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 font-medium text-[#1f242c] hover:bg-slate-50 rounded"
          >
            {listExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>Equipment ({level.equipment.length})</span>
          </button>

          {listExpanded && (
            <div className="mt-1 space-y-0.5 pl-3">
              {level.equipment.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-slate-400">
                  No equipment placed yet. Switch to "Add equipment" on the right.
                </p>
              ) : (
                level.equipment.map((eq) => (
                  <button
                    key={eq.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(eq.id);
                      setRightTab('properties');
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded transition-colors truncate ${
                      selectedId === eq.id
                        ? 'bg-[#eef2f5] text-[#1f242c] font-medium'
                        : 'text-[#475569] hover:bg-slate-50'
                    }`}
                  >
                    {eq.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Center 3D Viewport matching Screenshot 4 */}
      <div className="relative flex-1 min-w-0 h-full">
        <Space3DViewer
          data={draftData}
          selectedEquipmentId={selectedId}
          onSelectEquipment={(id) => {
            setSelectedId(id);
            if (id) setRightTab('properties');
          }}
          onMoveEquipment={(id, x, z) => updateItem(id, { x, z })}
          interactiveEquipment={true}
          showControlsToolbar={false}
        />

        {/* Bottom Floating Dock matching Screenshot 4 */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          <div className="bg-white border border-[#dce1e7] shadow-md rounded-md p-1 flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                if (undoStack.length === 0) return;
                const prev = undoStack[undoStack.length - 1];
                setUndoStack((u) => u.slice(0, -1));
                setRedoStack((r) => [...r, draftData]);
                onChangeDraft(prev);
              }}
              disabled={undoStack.length === 0}
              className="w-8 h-8 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-35"
              title="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (redoStack.length === 0) return;
                const next = redoStack[redoStack.length - 1];
                setRedoStack((r) => r.slice(0, -1));
                setUndoStack((u) => [...u, draftData]);
                onChangeDraft(next);
              }}
              disabled={redoStack.length === 0}
              className="w-8 h-8 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-35"
              title="Redo"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenAiChat}
            className="bg-[#1f242c] hover:bg-[#2c333e] text-white shadow-md rounded-md w-10 h-10 flex items-center justify-center"
            title="Ask SpaceKit AI to add or arrange equipment"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Right Properties / Add Equipment Inspector matching Screenshot 4 */}
      <aside className="w-72 shrink-0 bg-white border-l border-[#e5e8ec] flex flex-col overflow-hidden">
        <div className="flex items-center border-b border-[#e5e8ec] px-4 pt-2.5 gap-5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setRightTab('properties')}
            className={`pb-2.5 border-b-2 transition-colors ${
              rightTab === 'properties'
                ? 'border-[#1f242c] text-[#1f242c]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Properties
          </button>
          <button
            type="button"
            onClick={() => setRightTab('add')}
            className={`pb-2.5 border-b-2 transition-colors ${
              rightTab === 'add'
                ? 'border-[#1f242c] text-[#1f242c]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Add equipment
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-xs">
          {rightTab === 'properties' ? (
            selectedItem ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-600 w-16 shrink-0">Name</span>
                  <input
                    type="text"
                    value={selectedItem.name}
                    onChange={(e) =>
                      updateItem(selectedItem.id, { name: e.target.value })
                    }
                    className="flex-1 border border-[#d6dce3] rounded px-2.5 py-1.5 text-[#1f242c] focus:outline-none focus:border-[#1f242c]"
                  />
                </div>

                {/* Dimensions */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#1f242c]">Dimensions</span>
                    <button
                      type="button"
                      onClick={() => setLockRatio((r) => !r)}
                      className={`p-1 rounded border text-[11px] flex items-center gap-1 ${
                        lockRatio
                          ? 'bg-[#1f242c] text-white border-[#1f242c]'
                          : 'bg-white text-slate-500 border-[#d6dce3]'
                      }`}
                      title="Lock aspect ratio"
                    >
                      <Link2 className="w-3 h-3" />
                    </button>
                  </div>

                  {(['length', 'width', 'height'] as const).map((dim) => (
                    <div key={dim} className="flex items-center justify-between gap-3">
                      <span className="text-slate-600 capitalize w-16">
                        {dim}
                      </span>
                      <div className="flex flex-1 border border-[#d6dce3] rounded overflow-hidden">
                        <input
                          type="number"
                          value={selectedItem[dim]}
                          onChange={(e) => {
                            const val = Math.max(10, Number(e.target.value) || 10);
                            if (lockRatio && selectedItem[dim] > 0) {
                              const ratio = val / selectedItem[dim];
                              updateItem(selectedItem.id, {
                                length: Math.round(selectedItem.length * ratio),
                                width: Math.round(selectedItem.width * ratio),
                                height: Math.round(selectedItem.height * ratio),
                              });
                            } else {
                              updateItem(selectedItem.id, { [dim]: val });
                            }
                          }}
                          className="w-full px-2.5 py-1.5 tabular-nums text-[#1f242c] focus:outline-none"
                        />
                        <span className="px-2.5 py-1.5 bg-[#f8fafc] border-l border-[#e5e8ec] text-slate-500">
                          cm
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Placement */}
                <div className="space-y-2.5">
                  <span className="block font-semibold text-[#1f242c]">
                    Placement
                  </span>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600 w-16">Elevation</span>
                    <div className="flex flex-1 border border-[#d6dce3] rounded overflow-hidden">
                      <input
                        type="number"
                        value={selectedItem.elevation}
                        onChange={(e) =>
                          updateItem(selectedItem.id, {
                            elevation: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full px-2.5 py-1.5 tabular-nums text-[#1f242c] focus:outline-none"
                      />
                      <span className="px-2.5 py-1.5 bg-[#f8fafc] border-l border-[#e5e8ec] text-slate-500">
                        cm
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600 w-16">Rotation</span>
                    <div className="flex flex-1 border border-[#d6dce3] rounded overflow-hidden">
                      <input
                        type="number"
                        step="15"
                        value={selectedItem.rotation}
                        onChange={(e) =>
                          updateItem(selectedItem.id, {
                            rotation: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full px-2.5 py-1.5 tabular-nums text-[#1f242c] focus:outline-none"
                      />
                      <span className="px-2.5 py-1.5 bg-[#f8fafc] border-l border-[#e5e8ec] text-slate-500">
                        deg
                      </span>
                    </div>
                  </div>

                  <label className="flex items-center justify-between pt-1 cursor-pointer">
                    <span className="text-slate-600">Located outdoors</span>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedItem.locatedOutdoors)}
                      onChange={(e) =>
                        updateItem(selectedItem.id, {
                          locatedOutdoors: e.target.checked,
                        })
                      }
                      className="sr-only peer"
                    />
                    <span className="w-8 h-4.5 bg-slate-200 peer-checked:bg-[#1f242c] rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-3.5 after:h-3.5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-3.5" />
                  </label>
                </div>

                {/* Advanced */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex items-center gap-1.5 font-semibold text-[#1f242c]"
                  >
                    {showAdvanced ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Advanced</span>
                  </button>
                  {showAdvanced && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">
                          Pos X (m)
                        </label>
                        <input
                          type="number"
                          step="0.25"
                          value={selectedItem.x}
                          onChange={(e) =>
                            updateItem(selectedItem.id, {
                              x: Number(e.target.value) || 0,
                            })
                          }
                          className="w-full border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">
                          Pos Z (m)
                        </label>
                        <input
                          type="number"
                          step="0.25"
                          value={selectedItem.z}
                          onChange={(e) =>
                            updateItem(selectedItem.id, {
                              z: Number(e.target.value) || 0,
                            })
                          }
                          className="w-full border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 space-y-2 border-t border-[#eef1f5]">
                  {draftData.levels.length > 1 && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Move to level
                      </label>
                      <select
                        value={activeLevelIdx}
                        onChange={(e) => {
                          const targetIdx = Number(e.target.value);
                          if (targetIdx === activeLevelIdx) return;
                          const itemToMove = selectedItem;
                          const nextLevels = draftData.levels.map((l, idx) => {
                            if (idx === activeLevelIdx) {
                              return {
                                ...l,
                                equipment: l.equipment.filter(
                                  (eq) => eq.id !== itemToMove.id
                                ),
                              };
                            }
                            if (idx === targetIdx) {
                              return {
                                ...l,
                                equipment: [...l.equipment, itemToMove],
                              };
                            }
                            return l;
                          });
                          commitData({ ...draftData, levels: nextLevels });
                          setActiveLevelIdx(targetIdx);
                          setSelectedId(itemToMove.id);
                        }}
                        className="w-full border border-[#d6dce3] rounded px-2.5 py-1.5 bg-white text-[#1f242c]"
                      >
                        {draftData.levels.map((l, idx) => (
                          <option key={l.id} value={idx}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={duplicateSelected}
                    className="w-full py-2 px-3 border border-[#d6dce3] rounded-md font-medium text-[#1f242c] hover:bg-slate-50 flex items-center justify-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Duplicate equipment</span>
                  </button>
                  <button
                    type="button"
                    onClick={removeSelected}
                    className="w-full py-2 px-3 rounded-md font-medium bg-[#dc3545] hover:bg-[#c82333] text-white flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove equipment</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400">
                <p>Click any equipment in the 3D scene or left list to edit its dimensions and placement.</p>
              </div>
            )
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="Filter equipment..."
                className="w-full border border-[#d6dce3] rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#1f242c]"
              />
              <div className="grid grid-cols-2 gap-2">
                {filteredCatalog.map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    onClick={() => addEquipment(item)}
                    className="p-2.5 border border-[#e5e8ec] rounded-md text-left hover:border-[#1f242c] hover:bg-slate-50 transition-colors"
                  >
                    <div className="font-medium text-[#1f242c] truncate">
                      {item.name}
                    </div>
                    <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                      {item.length}×{item.width}cm
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
