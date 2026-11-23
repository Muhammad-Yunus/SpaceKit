import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Radio, Activity, MapPin } from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  SpaceLevel,
  SpatialEntityRecord,
  SpatialEntityStatus,
  SpatialEntityType,
} from '../types/space.ts';

interface EntitiesManagerPanelProps {
  spaceId: string;
  levels: SpaceLevel[];
  entities: SpatialEntityRecord[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  onEntitiesChange: React.Dispatch<React.SetStateAction<SpatialEntityRecord[]>>;
  pickedPoint?: { x: number; z: number } | null;
  locked?: boolean;
  onError?: (msg: string) => void;
}

const ENTITY_TYPES: Array<{ value: SpatialEntityType; label: string }> = [
  { value: 'sensor', label: 'IoT Sensor' },
  { value: 'beacon', label: 'BLE / UWB Beacon' },
  { value: 'asset', label: 'Tracked Asset' },
  { value: 'hvac', label: 'HVAC Unit' },
  { value: 'camera', label: 'Vision Camera' },
  { value: 'zone_occupancy', label: 'Occupancy Counter' },
];

function parseMetadataInput(
  raw: string
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  if (!raw.trim()) return result;
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    if (v === 'true') result[k] = true;
    else if (v === 'false') result[k] = false;
    else if (v !== '' && Number.isFinite(Number(v))) result[k] = Number(v);
    else result[k] = v;
  }
  return result;
}

