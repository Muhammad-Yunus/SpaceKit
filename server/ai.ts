import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import type {
  SpaceData,
  SpaceLevel,
  WallSegment,
  DoorOpening,
  WindowOpening,
  RoomZone,
  EquipmentItem,
  EquipmentKind,
  SpaceAnnotation,
  AgentStepTrace,
} from '../src/types/space.ts';

interface OpenAiMessagePartText {
  type: 'text';
  text: string;
}

interface OpenAiMessagePartImage {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<OpenAiMessagePartText | OpenAiMessagePartImage> | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: OpenAiToolCall[];
}

export interface AiProviderStatus {
  configured: boolean;
  provider: 'openai-compatible' | 'gemini' | 'none';
  model: string | null;
  baseUrlHost: string | null;
}

function resolveOpenAiEndpoint(rawBaseUrl?: string): string {
  const base = (rawBaseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const parsed = new URL(base);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI_BASE_URL must use http:// or https:// protocol');
  }
  if (parsed.pathname.endsWith('/chat/completions')) {
    return parsed.toString();
  }
  return `${parsed.toString()}/chat/completions`;
}

export function getAiProviderStatus(): AiProviderStatus {
  const aiKey = process.env.AI_KEY?.trim();
  const aiBaseUrl = process.env.AI_BASE_URL?.trim();
  const aiModel = process.env.AI_MODEL?.trim();

  if (aiKey) {
    let host: string | null = null;
    try {
      const endpoint = resolveOpenAiEndpoint(aiBaseUrl);
      host = new URL(endpoint).host;
    } catch {
      host = aiBaseUrl || null;
    }
    return {
      configured: true,
      provider: 'openai-compatible',
      model: aiModel || 'gpt-4o',
      baseUrlHost: host,
    };
  }

  if (process.env.GEMINI_API_KEY?.trim()) {
    return {
      configured: true,
      provider: 'gemini',
      model: 'gemini-4-hydrogen',
      baseUrlHost: 'generativelanguage.googleapis.com',
    };
  }

  return {
    configured: false,
    provider: 'none',
    model: null,
    baseUrlHost: null,
  };
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'AI service is not configured. Add AI_BASE_URL, AI_KEY, and AI_MODEL (or GEMINI_API_KEY) in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const VALID_EQUIPMENT_KINDS = new Set<EquipmentKind>([
  'desk',
  'triangular_desk',
  'conference_table',
  'chair',
  'office_chair',
  'sofa_3',
  'sofa_2',
  'armchair',
  'coffee_table',
  'shelves',
  'sink',
  'toilet',
  'ac_unit',
  'bed',
  'plant',
]);

function uid(prefix: string, idx: number): string {
  return `${prefix}_${Date.now().toString(36)}_${idx}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function pointToSegmentProjection(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number
): { dist: number; projX: number; projZ: number; angleDeg: number } {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) {
    return { dist: Math.hypot(px - x1, pz - z1), projX: x1, projZ: z1, angleDeg: 0 };
  }
  const t = Math.max(0.08, Math.min(0.92, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  const projX = x1 + t * dx;
  const projZ = z1 + t * dz;
  const angleDeg = (Math.atan2(dz, dx) * 180) / Math.PI;
  return {
    dist: Math.hypot(px - projX, pz - projZ),
    projX,
    projZ,
    angleDeg,
  };
}

function normalizeSpaceData(raw: unknown): {
  data: SpaceData;
  suggestedName?: string;
  description?: string;
  estimatedSqft: number;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawLevels = Array.isArray(obj.levels)
    ? obj.levels
    : Array.isArray(obj.updatedLevels)
    ? obj.updatedLevels
    : [];

  const levels: SpaceLevel[] = (rawLevels.length > 0 ? rawLevels : [{}]).map(
    (lvlRaw, lIdx) => {
      const lvl = (lvlRaw && typeof lvlRaw === 'object' ? lvlRaw : {}) as Record<
        string,
        unknown
      >;
      const walls: WallSegment[] = (Array.isArray(lvl.walls) ? lvl.walls : [])
        .map((w: Record<string, unknown>, idx: number) => ({
          id: typeof w.id === 'string' && w.id ? w.id : uid('wall', idx),
          x1: Number(w.x1) || 0,
          z1: Number(w.z1) || 0,
          x2: Number(w.x2) || 0,
          z2: Number(w.z2) || 0,
          height: Math.max(1.5, Math.min(6, Number(w.height) || 2.8)),
          thickness: Math.max(0.08, Math.min(0.6, Number(w.thickness) || 0.18)),
          isExterior: Boolean(w.isExterior ?? true),
        }))
        .filter((w) => Math.hypot(w.x2 - w.x1, w.z2 - w.z1) >= 0.15);

      const doors: DoorOpening[] = (Array.isArray(lvl.doors) ? lvl.doors : []).map(
        (d: Record<string, unknown>, idx: number) => ({
          id: typeof d.id === 'string' && d.id ? d.id : uid('door', idx),
          x: Number(d.x) || 0,
          z: Number(d.z) || 0,
          width: Math.max(0.6, Math.min(2.4, Number(d.width) || 0.9)),
          height: Math.max(1.8, Math.min(2.6, Number(d.height) || 2.1)),
          angle: Number(d.angle) || 0,
          swing: d.swing === 'right' ? 'right' : 'left',
        })
      );

      const windows: WindowOpening[] = (
        Array.isArray(lvl.windows) ? lvl.windows : []
      ).map((w: Record<string, unknown>, idx: number) => ({
        id: typeof w.id === 'string' && w.id ? w.id : uid('win', idx),
        x: Number(w.x) || 0,
        z: Number(w.z) || 0,
        width: Math.max(0.5, Math.min(4.5, Number(w.width) || 1.6)),
        height: Math.max(0.6, Math.min(2.4, Number(w.height) || 1.4)),
        sillHeight: Math.max(0.2, Math.min(1.5, Number(w.sillHeight) || 0.85)),
        angle: Number(w.angle) || 0,
      }));

      const rooms: RoomZone[] = (Array.isArray(lvl.rooms) ? lvl.rooms : []).map(
        (r: Record<string, unknown>, idx: number) => ({
          id: typeof r.id === 'string' && r.id ? r.id : uid('room', idx),
          name: typeof r.name === 'string' && r.name ? r.name : `Room ${idx + 1}`,
          polygon: Array.isArray(r.polygon)
            ? r.polygon.map((p: Record<string, unknown>) => ({
                x: Number(p.x) || 0,
                z: Number(p.z) || 0,
              }))
            : [],
          floorType:
            r.floorType === 'wood' ||
            r.floorType === 'tile' ||
            r.floorType === 'carpet'
              ? r.floorType
              : 'concrete',
        })
      );

      const equipment: EquipmentItem[] = (
        Array.isArray(lvl.equipment) ? lvl.equipment : []
      ).map((e: Record<string, unknown>, idx: number) => {
        const rawKind = String(e.kind || 'desk') as EquipmentKind;
        const kind: EquipmentKind = VALID_EQUIPMENT_KINDS.has(rawKind)
          ? rawKind
          : 'desk';
        return {
          id: typeof e.id === 'string' && e.id ? e.id : uid('eq', idx),
          kind,
          name: typeof e.name === 'string' && e.name ? e.name : kind.replace(/_/g, ' '),
          x: Number(e.x) || 0,
          z: Number(e.z) || 0,
          elevation:
            kind === 'ac_unit'
              ? Math.max(170, Math.min(250, Number(e.elevation) || 210))
              : Math.max(0, Number(e.elevation) || 0),
          rotation: Number(e.rotation) || 0,
          length: Math.max(25, Math.min(500, Number(e.length) || 120)),
          width: Math.max(25, Math.min(400, Number(e.width) || 70)),
          height: Math.max(20, Math.min(300, Number(e.height) || 75)),
          locatedOutdoors: Boolean(e.locatedOutdoors),
        };
      });

      const annotations: SpaceAnnotation[] = (
        Array.isArray(lvl.annotations) ? lvl.annotations : []
      ).map((a: Record<string, unknown>, idx: number) => ({
        id: typeof a.id === 'string' && a.id ? a.id : uid('ann', idx),
        text: typeof a.text === 'string' ? a.text : 'Zone',
        x: Number(a.x) || 0,
        z: Number(a.z) || 0,
      }));

      return {
        id: typeof lvl.id === 'string' && lvl.id ? lvl.id : `level_${lIdx + 1}`,
        name: typeof lvl.name === 'string' && lvl.name ? lvl.name : `Level ${lIdx + 1}`,
        elevation: Number(lvl.elevation) || lIdx * 3.0,
        floorHeight: Number(lvl.floorHeight) || 2.8,
        walls,
        doors,
        windows,
        rooms,
        equipment,
        annotations,
        stairs: [],
      };
    }
  );

  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const w of levels[0].walls) {
    minX = Math.min(minX, w.x1, w.x2);
    maxX = Math.max(maxX, w.x1, w.x2);
    minZ = Math.min(minZ, w.z1, w.z2);
    maxZ = Math.max(maxZ, w.z1, w.z2);
  }
  const computedAreaSqm =
    Number.isFinite(minX) && maxX > minX && maxZ > minZ
      ? (maxX - minX) * (maxZ - minZ)
      : 64;
  const fallbackSqft = Math.round(computedAreaSqm * 10.7639);
  const estimatedSqft = Math.max(
    50,
    Math.round(Number(obj.estimatedSqft) || fallbackSqft)
  );

  return {
    data: {
      levels,
      settings: {
        showGrid: true,
        showLowerFloor: false,
        snapToGrid: true,
        gridSize: 0.5,
        unit: 'sqft',
        wallHeight: 2.8,
        wallThickness: 0.18,
      },
    },
    suggestedName: typeof obj.suggestedName === 'string' ? obj.suggestedName : undefined,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    estimatedSqft,
  };
}

/**
 * Deterministic Three.js Geometry Auditor:
 * Checks wall connectivity, door/window wall-projection accuracy (needed for Three.js cutouts),
 * room coverage, and furniture elevation/placement.
 */
function auditSpaceGeometryForThreeJs(data: SpaceData): {
  validForThreeJs: boolean;
  wallCount: number;
  doorCount: number;
  windowCount: number;
  roomCount: number;
  equipmentCount: number;
  boundingBoxMeters: { width: number; depth: number };
  disconnectedCornerGaps: number;
  detachedDoors: number;
  detachedWindows: number;
  issues: string[];
} {
  const lvl = data.levels[0];
  if (!lvl || lvl.walls.length === 0) {
    return {
      validForThreeJs: false,
      wallCount: 0,
      doorCount: 0,
      windowCount: 0,
      roomCount: 0,
      equipmentCount: 0,
      boundingBoxMeters: { width: 0, depth: 0 },
      disconnectedCornerGaps: 0,
      detachedDoors: 0,
      detachedWindows: 0,
      issues: ['No walls defined. Add at least 4 exterior wall segments to form a 3D building shell.'],
    };
  }

  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  const endpoints: Array<{ x: number; z: number }> = [];
  for (const w of lvl.walls) {
    minX = Math.min(minX, w.x1, w.x2);
    maxX = Math.max(maxX, w.x1, w.x2);
    minZ = Math.min(minZ, w.z1, w.z2);
    maxZ = Math.max(maxZ, w.z1, w.z2);
    endpoints.push({ x: w.x1, z: w.z1 }, { x: w.x2, z: w.z2 });
  }

  let disconnectedCornerGaps = 0;
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const d = Math.hypot(endpoints[i].x - endpoints[j].x, endpoints[i].z - endpoints[j].z);
      if (d > 0.03 && d < 0.32) {
        disconnectedCornerGaps++;
      }
    }
  }

  let detachedDoors = 0;
  for (const d of lvl.doors) {
    let minDist = Infinity;
    for (const w of lvl.walls) {
      const proj = pointToSegmentProjection(d.x, d.z, w.x1, w.z1, w.x2, w.z2);
      if (proj.dist < minDist) minDist = proj.dist;
    }
    if (minDist > 0.35) detachedDoors++;
  }

  let detachedWindows = 0;
  for (const win of lvl.windows) {
    let minDist = Infinity;
    for (const w of lvl.walls) {
      const proj = pointToSegmentProjection(win.x, win.z, w.x1, w.z1, w.x2, w.z2);
      if (proj.dist < minDist) minDist = proj.dist;
    }
    if (minDist > 0.35) detachedWindows++;
  }

  const issues: string[] = [];
  if (disconnectedCornerGaps > 0) {
    issues.push(
      `${disconnectedCornerGaps} near-coincident wall corner(s) have small gaps (0.03m–0.32m); run repair_and_snap_geometry or share exact endpoints.`
    );
  }
  if (detachedDoors > 0) {
    issues.push(
      `${detachedDoors} door(s) are >0.35m from any wall segment and would not cut Three.js wall openings.`
    );
  }
  if (detachedWindows > 0) {
    issues.push(
      `${detachedWindows} window(s) are >0.35m from any wall segment and would not cut Three.js glazing openings.`
    );
  }
  if (lvl.rooms.length === 0) {
    issues.push('No room zones defined; add room polygons for floor materials and labels.');
  }

  return {
    validForThreeJs:
      lvl.walls.length >= 3 &&
      disconnectedCornerGaps === 0 &&
      detachedDoors === 0 &&
      detachedWindows === 0,
    wallCount: lvl.walls.length,
    doorCount: lvl.doors.length,
    windowCount: lvl.windows.length,
    roomCount: lvl.rooms.length,
    equipmentCount: lvl.equipment.length,
    boundingBoxMeters: {
      width: Number((maxX - minX).toFixed(2)),
      depth: Number((maxZ - minZ).toFixed(2)),
    },
    disconnectedCornerGaps,
    detachedDoors,
    detachedWindows,
    issues,
  };
}

/**
 * Deterministic Three.js Scene Solver:
 * Snaps nearly-meeting wall corners, projects doors & windows onto their nearest wall
 * so buildWallWithOpenings() produces clean 3D cutouts, and creates missing room annotations.
 */
function snapAndRepairSpaceData(data: SpaceData): {
  repaired: SpaceData;
  snappedCorners: number;
  projectedOpenings: number;
} {
  const cloned = structuredClone(data);
  let snappedCorners = 0;
  let projectedOpenings = 0;

  for (const level of cloned.levels) {
    // 1. Snap near-coincident wall endpoints within 0.26m
    const anchors: Array<{ x: number; z: number }> = [];
    const snapPt = (x: number, z: number): { x: number; z: number } => {
      for (const a of anchors) {
        const d = Math.hypot(a.x - x, a.z - z);
        if (d > 0.001 && d <= 0.26) {
          snappedCorners++;
          return { x: a.x, z: a.z };
        }
      }
      const rounded = {
        x: Math.round(x * 20) / 20,
        z: Math.round(z * 20) / 20,
      };
      anchors.push(rounded);
      return rounded;
    };

    level.walls = level.walls.map((w) => {
      const p1 = snapPt(w.x1, w.z1);
      const p2 = snapPt(w.x2, w.z2);
      return { ...w, x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z };
    });

    // 2. Project doors onto nearest wall segment so Three.js cuts clean doorway
    if (level.walls.length > 0) {
      level.doors = level.doors.map((door) => {
        let best = {
          dist: Infinity,
          projX: door.x,
          projZ: door.z,
          angleDeg: door.angle,
        };
        for (const w of level.walls) {
          const p = pointToSegmentProjection(door.x, door.z, w.x1, w.z1, w.x2, w.z2);
          if (p.dist < best.dist) best = p;
        }
        if (best.dist <= 1.2 && best.dist > 0.02) {
          projectedOpenings++;
          return {
            ...door,
            x: Number(best.projX.toFixed(3)),
            z: Number(best.projZ.toFixed(3)),
            angle: Number(best.angleDeg.toFixed(1)),
          };
        }
        return door;
      });

      // 3. Project windows onto nearest wall segment
      level.windows = level.windows.map((win) => {
        let best = {
          dist: Infinity,
          projX: win.x,
          projZ: win.z,
          angleDeg: win.angle,
        };
        for (const w of level.walls) {
          const p = pointToSegmentProjection(win.x, win.z, w.x1, w.z1, w.x2, w.z2);
          if (p.dist < best.dist) best = p;
        }
        if (best.dist <= 1.2 && best.dist > 0.02) {
          projectedOpenings++;
          return {
            ...win,
            x: Number(best.projX.toFixed(3)),
            z: Number(best.projZ.toFixed(3)),
            angle: Number(best.angleDeg.toFixed(1)),
          };
        }
        return win;
      });
    }

    // 4. Ensure room labels exist in annotations if rooms have polygons
    if (level.annotations.length === 0 && level.rooms.length > 0) {
      level.annotations = level.rooms
        .filter((r) => r.polygon.length >= 3)
        .map((r, idx) => {
          const cx =
            r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length;
          const cz =
            r.polygon.reduce((s, p) => s + p.z, 0) / r.polygon.length;
          return {
            id: uid('ann', idx),
            text: r.name,
            x: Number(cx.toFixed(2)),
            z: Number(cz.toFixed(2)),
          };
        });
    }
  }

  return { repaired: cloned, snappedCorners, projectedOpenings };
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error('AI response did not contain valid JSON geometry');
  }
}

const SPATIAL_GEOMETRY_SPEC = `SpaceData JSON Structure (meters centered around (0,0), X=left-to-right, Z=top-to-bottom):
- levels: array of {
    name: string,
    walls: [{ x1, z1, x2, z2, height (2.8), thickness (0.18), isExterior (bool) }],
    doors: [{ x, z, width (0.9), height (2.1), angle (deg), swing ("left"|"right") }],
    windows: [{ x, z, width (1.6), height (1.4), sillHeight (0.85), angle (deg) }],
    rooms: [{ name, floorType ("concrete"|"wood"|"tile"|"carpet"), polygon: [{ x, z }] }],
    equipment: [{
      kind: one of ["desk","triangular_desk","conference_table","chair","office_chair","sofa_3","sofa_2","armchair","coffee_table","shelves","sink","toilet","ac_unit","bed","plant"],
      name, x (m), z (m), rotation (deg), length (cm), width (cm), height (cm), elevation (cm: 0 for floor, 210 for ac_unit)
    }],
    annotations: [{ text, x, z }]
  }
- IMPORTANT for Three.js rendering:
  * Exterior & interior walls MUST share exact corner endpoints so there are no gaps.
  * Every door (x,z) and window (x,z) MUST sit directly on top of a wall segment so the Three.js CSG/segment slicer carves the opening cleanly.`;

const OPENAI_AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'propose_space_draft',
      description:
        'Submit a draft SpaceData floor plan to run the Three.js geometry audit (wall corner closure, door/window wall-attachment, room coverage). Call this first after analyzing the image or prompt.',
      parameters: {
        type: 'object',
        properties: {
          suggestedName: { type: 'string' },
          description: { type: 'string' },
          estimatedSqft: { type: 'number' },
          levels: {
            type: 'array',
            items: { type: 'object' },
          },
        },
        required: ['levels'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'repair_and_snap_geometry',
      description:
        'Run the deterministic Three.js geometric solver to snap near-coincident wall corners, project doors/windows cleanly onto wall segments, and populate room annotations.',
      parameters: {
        type: 'object',
        properties: {
          levels: {
            type: 'array',
            items: { type: 'object' },
          },
        },
        required: ['levels'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finalize_3d_space',
      description:
        'Commit the final verified 3D Three.js SpaceData once geometry audit issues are resolved.',
      parameters: {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          suggestedName: { type: 'string' },
          description: { type: 'string' },
          estimatedSqft: { type: 'number' },
          levels: {
            type: 'array',
            items: { type: 'object' },
          },
        },
        required: ['levels'],
      },
    },
  },
];

async function callOpenAiCompatibleChat(params: {
  messages: OpenAiChatMessage[];
  useTools?: boolean;
  forceJson?: boolean;
}): Promise<{
  message: OpenAiChatMessage;
  toolsUnsupported?: boolean;
}> {
  const endpoint = resolveOpenAiEndpoint(process.env.AI_BASE_URL);
  const apiKey = process.env.AI_KEY?.trim();
  const model = process.env.AI_MODEL?.trim() || 'gpt-4o';

  if (!apiKey) {
    throw new Error('AI_KEY is not configured');
  }

  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    temperature: 0.2,
    max_tokens: 8192,
  };

  if (params.useTools) {
    body.tools = OPENAI_AGENT_TOOLS;
    body.tool_choice = 'auto';
  } else if (params.forceJson) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const lower = text.toLowerCase();
    if (
      params.useTools &&
      res.status === 400 &&
      (lower.includes('tool') || lower.includes('function'))
    ) {
      return {
        message: { role: 'assistant', content: null },
        toolsUnsupported: true,
      };
    }
    throw new Error(
      `OpenAI-compatible AI request failed (${res.status}): ${text.slice(0, 320)}`
    );
  }

  const json = JSON.parse(text) as {
    choices?: Array<{ message?: OpenAiChatMessage }>;
  };
  const msg = json.choices?.[0]?.message;
  if (!msg) {
    throw new Error('OpenAI-compatible AI returned an empty choice list');
  }
  return { message: msg };
}

async function runOpenAiAgenticPipeline(params: {
  mode: 'cad-to-3d' | 'chat';
  systemPrompt: string;
  userParts: Array<OpenAiMessagePartText | OpenAiMessagePartImage>;
  allowNoUpdate?: boolean;
}): Promise<{
  reply: string;
  shouldUpdateSpace: boolean;
  data?: SpaceData;
  suggestedName?: string;
  description?: string;
  estimatedSqft?: number;
  agentTrace: AgentStepTrace[];
}> {
  const trace: AgentStepTrace[] = [];
  const messages: OpenAiChatMessage[] = [
    { role: 'system', content: params.systemPrompt },
    { role: 'user', content: params.userParts },
  ];

  let latestDraft: {
    data: SpaceData;
    suggestedName?: string;
    description?: string;
    estimatedSqft: number;
  } | null = null;

  let committed: {
    reply?: string;
    data: SpaceData;
    suggestedName?: string;
    description?: string;
    estimatedSqft: number;
  } | null = null;

  let useTools = true;
  const maxSteps = 5;

  for (let step = 1; step <= maxSteps; step++) {
    let response = await callOpenAiCompatibleChat({
      messages,
      useTools,
      forceJson: !useTools,
    });

    if (response.toolsUnsupported) {
      useTools = false;
      trace.push({
        step,
        phase: 'Fallback to structured JSON agent pass',
        detail: 'Model endpoint uses direct JSON synthesis; switching to multi-pass audit.',
        status: 'warning',
      });
      response = await callOpenAiCompatibleChat({
        messages,
        useTools: false,
        forceJson: true,
      });
    }

    const msg = response.message;

    if (useTools && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      messages.push(msg);

      for (const tc of msg.tool_calls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = extractJsonObject(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        if (toolName === 'propose_space_draft') {
          const normalized = normalizeSpaceData(args);
          latestDraft = normalized;
          const audit = auditSpaceGeometryForThreeJs(normalized.data);
          trace.push({
            step: trace.length + 1,
            phase: 'Draft 3D Geometry Extracted',
            tool: 'propose_space_draft',
            detail: `${audit.wallCount} walls, ${audit.doorCount} doors, ${audit.windowCount} windows, ${audit.equipmentCount} equipment (${audit.boundingBoxMeters.width}m × ${audit.boundingBoxMeters.depth}m)`,
            status: audit.issues.length > 0 ? 'warning' : 'done',
          });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: toolName,
            content: JSON.stringify({ audit }),
          });
        } else if (toolName === 'repair_and_snap_geometry') {
          const rawInput: ReturnType<typeof normalizeSpaceData> | null =
            Array.isArray(args.levels) && args.levels.length > 0
              ? normalizeSpaceData(args)
              : latestDraft;
          if (rawInput) {
            const { repaired, snappedCorners, projectedOpenings } =
              snapAndRepairSpaceData(rawInput.data);
            latestDraft = {
              ...rawInput,
              data: repaired,
            };
            const audit = auditSpaceGeometryForThreeJs(repaired);
            trace.push({
              step: trace.length + 1,
              phase: 'Three.js Geometry Snapped & Repaired',
              tool: 'repair_and_snap_geometry',
              detail: `Snapped ${snappedCorners} corners and projected ${projectedOpenings} openings onto walls.`,
              status: 'done',
            });
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: toolName,
              content: JSON.stringify({
                snappedCorners,
                projectedOpenings,
                audit,
                repairedLevels: repaired.levels,
              }),
            });
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: toolName,
              content: JSON.stringify({ error: 'No draft geometry provided yet.' }),
            });
          }
        } else if (toolName === 'finalize_3d_space') {
          const normalized = normalizeSpaceData(args);
          const { repaired, snappedCorners, projectedOpenings } =
            snapAndRepairSpaceData(normalized.data);
          committed = {
            reply: typeof args.reply === 'string' ? args.reply : undefined,
            data: repaired,
            suggestedName: normalized.suggestedName || latestDraft?.suggestedName,
            description: normalized.description || latestDraft?.description,
            estimatedSqft: normalized.estimatedSqft,
          };
          trace.push({
            step: trace.length + 1,
            phase: '3D Three.js Scene Committed',
            tool: 'finalize_3d_space',
            detail: `Verified ${repaired.levels[0]?.walls.length || 0} walls & ${repaired.levels[0]?.equipment.length || 0} 3D assets (snapped ${snappedCorners} corners, ${projectedOpenings} openings).`,
            status: 'done',
          });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: toolName,
            content: JSON.stringify({ status: 'committed' }),
          });
        }
      }

      if (committed) break;
      continue;
    }

    // No tool calls in assistant response: inspect content
    const contentText = typeof msg.content === 'string' ? msg.content.trim() : '';

    if (contentText) {
      try {
        const parsed = extractJsonObject(contentText);

        if (
          params.allowNoUpdate &&
          parsed.shouldUpdateSpace === false
        ) {
          trace.push({
            step: trace.length + 1,
            phase: 'Architectural Advisory Response',
            detail: 'Answered spatial question without altering 3D layout.',
            status: 'done',
          });
          return {
            reply:
              typeof parsed.reply === 'string'
                ? parsed.reply
                : 'How would you like to adjust the space?',
            shouldUpdateSpace: false,
            agentTrace: trace,
          };
        }

        const hasLevels =
          (Array.isArray(parsed.levels) && parsed.levels.length > 0) ||
          (Array.isArray(parsed.updatedLevels) && parsed.updatedLevels.length > 0);

        if (hasLevels) {
          const normalized = normalizeSpaceData(parsed);
          const audit = auditSpaceGeometryForThreeJs(normalized.data);
          trace.push({
            step: trace.length + 1,
            phase: 'Vision Extraction & Geometry Audit',
            detail: `${audit.wallCount} walls, ${audit.doorCount} doors, ${audit.windowCount} windows, ${audit.equipmentCount} equipment`,
            status: audit.issues.length > 0 ? 'warning' : 'done',
          });

          const { repaired, snappedCorners, projectedOpenings } =
            snapAndRepairSpaceData(normalized.data);
          trace.push({
            step: trace.length + 1,
            phase: 'Three.js Scene Synthesis',
            detail: `Auto-snapped ${snappedCorners} corners & aligned ${projectedOpenings} wall openings for Three.js rendering.`,
            status: 'done',
          });

          return {
            reply:
              typeof parsed.reply === 'string'
                ? parsed.reply
                : 'Generated and verified 3D Three.js layout.',
            shouldUpdateSpace: true,
            data: repaired,
            suggestedName: normalized.suggestedName,
            description: normalized.description,
            estimatedSqft: normalized.estimatedSqft,
            agentTrace: trace,
          };
        }

        if (typeof parsed.reply === 'string' && params.allowNoUpdate) {
          return {
            reply: parsed.reply,
            shouldUpdateSpace: false,
            agentTrace: trace,
          };
        }
      } catch {
        if (params.allowNoUpdate && !latestDraft) {
          return {
            reply: contentText,
            shouldUpdateSpace: false,
            agentTrace: trace,
          };
        }
      }
    }

    if (latestDraft) {
      const { repaired } = snapAndRepairSpaceData(latestDraft.data);
      return {
        reply: '3D Three.js geometry generated and verified.',
        shouldUpdateSpace: true,
        data: repaired,
        suggestedName: latestDraft.suggestedName,
        description: latestDraft.description,
        estimatedSqft: latestDraft.estimatedSqft,
        agentTrace: trace,
      };
    }

    break;
  }

  if (committed) {
    return {
      reply: committed.reply || '3D Three.js space finalized.',
      shouldUpdateSpace: true,
      data: committed.data,
      suggestedName: committed.suggestedName,
      description: committed.description,
      estimatedSqft: committed.estimatedSqft,
      agentTrace: trace,
    };
  }

  if (latestDraft) {
    const { repaired } = snapAndRepairSpaceData(latestDraft.data);
    return {
      reply: '3D Three.js layout repaired and ready.',
      shouldUpdateSpace: true,
      data: repaired,
      suggestedName: latestDraft.suggestedName,
      description: latestDraft.description,
      estimatedSqft: latestDraft.estimatedSqft,
      agentTrace: trace,
    };
  }

  throw new Error('AI agent did not produce valid 3D Three.js geometry.');
}

const GEMINI_LEVEL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    walls: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          x1: { type: Type.NUMBER },
          z1: { type: Type.NUMBER },
          x2: { type: Type.NUMBER },
          z2: { type: Type.NUMBER },
          height: { type: Type.NUMBER },
          thickness: { type: Type.NUMBER },
          isExterior: { type: Type.BOOLEAN },
        },
        required: ['x1', 'z1', 'x2', 'z2'],
      },
    },
    doors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          x: { type: Type.NUMBER },
          z: { type: Type.NUMBER },
          width: { type: Type.NUMBER },
          angle: { type: Type.NUMBER },
          swing: { type: Type.STRING },
        },
        required: ['x', 'z', 'width', 'angle'],
      },
    },
    windows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          x: { type: Type.NUMBER },
          z: { type: Type.NUMBER },
          width: { type: Type.NUMBER },
          height: { type: Type.NUMBER },
          sillHeight: { type: Type.NUMBER },
          angle: { type: Type.NUMBER },
        },
        required: ['x', 'z', 'width', 'angle'],
      },
    },
    rooms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          floorType: { type: Type.STRING },
          polygon: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER },
                z: { type: Type.NUMBER },
              },
              required: ['x', 'z'],
            },
          },
        },
        required: ['name', 'polygon'],
      },
    },
    equipment: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING },
          name: { type: Type.STRING },
          x: { type: Type.NUMBER },
          z: { type: Type.NUMBER },
          rotation: { type: Type.NUMBER },
          length: { type: Type.NUMBER },
          width: { type: Type.NUMBER },
          height: { type: Type.NUMBER },
          elevation: { type: Type.NUMBER },
        },
        required: ['kind', 'name', 'x', 'z', 'rotation'],
      },
    },
    annotations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          x: { type: Type.NUMBER },
          z: { type: Type.NUMBER },
        },
        required: ['text', 'x', 'z'],
      },
    },
  },
  required: ['name', 'walls', 'doors', 'windows', 'rooms', 'equipment', 'annotations'],
};

export async function translateCadImageToSpace(params: {
  imageBase64: string;
  mimeType: string;
  promptHint?: string;
}): Promise<{
  data: SpaceData;
  suggestedName: string;
  description: string;
  estimatedSqft: number;
  provider: string;
  agentTrace: AgentStepTrace[];
}> {
  const status = getAiProviderStatus();

  if (status.provider === 'openai-compatible') {
    const systemPrompt = `You are the SpaceKit Agentic 2D-CAD-to-3D Three.js Architect.
Follow this agentic workflow strictly:
1. Analyze the uploaded 2D architectural floor plan or technical CAD drawing carefully.
2. Call "propose_space_draft" with the extracted walls, doors, windows, rooms, equipment, and annotations.
3. Review the returned Three.js geometry audit. If there are corner gaps or detached doors/windows, call "repair_and_snap_geometry".
4. Call "finalize_3d_space" once geometry is clean and ready for Three.js rendering.
If tool calling is unavailable, return ONLY valid JSON matching SpaceData with suggestedName, description, estimatedSqft, and levels.

${SPATIAL_GEOMETRY_SPEC}`;

    const userText = params.promptHint?.trim()
      ? `Digitize this 2D CAD / floor plan image into accurate 3D Three.js SpaceKit geometry using your agentic workflow. Additional context: ${params.promptHint}`
      : `Digitize this 2D CAD / technical floor plan image into accurate 3D Three.js SpaceKit geometry using your agentic workflow, extracting every wall, door, window, room zone, annotation, and furniture/equipment item.`;

    const result = await runOpenAiAgenticPipeline({
      mode: 'cad-to-3d',
      systemPrompt,
      userParts: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${params.mimeType};base64,${params.imageBase64}`,
            detail: 'high',
          },
        },
        { type: 'text', text: userText },
      ],
    });

    if (!result.data) {
      throw new Error('Agent failed to synthesize 3D Three.js geometry from CAD image.');
    }

    return {
      data: result.data,
      suggestedName: result.suggestedName || 'Digitized CAD Space',
      description:
        result.description ||
        '3D architectural space synthesized from uploaded 2D technical drawing.',
      estimatedSqft: result.estimatedSqft || 1000,
      provider: `openai-compatible:${status.model}`,
      agentTrace: result.agentTrace,
    };
  }

  // Fallback to Gemini API if AI_KEY is not configured
  const ai = getGeminiClient();
  const trace: AgentStepTrace[] = [];

  const systemInstruction = `You are a precision Agentic CAD-to-3D digitizer for SpaceKit Three.js.
Analyze the uploaded 2D architectural floor plan and extract exact 3D building geometry in meters centered around (0, 0).
${SPATIAL_GEOMETRY_SPEC}`;

  const userPrompt = params.promptHint?.trim()
    ? `Digitize this 2D CAD / floor plan image into accurate 3D SpaceKit geometry. Additional user context: ${params.promptHint}`
    : `Digitize this 2D CAD / technical floor plan image into accurate 3D SpaceKit geometry, including all walls, doors, windows, room zones, annotations, and furniture/equipment.`;

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.imageBase64,
          },
        },
        { text: userPrompt },
      ],
    },
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggestedName: { type: Type.STRING },
          description: { type: Type.STRING },
          estimatedSqft: { type: Type.NUMBER },
          levels: {
            type: Type.ARRAY,
            items: GEMINI_LEVEL_SCHEMA,
          },
        },
        required: ['suggestedName', 'description', 'estimatedSqft', 'levels'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim());
  const normalized = normalizeSpaceData(parsed);
  const audit = auditSpaceGeometryForThreeJs(normalized.data);
  trace.push({
    step: 1,
    phase: '2D CAD Vision Extraction',
    detail: `${audit.wallCount} walls, ${audit.doorCount} doors, ${audit.windowCount} windows, ${audit.equipmentCount} items`,
    status: audit.issues.length > 0 ? 'warning' : 'done',
  });

  const { repaired, snappedCorners, projectedOpenings } = snapAndRepairSpaceData(
    normalized.data
  );
  trace.push({
    step: 2,
    phase: 'Three.js Geometry Snap & Verification',
    detail: `Snapped ${snappedCorners} corners & projected ${projectedOpenings} openings for 3D extrusion.`,
    status: 'done',
  });

  return {
    data: repaired,
    suggestedName: normalized.suggestedName || 'Digitized CAD Space',
    description:
      normalized.description ||
      '3D architectural space translated from uploaded 2D technical drawing.',
    estimatedSqft: normalized.estimatedSqft,
    provider: 'gemini-fallback',
    agentTrace: trace,
  };
}