export const EntitiesManagerPanel: React.FC<EntitiesManagerPanelProps> = ({
  spaceId,
  levels,
  entities,
  selectedEntityId,
  onSelectEntity,
  onEntitiesChange,
  pickedPoint,
  locked = false,
  onError,
}) => {
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState<SpatialEntityType>('sensor');
  const [status, setStatus] = useState<SpatialEntityStatus>('online');
  const [levelId, setLevelId] = useState(levels[0]?.id || 'level_1');
  const [x, setX] = useState<number>(0);
  const [z, setZ] = useState<number>(0);
  const [elevation, setElevation] = useState<number>(1.2);
  const [metaText, setMetaText] = useState('');
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (levels.length > 0 && !levels.some((l) => l.id === levelId)) {
      setLevelId(levels[0].id);
    }
  }, [levels, levelId]);

  useEffect(() => {
    if (pickedPoint) {
      setX(pickedPoint.x);
      setZ(pickedPoint.z);
    }
  }, [pickedPoint]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await api.createEntity(spaceId, {
        name: name.trim(),
        levelId,
        entityType,
        status,
        x,
        z,
        elevation,
        metadata: parseMetadataInput(metaText),
      });
      onEntitiesChange((prev) => [res.entity, ...prev]);
      onSelectEntity(res.entity.id);
      setName('');
      setMetaText('');
      setFormOpen(false);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to create entity.');
    } finally {
      setSaving(false);
    }
  };

  const cycleStatus = async (ent: SpatialEntityRecord) => {
    const nextStatus: SpatialEntityStatus =
      ent.status === 'online'
        ? 'warning'
        : ent.status === 'warning'
        ? 'offline'
        : 'online';
    try {
      const res = await api.updateEntity(spaceId, ent.id, { status: nextStatus });
      onEntitiesChange((prev) =>
        prev.map((item) => (item.id === ent.id ? res.entity : item))
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to update entity.');
    }
  };

  const handleDelete = async (entityId: string) => {
    try {
      await api.deleteEntity(spaceId, entityId);
      onEntitiesChange((prev) => prev.filter((item) => item.id !== entityId));
      if (selectedEntityId === entityId) onSelectEntity(null);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to delete entity.');
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between pb-3 border-b border-[#eef1f5]">
        <div>
          <h2 className="text-sm font-medium text-[#1f242c]">
            Spatial Entities ({entities.length})
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Click anywhere on the 3D floor to pick coordinates, or bind via REST API.
          </p>
        </div>
        <button
          type="button"
          disabled={locked}
          onClick={() => setFormOpen((v) => !v)}
          className="px-2.5 py-1.5 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md font-medium flex items-center gap-1 disabled:opacity-45 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{formOpen ? 'Close' : 'Add entity'}</span>
        </button>
      </div>

      {formOpen && (
        <form
          onSubmit={handleCreate}
          className="p-3.5 bg-[#f8fafc] border border-[#e5e8ec] rounded-md space-y-3"
        >
          <div>
            <label className="block font-medium text-[#1f242c] mb-1">
              Entity name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Temp-Sensor-L1"
              className="w-full bg-white border border-[#d6dce3] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#1f242c]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Type
              </label>
              <select
                value={entityType}
                onChange={(e) =>
                  setEntityType(e.target.value as SpatialEntityType)
                }
                className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1.5"
              >
                {ENTITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as SpatialEntityStatus)
                }
                className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1.5"
              >
                <option value="online">Online</option>
                <option value="warning">Warning</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Level
            </label>
            <select
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
              className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1.5"
            >
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                X (m)
              </label>
              <input
                type="number"
                step="0.2"
                value={x}
                onChange={(e) => setX(Number(e.target.value) || 0)}
                className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Z (m)
              </label>
              <input
                type="number"
                step="0.2"
                value={z}
                onChange={(e) => setZ(Number(e.target.value) || 0)}
                className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Height (m)
              </label>
              <input
                type="number"
                step="0.2"
                min="0.2"
                value={elevation}
                onChange={(e) => setElevation(Number(e.target.value) || 1.2)}
                className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1.5 tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Telemetry attributes (optional)
            </label>
            <input
              type="text"
              value={metaText}
              onChange={(e) => setMetaText(e.target.value)}
              placeholder="e.g. temp=23.5, occupancy=4"
              className="w-full bg-white border border-[#d6dce3] rounded px-2.5 py-1.5"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md font-medium disabled:opacity-50"
          >
            {saving ? 'Saving to PostgreSQL...' : 'Save spatial entity'}
          </button>
        </form>
      )}

      {entities.length === 0 ? (
        <div className="border border-[#e5e8ec] rounded-md p-6 text-center space-y-2">
          <Radio className="w-6 h-6 text-slate-300 mx-auto" />
          <p className="font-medium text-[#1f242c]">No spatial entities yet</p>
          <p className="text-[11px] text-slate-500">
            Place live IoT sensors, beacons, HVAC markers, or tracked assets directly inside this 3D space.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entities.map((ent) => {
            const isSelected = selectedEntityId === ent.id;
            const lvlName =
              levels.find((l) => l.id === ent.levelId)?.name || ent.levelId;
            const metaEntries = Object.entries(ent.metadata || {});
            return (
              <div
                key={ent.id}
                onClick={() => onSelectEntity(ent.id)}
                className={`p-3 border rounded-md cursor-pointer transition-colors space-y-2 ${
                  isSelected
                    ? 'border-[#ea580c] bg-orange-50/40'
                    : 'border-[#e5e8ec] bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#1f242c] truncate">
                      {ent.name}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                      <span className="capitalize">
                        {ent.entityType.replace('_', ' ')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{lvlName}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleStatus(ent);
                      }}
                      title="Click to cycle entity status"
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border flex items-center gap-1 ${
                        ent.status === 'online'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : ent.status === 'warning'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      <Activity className="w-2.5 h-2.5" />
                      <span className="capitalize">{ent.status}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(ent.id);
                      }}
                      className="p-1 text-slate-400 hover:text-red-600"
                      title="Delete entity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 tabular-nums">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  <span>
                    x: {ent.x.toFixed(1)}m, z: {ent.z.toFixed(1)}m, h:{' '}
                    {ent.elevation.toFixed(1)}m
                  </span>
                </div>

                {metaEntries.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {metaEntries.map(([k, v]) => (
                      <span
                        key={k}
                        className="px-1.5 py-0.5 bg-[#f1f4f7] text-[#3b434f] rounded text-[10px] font-mono"
                      >
                        {k}: {String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