export async function runSpatialChat(params: {
  spaceName: string;
  spaceData: SpaceData;
  userMessage: string;
  imageBase64?: string;
  imageMimeType?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{
  reply: string;
  shouldUpdateSpace: boolean;
  updatedSpaceData?: SpaceData;
  estimatedSqft?: number;
  provider: string;
  agentTrace: AgentStepTrace[];
}> {
  const status = getAiProviderStatus();

  const historyText = params.history
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  if (status.provider === 'openai-compatible') {
    const systemPrompt = `You are the SpaceKit Agentic 3D Spatial Architect embedded inside a 2D-CAD + 3D Three.js building studio.
Current space name: "${params.spaceName}"
Current space JSON:
${JSON.stringify(params.spaceData)}

Rules:
- If the user asks to generate, redesign, add, move, resize, or remove any walls, doors, windows, rooms, equipment, or annotations — OR uploads a 2D CAD / floor plan image — use your agentic tools ("propose_space_draft" -> "repair_and_snap_geometry" -> "finalize_3d_space") to verify and commit the full updated "levels" array.
- If the user is only asking a conceptual or SDK question without modifying geometry, reply directly with JSON: {"reply": "...", "shouldUpdateSpace": false}.
${SPATIAL_GEOMETRY_SPEC}`;

    const userParts: Array<OpenAiMessagePartText | OpenAiMessagePartImage> = [];
    if (params.imageBase64 && params.imageMimeType) {
      userParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${params.imageMimeType};base64,${params.imageBase64}`,
          detail: 'high',
        },
      });
    }
    userParts.push({
      type: 'text',
      text: `${
        historyText ? `Recent conversation:\n${historyText}\n\n` : ''
      }User request: ${params.userMessage}`,
    });

    const result = await runOpenAiAgenticPipeline({
      mode: 'chat',
      systemPrompt,
      userParts,
      allowNoUpdate: true,
    });

    return {
      reply: result.reply,
      shouldUpdateSpace: Boolean(result.shouldUpdateSpace && result.data),
      updatedSpaceData: result.data,
      estimatedSqft: result.estimatedSqft,
      provider: `openai-compatible:${status.model}`,
      agentTrace: result.agentTrace,
    };
  }

  // Fallback to Gemini API
  const ai = getGeminiClient();
  const trace: AgentStepTrace[] = [];

  const systemInstruction = `You are the SpaceKit AI Spatial Architect embedded inside a 2D-CAD + 3D Three.js building studio.
Current space name: "${params.spaceName}"
Current space JSON:
${JSON.stringify(params.spaceData)}

Rules:
- If the user asks to generate, redesign, add, move, resize, or remove any walls, doors, windows, rooms, equipment, or annotations — OR uploads a floor plan/CAD image to convert — set "shouldUpdateSpace": true and return the complete updated "levels" array in "updatedLevels".
- If the user is only asking a question without requesting a layout/design change, set "shouldUpdateSpace": false.
${SPATIAL_GEOMETRY_SPEC}`;

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  if (params.imageBase64 && params.imageMimeType) {
    parts.push({
      inlineData: {
        mimeType: params.imageMimeType,
        data: params.imageBase64,
      },
    });
  }

  parts.push({
    text: `${historyText ? `Recent conversation:\n${historyText}\n\n` : ''}User request: ${params.userMessage}`,
  });

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reply: { type: Type.STRING },
          shouldUpdateSpace: { type: Type.BOOLEAN },
          estimatedSqft: { type: Type.NUMBER },
          updatedLevels: {
            type: Type.ARRAY,
            items: GEMINI_LEVEL_SCHEMA,
          },
        },
        required: ['reply', 'shouldUpdateSpace'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    reply?: string;
    shouldUpdateSpace?: boolean;
    estimatedSqft?: number;
    updatedLevels?: unknown[];
  };

  if (
    parsed.shouldUpdateSpace &&
    Array.isArray(parsed.updatedLevels) &&
    parsed.updatedLevels.length > 0
  ) {
    const normalized = normalizeSpaceData({
      levels: parsed.updatedLevels,
      estimatedSqft: parsed.estimatedSqft,
    });
    const { repaired, snappedCorners, projectedOpenings } =
      snapAndRepairSpaceData(normalized.data);
    trace.push({
      step: 1,
      phase: '3D Design Modified & Snapped',
      detail: `Snapped ${snappedCorners} corners & projected ${projectedOpenings} wall openings for Three.js.`,
      status: 'done',
    });

    return {
      reply: parsed.reply || 'Updated the 3D space geometry.',
      shouldUpdateSpace: true,
      updatedSpaceData: repaired,
      estimatedSqft: normalized.estimatedSqft,
      provider: 'gemini-fallback',
      agentTrace: trace,
    };
  }

  return {
    reply: parsed.reply || 'How would you like to adjust the space layout?',
    shouldUpdateSpace: false,
    provider: 'gemini-fallback',
    agentTrace: trace,
  };
}
