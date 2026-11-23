import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import {
  analyzePngCadBlueprint,
  parseImageDimensions,
  type CadPixelAnalysis,
  type CadWallAuditResult,
  type ImageDimensions,
  type NormalizedOpeningInput,
  type NormalizedWallInput,
} from './cadPreprocess.ts';
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

interface CadTransformContext {
  imgDims: ImageDimensions;
  promptHint?: string;
  cadAnalysis?: CadPixelAnalysis | null;
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

function parseTargetDimensionsMeters(promptHint?: string): {
  widthM?: number;
  depthM?: number;
  areaSqm?: number;
  wallHeightM?: number;
} {
  if (!promptHint) return {};
  const text = promptHint.toLowerCase().replace(/,/g, '.');
  const out: {
    widthM?: number;
    depthM?: number;
    areaSqm?: number;
    wallHeightM?: number;
  } = {};

  // Match patterns like "9mx9m", "9m x 9m", "12 x 8 m", "15.5x10"
  const dimMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:m|meter|meters)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:m|meter|meters)?/i
  );
  if (dimMatch) {
    const w = parseFloat(dimMatch[1]);
    const d = parseFloat(dimMatch[2]);
    if (w >= 2 && w <= 250 && d >= 2 && d <= 250) {
      out.widthM = w;
      out.depthM = d;
    }
  }

  // Match area like "120m2", "120 sqm", "1200 sqft"
  const areaSqmMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:m2|m²|sqm)/i);
  if (areaSqmMatch) {
    const a = parseFloat(areaSqmMatch[1]);
    if (a >= 6 && a <= 50000) out.areaSqm = a;
  } else {
    const areaSqftMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:sqft|sq\s*ft)/i);
    if (areaSqftMatch) {
      const a = parseFloat(areaSqftMatch[1]) / 10.7639;
      if (a >= 6 && a <= 50000) out.areaSqm = a;
    }
  }

  // Match ceiling / wall height like "height 3.2m", "tinggi 3.5m", "ceiling 3m"
  const hMatch = text.match(
    /(?:height|ceiling|tinggi(?:\s+dinding)?)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*m/i
  );
  if (hMatch) {
    const h = parseFloat(hMatch[1]);
    if (h >= 1.8 && h <= 8) out.wallHeightM = h;
  }

  return out;
}

function pointToSegmentProjection(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number
): {
  dist: number;
  projX: number;
  projZ: number;
  angleDeg: number;
  rawT: number;
  lineDist: number;
  lineProjX: number;
  lineProjZ: number;
} {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) {
    return {
      dist: Math.hypot(px - x1, pz - z1),
      projX: x1,
      projZ: z1,
      angleDeg: 0,
      rawT: 0,
      lineDist: Math.hypot(px - x1, pz - z1),
      lineProjX: x1,
      lineProjZ: z1,
    };
  }
  const rawT = ((px - x1) * dx + (pz - z1) * dz) / lenSq;
  const clampedT = Math.max(0.06, Math.min(0.94, rawT));
  const projX = x1 + clampedT * dx;
  const projZ = z1 + clampedT * dz;
  const lineProjX = x1 + rawT * dx;
  const lineProjZ = z1 + rawT * dz;
  const angleDeg = (Math.atan2(dz, dx) * 180) / Math.PI;
  return {
    dist: Math.hypot(px - projX, pz - projZ),
    projX,
    projZ,
    angleDeg,
    rawT,
    lineDist: Math.hypot(px - lineProjX, pz - lineProjZ),
    lineProjX,
    lineProjZ,
  };
}

function snapOpeningToWallsOrCollinearGap(
  px: number,
  pz: number,
  currentAngle: number,
  walls: WallSegment[],
  allowOpenGap: boolean
): { x: number; z: number; angle: number; snapped: boolean; attached: boolean } {
  let bestInterior: ReturnType<typeof pointToSegmentProjection> | null = null;
  let bestCollinearGap: {
    lineProjX: number;
    lineProjZ: number;
    lineDist: number;
    endpointDist: number;
    angleDeg: number;
  } | null = null;

  for (const w of walls) {
    const p = pointToSegmentProjection(px, pz, w.x1, w.z1, w.x2, w.z2);
    if (p.rawT >= 0.02 && p.rawT <= 0.98) {
      if (!bestInterior || p.lineDist < bestInterior.lineDist) {
        bestInterior = p;
      }
    } else if (allowOpenGap && p.lineDist <= 0.45) {
      const endpointDist = Math.min(
        Math.hypot(px - w.x1, pz - w.z1),
        Math.hypot(px - w.x2, pz - w.z2)
      );
      if (
        endpointDist <= 1.35 &&
        (!bestCollinearGap || p.lineDist < bestCollinearGap.lineDist)
      ) {
        bestCollinearGap = {
          lineProjX: p.lineProjX,
          lineProjZ: p.lineProjZ,
          lineDist: p.lineDist,
          endpointDist,
          angleDeg: p.angleDeg,
        };
      }
    }
  }

  // Prefer open doorway gap when opening sits cleanly collinear outside a wall stub
  if (
    bestCollinearGap &&
    (!bestInterior || bestCollinearGap.lineDist < bestInterior.lineDist)
  ) {
    const moved = bestCollinearGap.lineDist > 0.02;
    return {
      x: Number(bestCollinearGap.lineProjX.toFixed(3)),
      z: Number(bestCollinearGap.lineProjZ.toFixed(3)),
      angle: Number(bestCollinearGap.angleDeg.toFixed(1)),
      snapped: moved,
      attached: true,
    };
  }

  if (bestInterior && bestInterior.dist <= 1.2) {
    const moved = bestInterior.dist > 0.02;
    return {
      x: Number(bestInterior.projX.toFixed(3)),
      z: Number(bestInterior.projZ.toFixed(3)),
      angle: Number(bestInterior.angleDeg.toFixed(1)),
      snapped: moved,
      attached: true,
    };
  }

  return {
    x: px,
    z: pz,
    angle: currentAngle,
    snapped: false,
    attached: false,
  };
}

/**
 * Extracts normalized 0..1000 walls from raw AI JSON regardless of whether the model
 * named fields (u1, v1, u2, v2) or (x1, z1, x2, z2).
 */
function extractNormalizedWallsFromRaw(raw: unknown): NormalizedWallInput[] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawLevels = Array.isArray(obj.levels)
    ? obj.levels
    : Array.isArray(obj.updatedLevels)
    ? obj.updatedLevels
    : [];
  const lvl = (rawLevels[0] && typeof rawLevels[0] === 'object'
    ? rawLevels[0]
    : {}) as Record<string, unknown>;
  const rawWalls = Array.isArray(lvl.walls) ? lvl.walls : [];

  const result: NormalizedWallInput[] = [];
  for (const wRaw of rawWalls) {
    if (!wRaw || typeof wRaw !== 'object') continue;
    const w = wRaw as Record<string, unknown>;
    const u1 = Number(w.u1 ?? w.x1);
    const v1 = Number(w.v1 ?? w.z1);
    const u2 = Number(w.u2 ?? w.x2);
    const v2 = Number(w.v2 ?? w.z2);
    if (
      Number.isFinite(u1) &&
      Number.isFinite(v1) &&
      Number.isFinite(u2) &&
      Number.isFinite(v2) &&
      Math.hypot(u2 - u1, v2 - v1) > 1
    ) {
      result.push({ u1, v1, u2, v2 });
    }
  }
  return result;
}

function extractNormalizedOpeningsFromRaw(
  raw: unknown,
  key: 'doors' | 'windows'
): NormalizedOpeningInput[] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawLevels = Array.isArray(obj.levels)
    ? obj.levels
    : Array.isArray(obj.updatedLevels)
    ? obj.updatedLevels
    : [];
  const lvl = (rawLevels[0] && typeof rawLevels[0] === 'object'
    ? rawLevels[0]
    : {}) as Record<string, unknown>;
  const arr = Array.isArray(lvl[key]) ? (lvl[key] as Array<Record<string, unknown>>) : [];
  const out: NormalizedOpeningInput[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const u = Number(item.u ?? item.x);
    const v = Number(item.v ?? item.z);
    if (Number.isFinite(u) && Number.isFinite(v)) {
      out.push({
        u,
        v,
        widthNorm: Number(item.widthNorm) || undefined,
        angle: Number(item.angle) || 0,
      });
    }
  }
  return out;
}

function isNormalized1000Payload(
  raw: Record<string, unknown>,
  walls: Array<Record<string, unknown>>
): boolean {
  if (raw.coordinateSpace === 'normalized_1000') return true;
  if (walls.length === 0) return false;

  const hasExplicitUV = walls.some(
    (w) => w.u1 !== undefined || w.v1 !== undefined || w.u2 !== undefined || w.v2 !== undefined
  );
  if (hasExplicitUV) return true;

  let minCoord = Infinity;
  let maxCoord = -Infinity;
  for (const w of walls) {
    const coords = [
      Number(w.x1),
      Number(w.z1),
      Number(w.x2),
      Number(w.z2),
    ].filter(Number.isFinite);
    for (const c of coords) {
      if (c < minCoord) minCoord = c;
      if (c > maxCoord) maxCoord = c;
    }
  }
  // Centered meter floor plans have negative coords or max <= 60; normalized 0..1000 spans > 65 and >= -5
  return minCoord >= -5 && maxCoord > 65 && maxCoord <= 1050;
}

/**
 * Deterministic Grid-Cell BFS Exterior/Interior Solver:
 * Builds interior RoomZone boundary polygons from walls so non-rectangular (L/U/T)
 * buildings get exact interior floor slabs and labeled rooms without spilling into courtyards.
 */
export function inferRoomsFromWalls(walls: WallSegment[]): RoomZone[] {
  if (walls.length < 3) return [];

  const mergeSortedCoords = (vals: number[], tol = 0.18): number[] => {
    const sorted = [...vals].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) {
      if (out.length === 0 || v - out[out.length - 1] > tol) {
        out.push(Number(v.toFixed(3)));
      }
    }
    return out;
  };

  const xCoords = mergeSortedCoords(walls.flatMap((w) => [w.x1, w.x2]));
  const zCoords = mergeSortedCoords(walls.flatMap((w) => [w.z1, w.z2]));

  if (xCoords.length < 2 || zCoords.length < 2 || xCoords.length > 40 || zCoords.length > 40) {
    return [];
  }

  const nx = xCoords.length - 1;
  const nz = zCoords.length - 1;

  const wallCoverageOnHorizontalEdge = (xA: number, xB: number, z: number): number => {
    const segLen = xB - xA;
    if (segLen < 0.05) return 0;
    let covered = 0;
    for (const w of walls) {
      if (Math.abs(w.z1 - w.z2) <= 0.2 && Math.abs((w.z1 + w.z2) / 2 - z) <= 0.22) {
        const wMin = Math.min(w.x1, w.x2);
        const wMax = Math.max(w.x1, w.x2);
        const overlap = Math.min(xB, wMax) - Math.max(xA, wMin);
        if (overlap > 0) covered += overlap;
      }
    }
    return Math.min(1, covered / segLen);
  };

  const wallCoverageOnVerticalEdge = (x: number, zA: number, zB: number): number => {
    const segLen = zB - zA;
    if (segLen < 0.05) return 0;
    let covered = 0;
    for (const w of walls) {
      if (Math.abs(w.x1 - w.x2) <= 0.2 && Math.abs((w.x1 + w.x2) / 2 - x) <= 0.22) {
        const wMin = Math.min(w.z1, w.z2);
        const wMax = Math.max(w.z1, w.z2);
        const overlap = Math.min(zB, wMax) - Math.max(zA, wMin);
        if (overlap > 0) covered += overlap;
      }
    }
    return Math.min(1, covered / segLen);
  };

  const isDoorwayGap = (len: number, cov: number, hasWallOnLine: boolean): boolean => {
    // A small gap <= 1.45m along an axis that already carries walls is treated as a doorway boundary,
    // preventing exterior flood-fill from leaking inside through open doorways.
    return cov < 0.5 && len <= 1.45 && hasWallOnLine;
  };

  const hEdgeBlocksExterior = (ix: number, iz: number): boolean => {
    // Horizontal grid line zCoords[iz] across xCoords[ix]..xCoords[ix+1]
    if (iz < 0 || iz >= zCoords.length) return false;
    const z = zCoords[iz];
    const cov = wallCoverageOnHorizontalEdge(xCoords[ix], xCoords[ix + 1], z);
    if (cov >= 0.52) return true;
    const hasLineWall = walls.some(
      (w) => Math.abs(w.z1 - w.z2) <= 0.2 && Math.abs((w.z1 + w.z2) / 2 - z) <= 0.22
    );
    return isDoorwayGap(xCoords[ix + 1] - xCoords[ix], cov, hasLineWall);
  };

  const vEdgeBlocksExterior = (ix: number, iz: number): boolean => {
    if (ix < 0 || ix >= xCoords.length) return false;
    const x = xCoords[ix];
    const cov = wallCoverageOnVerticalEdge(x, zCoords[iz], zCoords[iz + 1]);
    if (cov >= 0.52) return true;
    const hasLineWall = walls.some(
      (w) => Math.abs(w.x1 - w.x2) <= 0.2 && Math.abs((w.x1 + w.x2) / 2 - x) <= 0.22
    );
    return isDoorwayGap(zCoords[iz + 1] - zCoords[iz], cov, hasLineWall);
  };

  // Pad grid by 1 exterior ring around (nx, nz): coords in [-1 .. nx] x [-1 .. nz]
  const W = nx + 2;
  const H = nz + 2;
  const exterior = new Uint8Array(W * H);
  const queue: Array<[number, number]> = [[0, 0]];
  exterior[0] = 1;

  while (queue.length > 0) {
    const [gx, gz] = queue.shift()!;
    const ix = gx - 1;
    const iz = gz - 1;

    // Move right -> (gx+1, gz) across vertical grid line xCoords[ix+1]
    if (gx + 1 < W && !exterior[gz * W + (gx + 1)]) {
      const blocked =
        iz >= 0 && iz < nz && ix + 1 >= 0 && ix + 1 < xCoords.length
          ? vEdgeBlocksExterior(ix + 1, iz)
          : false;
      if (!blocked) {
        exterior[gz * W + (gx + 1)] = 1;
        queue.push([gx + 1, gz]);
      }
    }
    // Move left -> (gx-1, gz) across vertical grid line xCoords[ix]
    if (gx - 1 >= 0 && !exterior[gz * W + (gx - 1)]) {
      const blocked =
        iz >= 0 && iz < nz && ix >= 0 && ix < xCoords.length
          ? vEdgeBlocksExterior(ix, iz)
          : false;
      if (!blocked) {
        exterior[gz * W + (gx - 1)] = 1;
        queue.push([gx - 1, gz]);
      }
    }
    // Move down -> (gx, gz+1) across horizontal grid line zCoords[iz+1]
    if (gz + 1 < H && !exterior[(gz + 1) * W + gx]) {
      const blocked =
        ix >= 0 && ix < nx && iz + 1 >= 0 && iz + 1 < zCoords.length
          ? hEdgeBlocksExterior(ix, iz + 1)
          : false;
      if (!blocked) {
        exterior[(gz + 1) * W + gx] = 1;
        queue.push([gx, gz + 1]);
      }
    }
    // Move up -> (gx, gz-1) across horizontal grid line zCoords[iz]
    if (gz - 1 >= 0 && !exterior[(gz - 1) * W + gx]) {
      const blocked =
        ix >= 0 && ix < nx && iz >= 0 && iz < zCoords.length
          ? hEdgeBlocksExterior(ix, iz)
          : false;
      if (!blocked) {
        exterior[(gz - 1) * W + gx] = 1;
        queue.push([gx, gz - 1]);
      }
    }
  }

  // Group interior cells into rooms: separate across walls OR narrow doorway gaps
  const hSeparatesRoom = (ix: number, iz: number): boolean => {
    if (iz <= 0 || iz >= zCoords.length - 1) return true;
    const cov = wallCoverageOnHorizontalEdge(xCoords[ix], xCoords[ix + 1], zCoords[iz]);
    if (cov >= 0.4) return true;
    const len = xCoords[ix + 1] - xCoords[ix];
    return len <= 1.45 && walls.some((w) => Math.abs(w.z1 - w.z2) <= 0.2 && Math.abs((w.z1 + w.z2) / 2 - zCoords[iz]) <= 0.22);
  };

  const vSeparatesRoom = (ix: number, iz: number): boolean => {
    if (ix <= 0 || ix >= xCoords.length - 1) return true;
    const cov = wallCoverageOnVerticalEdge(xCoords[ix], zCoords[iz], zCoords[iz + 1]);
    if (cov >= 0.4) return true;
    const len = zCoords[iz + 1] - zCoords[iz];
    return len <= 1.45 && walls.some((w) => Math.abs(w.x1 - w.x2) <= 0.2 && Math.abs((w.x1 + w.x2) / 2 - xCoords[ix]) <= 0.22);
  };

  const visited = new Uint8Array(nx * nz);
  const rooms: RoomZone[] = [];

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      if (visited[iz * nx + ix]) continue;
      if (exterior[(iz + 1) * W + (ix + 1)]) continue;

      const cells: Array<[number, number]> = [];
      const cellSet = new Set<string>();
      const q: Array<[number, number]> = [[ix, iz]];
      visited[iz * nx + ix] = 1;

      while (q.length > 0) {
        const [cx, cz] = q.shift()!;
        cells.push([cx, cz]);
        cellSet.add(`${cx},${cz}`);

        if (
          cx + 1 < nx &&
          !visited[cz * nx + cx + 1] &&
          !exterior[(cz + 1) * W + (cx + 2)] &&
          !vSeparatesRoom(cx + 1, cz)
        ) {
          visited[cz * nx + cx + 1] = 1;
          q.push([cx + 1, cz]);
        }
        if (
          cx - 1 >= 0 &&
          !visited[cz * nx + cx - 1] &&
          !exterior[(cz + 1) * W + cx] &&
          !vSeparatesRoom(cx, cz)
        ) {
          visited[cz * nx + cx - 1] = 1;
          q.push([cx - 1, cz]);
        }
        if (
          cz + 1 < nz &&
          !visited[(cz + 1) * nx + cx] &&
          !exterior[(cz + 2) * W + (cx + 1)] &&
          !hSeparatesRoom(cx, cz + 1)
        ) {
          visited[(cz + 1) * nx + cx] = 1;
          q.push([cx, cz + 1]);
        }
        if (
          cz - 1 >= 0 &&
          !visited[(cz - 1) * nx + cx] &&
          !exterior[cz * W + (cx + 1)] &&
          !hSeparatesRoom(cx, cz)
        ) {
          visited[(cz - 1) * nx + cx] = 1;
          q.push([cx, cz - 1]);
        }
      }

      // Compute orthogonal outer polygon loop from cell boundary edges
      type HalfEdge = { x1: number; z1: number; x2: number; z2: number };
      const edges: HalfEdge[] = [];
      for (const [cx, cz] of cells) {
        const x0 = xCoords[cx];
        const x1 = xCoords[cx + 1];
        const z0 = zCoords[cz];
        const z1 = zCoords[cz + 1];
        if (!cellSet.has(`${cx},${cz - 1}`)) edges.push({ x1: x0, z1: z0, x2: x1, z2: z0 });
        if (!cellSet.has(`${cx + 1},${cz}`)) edges.push({ x1: x1, z1: z0, x2: x1, z2: z1 });
        if (!cellSet.has(`${cx},${cz + 1}`)) edges.push({ x1: x1, z1: z1, x2: x0, z2: z1 });
        if (!cellSet.has(`${cx - 1},${cz}`)) edges.push({ x1: x0, z1: z1, x2: x0, z2: z0 });
      }

      if (edges.length < 4) continue;

      const byStart = new Map<string, HalfEdge[]>();
      const ptKey = (x: number, z: number) => `${x.toFixed(3)},${z.toFixed(3)}`;
      for (const e of edges) {
        const k = ptKey(e.x1, e.z1);
        const list = byStart.get(k) || [];
        list.push(e);
        byStart.set(k, list);
      }

      const polygon: Array<{ x: number; z: number }> = [];
      const first = edges[0];
      let cur = first;
      const used = new Set<HalfEdge>([first]);
      polygon.push({ x: cur.x1, z: cur.z1 });

      for (let guard = 0; guard < edges.length + 2; guard++) {
        const nextK = ptKey(cur.x2, cur.z2);
        if (nextK === ptKey(first.x1, first.z1)) break;
        const candidates = (byStart.get(nextK) || []).filter((e) => !used.has(e));
        if (candidates.length === 0) break;
        // Prefer turning/continuing cleanly
        const nxt = candidates[0];
        used.add(nxt);
        polygon.push({ x: nxt.x1, z: nxt.z1 });
        cur = nxt;
      }

      // Remove collinear vertices
      const simplified: Array<{ x: number; z: number }> = [];
      for (let i = 0; i < polygon.length; i++) {
        const prev = polygon[(i - 1 + polygon.length) % polygon.length];
        const curr = polygon[i];
        const next = polygon[(i + 1) % polygon.length];
        const sameX = Math.abs(prev.x - curr.x) < 0.01 && Math.abs(curr.x - next.x) < 0.01;
        const sameZ = Math.abs(prev.z - curr.z) < 0.01 && Math.abs(curr.z - next.z) < 0.01;
        if (!sameX && !sameZ) simplified.push(curr);
      }

      if (simplified.length >= 3) {
        rooms.push({
          id: uid('room', rooms.length),
          name: `Room ${rooms.length + 1}`,
          polygon: simplified,
          floorType: 'concrete',
        });
      }
    }
  }

  return rooms;
}

export function normalizeSpaceData(
  raw: unknown,
  cadCtx?: CadTransformContext
): {
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

  const targetDims = parseTargetDimensionsMeters(cadCtx?.promptHint);

  const levels: SpaceLevel[] = (rawLevels.length > 0 ? rawLevels : [{}]).map(
    (lvlRaw, lIdx) => {
      const lvl = (lvlRaw && typeof lvlRaw === 'object' ? lvlRaw : {}) as Record<
        string,
        unknown
      >;
      const rawWalls = (Array.isArray(lvl.walls) ? lvl.walls : []) as Array<
        Record<string, unknown>
      >;

      const isNorm = Boolean(
        cadCtx && isNormalized1000Payload(obj, rawWalls)
      );

      let worldImgW = 12;
      let worldImgH = 12;
      let centerU = 0.5;
      let centerV = 0.5;

      if (isNorm && cadCtx) {
        let bMinU = Infinity;
        let bMaxU = -Infinity;
        let bMinV = Infinity;
        let bMaxV = -Infinity;
        for (const w of rawWalls) {
          const u1 = Number(w.u1 ?? w.x1);
          const v1 = Number(w.v1 ?? w.z1);
          const u2 = Number(w.u2 ?? w.x2);
          const v2 = Number(w.v2 ?? w.z2);
          if (Number.isFinite(u1) && Number.isFinite(u2)) {
            bMinU = Math.min(bMinU, u1, u2);
            bMaxU = Math.max(bMaxU, u1, u2);
          }
          if (Number.isFinite(v1) && Number.isFinite(v2)) {
            bMinV = Math.min(bMinV, v1, v2);
            bMaxV = Math.max(bMaxV, v1, v2);
          }
        }
        if (!Number.isFinite(bMinU) || bMaxU <= bMinU) {
          bMinU = cadCtx.cadAnalysis?.bbox.minU ?? 100;
          bMaxU = cadCtx.cadAnalysis?.bbox.maxU ?? 900;
        }
        if (!Number.isFinite(bMinV) || bMaxV <= bMinV) {
          bMinV = cadCtx.cadAnalysis?.bbox.minV ?? 100;
          bMaxV = cadCtx.cadAnalysis?.bbox.maxV ?? 900;
        }

        const spanU = Math.max(0.15, (bMaxU - bMinU) / 1000);
        const spanV = Math.max(0.15, (bMaxV - bMinV) / 1000);
        centerU = (bMinU + bMaxU) / 2000;
        centerV = (bMinV + bMaxV) / 2000;

        const imgAspect =
          cadCtx.imgDims.height > 0
            ? cadCtx.imgDims.width / cadCtx.imgDims.height
            : 1;
        const bldgAspect = (spanU * imgAspect) / spanV;

        if (targetDims.widthM && targetDims.depthM) {
          worldImgW = targetDims.widthM / spanU;
          worldImgH = targetDims.depthM / spanV;
        } else if (targetDims.areaSqm) {
          const bW = Math.sqrt(targetDims.areaSqm * bldgAspect);
          const bH = Math.sqrt(targetDims.areaSqm / bldgAspect);
          worldImgW = bW / spanU;
          worldImgH = bH / spanV;
        } else {
          const aiSqft = Number(obj.estimatedSqft);
          if (Number.isFinite(aiSqft) && aiSqft >= 300 && aiSqft <= 12000) {
            const areaSqm = aiSqft / 10.7639;
            const bW = Math.sqrt(areaSqm * bldgAspect);
            const bH = Math.sqrt(areaSqm / bldgAspect);
            worldImgW = bW / spanU;
            worldImgH = bH / spanV;
          } else {
            const targetMajor = 12.0;
            const bW = bldgAspect >= 1 ? targetMajor : targetMajor * bldgAspect;
            const bH = bldgAspect >= 1 ? targetMajor / bldgAspect : targetMajor;
            worldImgW = bW / spanU;
            worldImgH = bH / spanV;
          }
        }
      }

      const mapU = (val: unknown): number => {
        const num = Number(val) || 0;
        if (!isNorm) return num;
        return Number(((num / 1000 - centerU) * worldImgW).toFixed(3));
      };
      const mapV = (val: unknown): number => {
        const num = Number(val) || 0;
        if (!isNorm) return num;
        return Number(((num / 1000 - centerV) * worldImgH).toFixed(3));
      };

      const defaultWallHeight = targetDims.wallHeightM || 2.8;

      const walls: WallSegment[] = rawWalls
        .map((w: Record<string, unknown>, idx: number) => ({
          id: typeof w.id === 'string' && w.id ? w.id : uid('wall', idx),
          x1: mapU(w.u1 ?? w.x1),
          z1: mapV(w.v1 ?? w.z1),
          x2: mapU(w.u2 ?? w.x2),
          z2: mapV(w.v2 ?? w.z2),
          height: Math.max(
            1.5,
            Math.min(8, Number(w.height) || defaultWallHeight)
          ),
          thickness: Math.max(0.08, Math.min(0.6, Number(w.thickness) || 0.16)),
          isExterior: Boolean(w.isExterior ?? true),
        }))
        .filter((w) => Math.hypot(w.x2 - w.x1, w.z2 - w.z1) >= 0.15);

      const doors: DoorOpening[] = (
        Array.isArray(lvl.doors) ? lvl.doors : []
      ).map((d: Record<string, unknown>, idx: number) => {
        let widthM = Number(d.width) || 0.9;
        if (isNorm && Number.isFinite(Number(d.widthNorm))) {
          const avgScale = (worldImgW + worldImgH) / 2000;
          widthM = Number(d.widthNorm) * avgScale;
        }
        return {
          id: typeof d.id === 'string' && d.id ? d.id : uid('door', idx),
          x: mapU(d.u ?? d.x),
          z: mapV(d.v ?? d.z),
          width: Math.max(0.6, Math.min(2.4, widthM)),
          height: Math.max(1.8, Math.min(2.6, Number(d.height) || 2.1)),
          angle: Number(d.angle) || 0,
          swing: d.swing === 'right' ? 'right' : 'left',
        };
      });

      const windows: WindowOpening[] = (
        Array.isArray(lvl.windows) ? lvl.windows : []
      ).map((w: Record<string, unknown>, idx: number) => {
        let widthM = Number(w.width) || 1.6;
        if (isNorm && Number.isFinite(Number(w.widthNorm))) {
          const avgScale = (worldImgW + worldImgH) / 2000;
          widthM = Number(w.widthNorm) * avgScale;
        }
        return {
          id: typeof w.id === 'string' && w.id ? w.id : uid('win', idx),
          x: mapU(w.u ?? w.x),
          z: mapV(w.v ?? w.z),
          width: Math.max(0.5, Math.min(4.5, widthM)),
          height: Math.max(0.6, Math.min(2.4, Number(w.height) || 1.4)),
          sillHeight: Math.max(0.2, Math.min(1.5, Number(w.sillHeight) || 0.85)),
          angle: Number(w.angle) || 0,
        };
      });

      const rooms: RoomZone[] = (
        Array.isArray(lvl.rooms) ? lvl.rooms : []
      ).map((r: Record<string, unknown>, idx: number) => ({
        id: typeof r.id === 'string' && r.id ? r.id : uid('room', idx),
        name: typeof r.name === 'string' && r.name ? r.name : `Room ${idx + 1}`,
        polygon: Array.isArray(r.polygon)
          ? r.polygon.map((p: Record<string, unknown>) => ({
              x: mapU(p.u ?? p.x),
              z: mapV(p.v ?? p.z),
            }))
          : [],
        floorType:
          r.floorType === 'wood' ||
          r.floorType === 'tile' ||
          r.floorType === 'carpet'
            ? r.floorType
            : 'concrete',
      }));

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
          name:
            typeof e.name === 'string' && e.name
              ? e.name
              : kind.replace(/_/g, ' '),
          x: mapU(e.u ?? e.x),
          z: mapV(e.v ?? e.z),
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
        x: mapU(a.u ?? a.x),
        z: mapV(a.v ?? a.z),
      }));

      const levelObj: SpaceLevel = {
        id: typeof lvl.id === 'string' && lvl.id ? lvl.id : `level_${lIdx + 1}`,
        name:
          typeof lvl.name === 'string' && lvl.name
            ? lvl.name
            : `Level ${lIdx + 1}`,
        elevation: Number(lvl.elevation) || lIdx * 3.0,
        floorHeight: Number(lvl.floorHeight) || defaultWallHeight,
        walls,
        doors,
        windows,
        rooms,
        equipment,
        annotations,
        stairs: [],
      };

      if (isNorm && lIdx === 0) {
        levelObj.underlayWidthMeters = Number(worldImgW.toFixed(3));
        levelObj.underlayHeightMeters = Number(worldImgH.toFixed(3));
        levelObj.underlayOffsetX = Number(((0.5 - centerU) * worldImgW).toFixed(3));
        levelObj.underlayOffsetZ = Number(((0.5 - centerV) * worldImgH).toFixed(3));
        levelObj.underlayScale = 1;
      }

      return levelObj;
    }
  );

  // Compute accurate footprint area from inferred/present rooms or bounding box
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
    targetDims.widthM && targetDims.depthM
      ? targetDims.widthM * targetDims.depthM
      : Number.isFinite(minX) && maxX > minX && maxZ > minZ
      ? (maxX - minX) * (maxZ - minZ)
      : 64;
  const fallbackSqft = Math.round(computedAreaSqm * 10.7639);
  const estimatedSqft = Math.max(
    50,
    Math.round(
      targetDims.widthM && targetDims.depthM
        ? fallbackSqft
        : Number(obj.estimatedSqft) || fallbackSqft
    )
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
        wallHeight: targetDims.wallHeightM || 2.8,
        wallThickness: 0.16,
      },
    },
    suggestedName: typeof obj.suggestedName === 'string' ? obj.suggestedName : undefined,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    estimatedSqft,
  };
}

/**
 * Deterministic Three.js Geometry Auditor
 */
export function auditSpaceGeometryForThreeJs(data: SpaceData): {
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
      issues: [
        'No walls defined. Add wall segments matching every exterior and interior wall in the CAD drawing.',
      ],
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
      const d = Math.hypot(
        endpoints[i].x - endpoints[j].x,
        endpoints[i].z - endpoints[j].z
      );
      if (d > 0.03 && d < 0.25) {
        disconnectedCornerGaps++;
      }
    }
  }

  let detachedDoors = 0;
  for (const d of lvl.doors) {
    const res = snapOpeningToWallsOrCollinearGap(
      d.x,
      d.z,
      d.angle,
      lvl.walls,
      true
    );
    let minDist = Infinity;
    for (const w of lvl.walls) {
      const proj = pointToSegmentProjection(d.x, d.z, w.x1, w.z1, w.x2, w.z2);
      if (proj.dist < minDist) minDist = proj.dist;
    }
    if (!res.attached && minDist > 0.45) detachedDoors++;
  }

  let detachedWindows = 0;
  for (const win of lvl.windows) {
    let minDist = Infinity;
    for (const w of lvl.walls) {
      const proj = pointToSegmentProjection(win.x, win.z, w.x1, w.z1, w.x2, w.z2);
      if (proj.dist < minDist) minDist = proj.dist;
    }
    if (minDist > 0.45) detachedWindows++;
  }

  const issues: string[] = [];
  if (disconnectedCornerGaps > 0) {
    issues.push(
      `${disconnectedCornerGaps} near-coincident wall corner(s) have small gaps (0.03m–0.25m).`
    );
  }
  if (detachedDoors > 0) {
    issues.push(
      `${detachedDoors} door(s) are >0.45m from any wall segment.`
    );
  }
  if (detachedWindows > 0) {
    issues.push(
      `${detachedWindows} window(s) are >0.45m from any wall segment.`
    );
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
 * - Orthogonalizes near-horizontal / near-vertical walls within 0.12m
 * - Snaps wall endpoints within 0.22m (preserving >0.4m intentional doorways!)
 * - Projects doors & windows onto their nearest wall
 * - Infers missing or incomplete interior room polygons via grid BFS
 */
export function snapAndRepairSpaceData(data: SpaceData): {
  repaired: SpaceData;
  snappedCorners: number;
  projectedOpenings: number;
} {
  const cloned = structuredClone(data);
  let snappedCorners = 0;
  let projectedOpenings = 0;

  for (const level of cloned.levels) {
    // 1. Orthogonalize slightly skewed CAD walls (< 0.12m drift over segment)
    level.walls = level.walls.map((w) => {
      const dx = Math.abs(w.x2 - w.x1);
      const dz = Math.abs(w.z2 - w.z1);
      if (dx > 0.4 && dz < 0.12) {
        const zAvg = Number(((w.z1 + w.z2) / 2).toFixed(3));
        return { ...w, z1: zAvg, z2: zAvg };
      }
      if (dz > 0.4 && dx < 0.12) {
        const xAvg = Number(((w.x1 + w.x2) / 2).toFixed(3));
        return { ...w, x1: xAvg, x2: xAvg };
      }
      return w;
    });

    // 2. Snap near-coincident wall endpoints within 0.22m (preserves real doorways >= 0.5m)
    const anchors: Array<{ x: number; z: number }> = [];
    const snapPt = (x: number, z: number): { x: number; z: number } => {
      for (const a of anchors) {
        const d = Math.hypot(a.x - x, a.z - z);
        if (d > 0.001 && d <= 0.22) {
          snappedCorners++;
          return { x: a.x, z: a.z };
        }
      }
      const rounded = {
        x: Number(x.toFixed(2)),
        z: Number(z.toFixed(2)),
      };
      anchors.push(rounded);
      return rounded;
    };

    level.walls = level.walls.map((w) => {
      const p1 = snapPt(w.x1, w.z1);
      const p2 = snapPt(w.x2, w.z2);
      return { ...w, x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z };
    });

    // 3. Project doors & windows onto nearest wall segment (preserving open doorway gaps)
    if (level.walls.length > 0) {
      level.doors = level.doors.map((door) => {
        const snapRes = snapOpeningToWallsOrCollinearGap(
          door.x,
          door.z,
          door.angle,
          level.walls,
          true
        );
        if (snapRes.attached) {
          if (snapRes.snapped) projectedOpenings++;
          return {
            ...door,
            x: snapRes.x,
            z: snapRes.z,
            angle: snapRes.angle,
          };
        }
        return door;
      });

      level.windows = level.windows.map((win) => {
        const snapRes = snapOpeningToWallsOrCollinearGap(
          win.x,
          win.z,
          win.angle,
          level.walls,
          false
        );
        if (snapRes.attached) {
          if (snapRes.snapped) projectedOpenings++;
          return {
            ...win,
            x: snapRes.x,
            z: snapRes.z,
            angle: snapRes.angle,
          };
        }
        return win;
      });
    }

    // 4. Infer room polygons if none were provided (gives exact L/U-shaped floor slabs)
    const validRooms = level.rooms.filter((r) => r.polygon.length >= 3);
    if (validRooms.length === 0 && level.walls.length >= 4) {
      const inferred = inferRoomsFromWalls(level.walls);
      if (inferred.length > 0) {
        level.rooms = inferred;
      }
    }

    // 5. Populate annotations from rooms if annotations empty
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

/**
 * Safety net when a Vision model drops major orthogonal structural walls from a crisp CAD blueprint.
 * Only supplements missing interior/exterior wall candidates (not image outer frames) if recall < 0.65.
 */
function supplementMissingCadWallsIfNeeded(
  rawObj: Record<string, unknown>,
  cadAnalysis?: CadPixelAnalysis | null
): { patched: Record<string, unknown>; addedWalls: number } {
  if (!cadAnalysis || !cadAnalysis.isOrthogonalCad) {
    return { patched: rawObj, addedWalls: 0 };
  }
  const normWalls = extractNormalizedWallsFromRaw(rawObj);
  const audit = cadAnalysis.auditProposedNormalizedWalls(normWalls);

  // Only merge missing walls if Vision clearly missed major sections (e.g., an alcove/wing)
  const significantMissing = audit.missingWalls.filter((w) => {
    const nearImgEdge =
      (w.u1 <= 8 && w.u2 <= 8) ||
      (w.u1 >= 992 && w.u2 >= 992) ||
      (w.v1 <= 8 && w.v2 <= 8) ||
      (w.v1 >= 992 && w.v2 >= 992);
    return !nearImgEdge && w.lengthNorm >= 60;
  });

  if (audit.wallRecall >= 0.72 || significantMissing.length === 0) {
    return { patched: rawObj, addedWalls: 0 };
  }

  const cloned = structuredClone(rawObj) as Record<string, unknown>;
  const rawLevels = Array.isArray(cloned.levels)
    ? cloned.levels
    : Array.isArray(cloned.updatedLevels)
    ? cloned.updatedLevels
    : [{}];
  const lvl = (rawLevels[0] && typeof rawLevels[0] === 'object'
    ? rawLevels[0]
    : {}) as Record<string, unknown>;
  const existingWalls = Array.isArray(lvl.walls) ? [...lvl.walls] : [];

  for (const mw of significantMissing) {
    existingWalls.push({
      u1: mw.u1,
      v1: mw.v1,
      u2: mw.u2,
      v2: mw.v2,
      isExterior:
        mw.u1 <= cadAnalysis.bbox.minU + 25 ||
        mw.u2 >= cadAnalysis.bbox.maxU - 25 ||
        mw.v1 <= cadAnalysis.bbox.minV + 25 ||
        mw.v2 >= cadAnalysis.bbox.maxV - 25,
      thickness: 0.16,
      height: 2.8,
    });
  }

  lvl.walls = existingWalls;
  rawLevels[0] = lvl;
  if (Array.isArray(cloned.updatedLevels)) cloned.updatedLevels = rawLevels;
  else cloned.levels = rawLevels;
  cloned.coordinateSpace = 'normalized_1000';

  return { patched: cloned, addedWalls: significantMissing.length };
}

function buildCadGroundTruthPromptSection(cadAnalysis?: CadPixelAnalysis | null, imgDims?: ImageDimensions): string {
  const parts: string[] = [];
  if (imgDims) {
    parts.push(
      `Uploaded Image Dimensions: ${imgDims.width} × ${imgDims.height} pixels (aspect ratio ${(
        imgDims.width / Math.max(1, imgDims.height)
      ).toFixed(3)}).`
    );
  }
  if (cadAnalysis && cadAnalysis.wallCandidates.length > 0) {
    parts.push(
      `PIXEL-MEASURED STRUCTURAL ANCHORS (normalized 0..1000 image space, u=left->right, v=top->bottom):`,
      `- Drawing bounding box: u=${cadAnalysis.bbox.minU}..${cadAnalysis.bbox.maxU}, v=${cadAnalysis.bbox.minV}..${cadAnalysis.bbox.maxV}`,
      `- Detected vertical wall X-axes (u): [${cadAnalysis.xAxes.join(', ')}]`,
      `- Detected horizontal wall Y-axes (v): [${cadAnalysis.yAxes.join(', ')}]`,
      `- Detected wall segments (${cadAnalysis.wallCandidates.length}):`,
      ...cadAnalysis.wallCandidates.map(
        (w, i) =>
          `  ${i + 1}. (${w.u1}, ${w.v1}) -> (${w.u2}, ${w.v2}) [${w.orientation === 'h' ? 'horizontal' : 'vertical'}, len=${w.lengthNorm}]`
      )
    );
    if (cadAnalysis.openingGaps.length > 0) {
      parts.push(
        `- Detected open doorways / corridor gaps (${cadAnalysis.openingGaps.length}):`,
        ...cadAnalysis.openingGaps.map(
          (g, i) =>
            `  ${i + 1}. center=(${g.u}, ${g.v}), width=${g.widthNorm} (${g.orientation === 'h' ? 'horizontal' : 'vertical'} gap — DO NOT bridge with a solid wall)`
        )
      );
    }
    parts.push(
      `CRITICAL EXTRACTION RULES:`,
      `- Verify each pixel-measured wall segment visually against the CAD image: preserve EVERY real wing, alcove, stub wall, and partition!`,
      `- DO NOT bridge open doorways/passages where no wall lines exist in the image.`,
      `- Ignore outer CAD sheet title frames if present; keep all structural building walls, columns-to-wall runs, doors (with swing arcs), windows, room polygons, annotations, and any drawn equipment.`
    );
  }
  return parts.join('\n');
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

const SPATIAL_CAD_NORMALIZED_SPEC = `SpaceData Normalized CAD JSON Structure (set "coordinateSpace": "normalized_1000"):
Use normalized image coordinates (u, v) in 0..1000 where:
- u = 0 is the LEFT edge of the image, u = 1000 is the RIGHT edge of the image
- v = 0 is the TOP edge of the image, v = 1000 is the BOTTOM edge of the image
- levels: array of {
    name: string,
    walls: [{ u1, v1, u2, v2, height (2.8), thickness (0.16), isExterior (bool) }],
    doors: [{ u, v, widthNorm (optional), width (0.9m), angle (deg), swing ("left"|"right") }],
    windows: [{ u, v, widthNorm (optional), width (1.6m), height (1.4m), sillHeight (0.85m), angle (deg) }],
    rooms: [{ name, floorType ("concrete"|"wood"|"tile"|"carpet"), polygon: [{ u, v }] }],
    equipment: [{
      kind: one of ["desk","triangular_desk","conference_table","chair","office_chair","sofa_3","sofa_2","armchair","coffee_table","shelves","sink","toilet","ac_unit","bed","plant"],
      name, u, v, rotation (deg), length (cm), width (cm), height (cm), elevation (cm: 0 for floor, 210 for ac_unit)
    }],
    annotations: [{ text, u, v }]
  }
CRITICAL RULES:
- Include EVERY projecting wing, alcove, stub partition, and interior wall visible in the image.
- Leave open passages/doorways open (do NOT draw solid walls across blank gaps in the drawing).
- Exterior & interior walls MUST share exact corner (u, v) endpoints so there are no gaps.`;

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
  }`;

const OPENAI_AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'propose_space_draft',
      description:
        'Submit a draft SpaceData floor plan to run BOTH the CAD Pixel Coverage Audit (missing wings / hallucinated walls) and Three.js Geometry Audit. For CAD image digitization, set coordinateSpace="normalized_1000" and use (u1, v1, u2, v2) in 0..1000.',
      parameters: {
        type: 'object',
        properties: {
          coordinateSpace: {
            type: 'string',
            enum: ['normalized_1000', 'meters'],
          },
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
        'Run the deterministic Three.js geometric solver to orthogonalize walls, snap corners, project doors/windows onto walls, and infer room floor polygons.',
      parameters: {
        type: 'object',
        properties: {
          coordinateSpace: {
            type: 'string',
            enum: ['normalized_1000', 'meters'],
          },
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
        'Commit the final verified 3D Three.js SpaceData once CAD visual accuracy & geometry audit issues are resolved.',
      parameters: {
        type: 'object',
        properties: {
          coordinateSpace: {
            type: 'string',
            enum: ['normalized_1000', 'meters'],
          },
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
    temperature: 0.15,
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
  cadCtx?: CadTransformContext;
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

  let latestRawObj: Record<string, unknown> | null = null;
  let latestDraft: {
    data: SpaceData;
    suggestedName?: string;
    description?: string;
    estimatedSqft: number;
  } | null = null;

  let committedRawObj: Record<string, unknown> | null = null;
  let committed: {
    reply?: string;
    data: SpaceData;
    suggestedName?: string;
    description?: string;
    estimatedSqft: number;
  } | null = null;

  let useTools = true;
  let sentVisualOverlayCritique = false;
  const maxSteps = 6;

  const cadAnalysis = params.cadCtx?.cadAnalysis || null;

  for (let step = 1; step <= maxSteps; step++) {
    let response = await callOpenAiCompatibleChat({
      messages,
      useTools,
      forceJson: !useTools,
    });

    if (response.toolsUnsupported) {
      useTools = false;
      trace.push({
        step: trace.length + 1,
        phase: 'Structured JSON Vision Pass',
        detail: 'Model endpoint uses direct JSON synthesis; enabling pixel-verified multi-pass critique.',
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
      let pendingOverlayCritique: {
        audit: CadWallAuditResult;
        overlayBase64: string;
      } | null = null;

      for (const tc of msg.tool_calls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = extractJsonObject(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        if (toolName === 'propose_space_draft') {
          latestRawObj = args;
          const normalized = normalizeSpaceData(args, params.cadCtx);
          latestDraft = normalized;
          const geoAudit = auditSpaceGeometryForThreeJs(normalized.data);

          let pixelAudit: CadWallAuditResult | null = null;
          if (cadAnalysis) {
            const normWalls = extractNormalizedWallsFromRaw(args);
            pixelAudit = cadAnalysis.auditProposedNormalizedWalls(normWalls);
            if (
              !sentVisualOverlayCritique &&
              (pixelAudit.wallRecall < 0.8 || pixelAudit.wallPrecision < 0.72)
            ) {
              const normDoors = extractNormalizedOpeningsFromRaw(args, 'doors');
              const normWindows = extractNormalizedOpeningsFromRaw(args, 'windows');
              pendingOverlayCritique = {
                audit: pixelAudit,
                overlayBase64: cadAnalysis.renderOverlayPngBase64(
                  normWalls,
                  normDoors,
                  normWindows
                ),
              };
            }
          }

          trace.push({
            step: trace.length + 1,
            phase: 'Draft 3D Geometry Extracted',
            tool: 'propose_space_draft',
            detail: pixelAudit
              ? `${geoAudit.wallCount} walls (CAD recall ${Math.round(
                  pixelAudit.wallRecall * 100
                )}%, precision ${Math.round(pixelAudit.wallPrecision * 100)}%), ${
                  geoAudit.boundingBoxMeters.width
                }m × ${geoAudit.boundingBoxMeters.depth}m`
              : `${geoAudit.wallCount} walls, ${geoAudit.doorCount} doors, ${geoAudit.windowCount} windows (${geoAudit.boundingBoxMeters.width}m × ${geoAudit.boundingBoxMeters.depth}m)`,
            status:
              geoAudit.issues.length > 0 ||
              (pixelAudit &&
                (pixelAudit.wallRecall < 0.8 || pixelAudit.wallPrecision < 0.72))
                ? 'warning'
                : 'done',
          });

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: toolName,
            content: JSON.stringify({
              geometryAudit: geoAudit,
              pixelCadAudit: pixelAudit
                ? {
                    wallRecall: pixelAudit.wallRecall,
                    wallPrecision: pixelAudit.wallPrecision,
                    missingWallsCount: pixelAudit.missingWalls.length,
                    missingWalls: pixelAudit.missingWalls,
                    unsupportedWalls: pixelAudit.unsupportedWalls,
                  }
                : undefined,
            }),
          });
        } else if (toolName === 'repair_and_snap_geometry') {
          const sourceObj: Record<string, unknown> | null =
            Array.isArray(args.levels) && args.levels.length > 0
              ? args
              : latestRawObj;
          if (sourceObj) {
            latestRawObj = sourceObj;
            const rawInput = normalizeSpaceData(sourceObj, params.cadCtx);
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
              detail: `Snapped ${snappedCorners} corners, inferred ${repaired.levels[0]?.rooms.length || 0} room zones, projected ${projectedOpenings} openings.`,
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
          committedRawObj = args;
          const { patched, addedWalls } = supplementMissingCadWallsIfNeeded(
            args,
            cadAnalysis
          );
          const normalized = normalizeSpaceData(patched, params.cadCtx);
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
            detail: `Verified ${repaired.levels[0]?.walls.length || 0} walls & ${
              repaired.levels[0]?.rooms.length || 0
            } room slabs (snapped ${snappedCorners} corners${
              addedWalls > 0 ? `, recovered ${addedWalls} missed CAD walls` : ''
            }, ${projectedOpenings} openings).`,
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

      // Visual red-overlay self-verification message if CAD walls were missed or hallucinated
      if (pendingOverlayCritique && !committed) {
        sentVisualOverlayCritique = true;
        const { audit, overlayBase64 } = pendingOverlayCritique;
        const missingList = audit.missingWalls
          .map((w) => `(${w.u1},${w.v1})->(${w.u2},${w.v2})`)
          .join('; ');
        const unsupportedList = audit.unsupportedWalls
          .map((w) => `(${w.u1},${w.v1})->(${w.u2},${w.v2}) [ink=${w.hitRatio}]`)
          .join('; ');

        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${overlayBase64}`,
                detail: 'high',
              },
            },
            {
              type: 'text',
              text: `VISUAL VERIFICATION OVERLAY: Your extracted walls are drawn in RED on top of the uploaded CAD blueprint (recall=${Math.round(
                audit.wallRecall * 100
              )}%, precision=${Math.round(audit.wallPrecision * 100)}%).
${
  missingList
    ? `- MISSING CAD WALLS (black CAD lines with NO red overlay): ${missingList}\n`
    : ''
}${
  unsupportedList
    ? `- UNSUPPORTED RED WALLS (drawn over empty space / open doorways): ${unsupportedList}\n`
    : ''
}Please look at the red overlay image, add every missing wall/wing, remove any wall drawn across open doorways or blank space, and call "finalize_3d_space" with coordinateSpace="normalized_1000".`,
            },
          ],
        });
      }

      if (committed) break;
      continue;
    }

    // No tool calls in assistant response: inspect JSON content
    const contentText = typeof msg.content === 'string' ? msg.content.trim() : '';

    if (contentText) {
      try {
        const parsed = extractJsonObject(contentText);

        if (params.allowNoUpdate && parsed.shouldUpdateSpace === false) {
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
          latestRawObj = parsed;

          // Multi-pass visual verification when endpoint doesn't use tools
          if (cadAnalysis && !sentVisualOverlayCritique) {
            const normWalls = extractNormalizedWallsFromRaw(parsed);
            const pixelAudit = cadAnalysis.auditProposedNormalizedWalls(normWalls);
            if (pixelAudit.wallRecall < 0.8 || pixelAudit.wallPrecision < 0.72) {
              sentVisualOverlayCritique = true;
              const normDoors = extractNormalizedOpeningsFromRaw(parsed, 'doors');
              const normWindows = extractNormalizedOpeningsFromRaw(parsed, 'windows');
              const overlayBase64 = cadAnalysis.renderOverlayPngBase64(
                normWalls,
                normDoors,
                normWindows
              );

              trace.push({
                step: trace.length + 1,
                phase: 'Visual Overlay Self-Verification',
                detail: `Pass 1 CAD recall ${Math.round(
                  pixelAudit.wallRecall * 100
                )}%, precision ${Math.round(
                  pixelAudit.wallPrecision * 100
                )}% — running Pass 2 visual refinement.`,
                status: 'warning',
              });

              const missingList = pixelAudit.missingWalls
                .map((w) => `(${w.u1},${w.v1})->(${w.u2},${w.v2})`)
                .join('; ');
              const unsupportedList = pixelAudit.unsupportedWalls
                .map((w) => `(${w.u1},${w.v1})->(${w.u2},${w.v2})`)
                .join('; ');

              messages.push({ role: 'assistant', content: contentText });
              messages.push({
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/png;base64,${overlayBase64}`,
                      detail: 'high',
                    },
                  },
                  {
                    type: 'text',
                    text: `VISUAL VERIFICATION OVERLAY: RED lines show your Pass 1 extraction over the CAD blueprint.
${missingList ? `- Missing CAD walls: ${missingList}\n` : ''}${
                      unsupportedList ? `- Unsupported red walls: ${unsupportedList}\n` : ''
                    }Return corrected JSON with coordinateSpace="normalized_1000" fixing every missing wing/wall and removing walls across open doorways.`,
                  },
                ],
              });
              continue;
            }
          }

          const { patched, addedWalls } = supplementMissingCadWallsIfNeeded(
            parsed,
            cadAnalysis
          );
          const normalized = normalizeSpaceData(patched, params.cadCtx);
          const audit = auditSpaceGeometryForThreeJs(normalized.data);
          trace.push({
            step: trace.length + 1,
            phase: 'Vision Extraction & Geometry Audit',
            detail: `${audit.wallCount} walls, ${audit.doorCount} doors, ${audit.windowCount} windows`,
            status: audit.issues.length > 0 ? 'warning' : 'done',
          });

          const { repaired, snappedCorners, projectedOpenings } =
            snapAndRepairSpaceData(normalized.data);
          trace.push({
            step: trace.length + 1,
            phase: 'Three.js Scene Synthesis',
            detail: `Snapped ${snappedCorners} corners, inferred ${
              repaired.levels[0]?.rooms.length || 0
            } room slabs${
              addedWalls > 0 ? `, recovered ${addedWalls} missed CAD walls` : ''
            }, aligned ${projectedOpenings} openings.`,
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
      const source = latestRawObj
        ? supplementMissingCadWallsIfNeeded(latestRawObj, cadAnalysis).patched
        : null;
      const finalNorm = source ? normalizeSpaceData(source, params.cadCtx) : latestDraft;
      const { repaired } = snapAndRepairSpaceData(finalNorm.data);
      return {
        reply: '3D Three.js geometry generated and verified.',
        shouldUpdateSpace: true,
        data: repaired,
        suggestedName: finalNorm.suggestedName,
        description: finalNorm.description,
        estimatedSqft: finalNorm.estimatedSqft,
        agentTrace: trace,
      };
    }

    break;
  }

  if (committed) {
    void committedRawObj;
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
    const source = latestRawObj
      ? supplementMissingCadWallsIfNeeded(latestRawObj, cadAnalysis).patched
      : null;
    const finalNorm = source ? normalizeSpaceData(source, params.cadCtx) : latestDraft;
    const { repaired } = snapAndRepairSpaceData(finalNorm.data);
    return {
      reply: '3D Three.js layout repaired and ready.',
      shouldUpdateSpace: true,
      data: repaired,
      suggestedName: finalNorm.suggestedName,
      description: finalNorm.description,
      estimatedSqft: finalNorm.estimatedSqft,
      agentTrace: trace,
    };
  }

  throw new Error('AI agent did not produce valid 3D Three.js geometry.');
}

const GEMINI_NORMALIZED_LEVEL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    walls: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          u1: { type: Type.NUMBER },
          v1: { type: Type.NUMBER },
          u2: { type: Type.NUMBER },
          v2: { type: Type.NUMBER },
          height: { type: Type.NUMBER },
          thickness: { type: Type.NUMBER },
          isExterior: { type: Type.BOOLEAN },
        },
        required: ['u1', 'v1', 'u2', 'v2'],
      },
    },
    doors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          u: { type: Type.NUMBER },
          v: { type: Type.NUMBER },
          width: { type: Type.NUMBER },
          angle: { type: Type.NUMBER },
          swing: { type: Type.STRING },
        },
        required: ['u', 'v', 'width', 'angle'],
      },
    },
    windows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          u: { type: Type.NUMBER },
          v: { type: Type.NUMBER },
          width: { type: Type.NUMBER },
          height: { type: Type.NUMBER },
          sillHeight: { type: Type.NUMBER },
          angle: { type: Type.NUMBER },
        },
        required: ['u', 'v', 'width', 'angle'],
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
                u: { type: Type.NUMBER },
                v: { type: Type.NUMBER },
              },
              required: ['u', 'v'],
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
          u: { type: Type.NUMBER },
          v: { type: Type.NUMBER },
          rotation: { type: Type.NUMBER },
          length: { type: Type.NUMBER },
          width: { type: Type.NUMBER },
          height: { type: Type.NUMBER },
          elevation: { type: Type.NUMBER },
        },
        required: ['kind', 'name', 'u', 'v', 'rotation'],
      },
    },
    annotations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          u: { type: Type.NUMBER },
          v: { type: Type.NUMBER },
        },
        required: ['text', 'u', 'v'],
      },
    },
  },
  required: ['name', 'walls', 'doors', 'windows', 'rooms', 'equipment', 'annotations'],
};

const GEMINI_METER_LEVEL_SCHEMA = {
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
  const imgBuf = Buffer.from(params.imageBase64, 'base64');
  const imgDims = parseImageDimensions(imgBuf, params.mimeType) || {
    width: 1000,
    height: 1000,
  };
  const cadAnalysis = analyzePngCadBlueprint(imgBuf);
  const cadCtx: CadTransformContext = {
    imgDims,
    promptHint: params.promptHint,
    cadAnalysis,
  };
  const cadAnchorSection = buildCadGroundTruthPromptSection(cadAnalysis, imgDims);

  if (status.provider === 'openai-compatible') {
    const systemPrompt = `You are the SpaceKit Agentic 2D-CAD-to-3D Three.js Architect.
Follow this agentic workflow strictly:
1. Analyze the uploaded 2D architectural floor plan or technical CAD drawing carefully along with any pixel-measured structural anchors below.
2. Output ALL coordinates in normalized image coordinates (u, v) in 0..1000 (u=0..1000 left-to-right, v=0..1000 top-to-bottom) with "coordinateSpace": "normalized_1000". Do NOT convert to centered meters yourself; the SpaceKit solver performs exact metric scaling and CAD underlay alignment.
3. Call "propose_space_draft" with the extracted walls, doors, windows, rooms, equipment, and annotations.
4. Review BOTH the CAD pixel-coverage audit (and visual red-overlay image if returned) AND the Three.js geometry audit. Fix any missing wing/wall or doorway wall bridge, call "repair_and_snap_geometry" if needed, then call "finalize_3d_space".
If tool calling is unavailable, return ONLY valid JSON matching the schema with "coordinateSpace": "normalized_1000".

${SPATIAL_CAD_NORMALIZED_SPEC}`;

    const userText = [
      params.promptHint?.trim()
        ? `Digitize this 2D CAD / floor plan image into accurate 3D Three.js SpaceKit geometry. Additional context: ${params.promptHint}`
        : `Digitize this 2D CAD / technical floor plan image into accurate 3D Three.js SpaceKit geometry, extracting every exterior/interior wall, wing, opening, door, window, room zone, annotation, and furniture/equipment item.`,
      cadAnchorSection,
    ]
      .filter(Boolean)
      .join('\n\n');

    const result = await runOpenAiAgenticPipeline({
      mode: 'cad-to-3d',
      systemPrompt,
      cadCtx,
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

  if (cadAnalysis) {
    trace.push({
      step: 1,
      phase: 'CAD Pixel Axis & Topology Pre-Scan',
      detail: `Measured ${cadAnalysis.width}×${cadAnalysis.height}px (${cadAnalysis.xAxes.length} vertical & ${cadAnalysis.yAxes.length} horizontal axes, ${cadAnalysis.wallCandidates.length} wall runs, ${cadAnalysis.openingGaps.length} openings).`,
      status: 'done',
    });
  }

  const systemInstruction = `You are a precision Agentic CAD-to-3D digitizer for SpaceKit Three.js.
Analyze the uploaded 2D architectural floor plan and output ALL coordinates in normalized image coordinates (u, v) in 0..1000 (u=0..1000 left-to-right, v=0..1000 top-to-bottom).
The server deterministically transforms normalized (u, v) coordinates to exact meters and aligns the CAD underlay.
${SPATIAL_CAD_NORMALIZED_SPEC}`;

  const userPrompt = [
    params.promptHint?.trim()
      ? `Digitize this 2D CAD / floor plan image into accurate normalized (0..1000) SpaceKit geometry. Additional user context: ${params.promptHint}`
      : `Digitize this 2D CAD / technical floor plan image into accurate normalized (0..1000) SpaceKit geometry, preserving every wing, partition, open doorway, door swing, window, room zone, annotation, and furniture/equipment.`,
    cadAnchorSection,
  ]
    .filter(Boolean)
    .join('\n\n');

  const geminiSchema = {
    type: Type.OBJECT,
    properties: {
      coordinateSpace: { type: Type.STRING },
      suggestedName: { type: Type.STRING },
      description: { type: Type.STRING },
      estimatedSqft: { type: Type.NUMBER },
      levels: {
        type: Type.ARRAY,
        items: GEMINI_NORMALIZED_LEVEL_SCHEMA,
      },
    },
    required: ['suggestedName', 'description', 'estimatedSqft', 'levels'],
  };

  const response1: GenerateContentResponse = await ai.models.generateContent({
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
      responseSchema: geminiSchema,
    },
  });

  let parsed = JSON.parse((response1.text ?? '{}').trim()) as Record<string, unknown>;
  parsed.coordinateSpace = 'normalized_1000';

  // Pass 2: Visual Red-Overlay Self-Verification when PNG CAD pixel audit shows discrepancies
  if (cadAnalysis) {
    const normWalls = extractNormalizedWallsFromRaw(parsed);
    const pixelAudit = cadAnalysis.auditProposedNormalizedWalls(normWalls);
    trace.push({
      step: trace.length + 1,
      phase: '2D CAD Vision Extraction (Pass 1)',
      detail: `${normWalls.length} walls extracted (CAD recall ${Math.round(
        pixelAudit.wallRecall * 100
      )}%, precision ${Math.round(pixelAudit.wallPrecision * 100)}%).`,
      status:
        pixelAudit.wallRecall < 0.8 || pixelAudit.wallPrecision < 0.72
          ? 'warning'
          : 'done',
    });

    if (pixelAudit.wallRecall < 0.82 || pixelAudit.wallPrecision < 0.75) {
      const overlayBase64 = cadAnalysis.renderOverlayPngBase64(
        normWalls,
        extractNormalizedOpeningsFromRaw(parsed, 'doors'),
        extractNormalizedOpeningsFromRaw(parsed, 'windows')
      );
      const missingList = pixelAudit.missingWalls
        .map((w) => `(${w.u1},${w.v1})->(${w.u2},${w.v2})`)
        .join('; ');
      const unsupportedList = pixelAudit.unsupportedWalls
        .map((w) => `(${w.u1},${w.v1})->(${w.u2},${w.v2})`)
        .join('; ');

      const critiquePrompt = `VISUAL VERIFICATION OVERLAY: Your Pass 1 walls are drawn in RED on top of the CAD drawing.
${missingList ? `- Missing CAD wall segments (visible in CAD but missing RED overlay): ${missingList}\n` : ''}${
        unsupportedList ? `- Unsupported RED walls (drawn over empty space or open doorways): ${unsupportedList}\n` : ''
      }Compare the RED lines against the black CAD walls carefully, fix ALL missing wings/partitions and remove walls bridging open doorways, and return the complete updated normalized (0..1000) JSON.`;

      const response2: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: overlayBase64,
              },
            },
            { text: critiquePrompt },
          ],
        },
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: geminiSchema,
        },
      });

      try {
        const parsed2 = JSON.parse((response2.text ?? '{}').trim()) as Record<string, unknown>;
        parsed2.coordinateSpace = 'normalized_1000';
        const audit2 = cadAnalysis.auditProposedNormalizedWalls(
          extractNormalizedWallsFromRaw(parsed2)
        );
        if (
          audit2.wallRecall + audit2.wallPrecision >=
          pixelAudit.wallRecall + pixelAudit.wallPrecision
        ) {
          parsed = parsed2;
        }
        trace.push({
          step: trace.length + 1,
          phase: 'Visual Red-Overlay Self-Verification (Pass 2)',
          detail: `Refined to CAD recall ${Math.round(
            audit2.wallRecall * 100
          )}%, precision ${Math.round(audit2.wallPrecision * 100)}%.`,
          status: 'done',
        });
      } catch {
        // Keep Pass 1 result if Pass 2 returned malformed JSON
      }
    }
  }

  const { patched, addedWalls } = supplementMissingCadWallsIfNeeded(
    parsed,
    cadAnalysis
  );
  const normalized = normalizeSpaceData(patched, cadCtx);
  const { repaired, snappedCorners, projectedOpenings } = snapAndRepairSpaceData(
    normalized.data
  );

  trace.push({
    step: trace.length + 1,
    phase: 'Three.js Geometry Snap & Room Slab Synthesis',
    detail: `Snapped ${snappedCorners} corners, inferred ${
      repaired.levels[0]?.rooms.length || 0
    } room slabs${
      addedWalls > 0 ? `, recovered ${addedWalls} missed CAD walls` : ''
    }, projected ${projectedOpenings} openings.`,
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

  let cadCtx: CadTransformContext | undefined;
  let cadAnchorSection = '';
  if (params.imageBase64 && params.imageMimeType) {
    const imgBuf = Buffer.from(params.imageBase64, 'base64');
    const imgDims = parseImageDimensions(imgBuf, params.imageMimeType) || {
      width: 1000,
      height: 1000,
    };
    const cadAnalysis = analyzePngCadBlueprint(imgBuf);
    cadCtx = {
      imgDims,
      promptHint: params.userMessage,
      cadAnalysis,
    };
    cadAnchorSection = buildCadGroundTruthPromptSection(cadAnalysis, imgDims);
  }

  if (status.provider === 'openai-compatible') {
    const systemPrompt = `You are the SpaceKit Agentic 3D Spatial Architect embedded inside a 2D-CAD + 3D Three.js building studio.
Current space name: "${params.spaceName}"
Current space JSON:
${JSON.stringify(params.spaceData)}

Rules:
- If the user uploads a 2D CAD / floor plan image to digitize, output normalized image coordinates (u, v) in 0..1000 with "coordinateSpace": "normalized_1000" using your agentic tools ("propose_space_draft" -> "repair_and_snap_geometry" -> "finalize_3d_space").
- If the user asks to generate, redesign, add, move, resize, or remove elements in the existing meter-space layout without an uploaded CAD plan, use centered meter coordinates ("coordinateSpace": "meters") via your agentic tools.
- If the user is only asking a conceptual or SDK question without modifying geometry, reply directly with JSON: {"reply": "...", "shouldUpdateSpace": false}.
${cadCtx ? SPATIAL_CAD_NORMALIZED_SPEC : SPATIAL_GEOMETRY_SPEC}`;

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
      }User request: ${params.userMessage}${
        cadAnchorSection ? `\n\n${cadAnchorSection}` : ''
      }`,
    });

    const result = await runOpenAiAgenticPipeline({
      mode: 'chat',
      systemPrompt,
      userParts,
      allowNoUpdate: true,
      cadCtx,
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
- If a CAD image is uploaded, extract coordinates in normalized 0..1000 (u, v) coordinates. Otherwise use centered meters (x, z).
- If the user is only asking a question without requesting a layout/design change, set "shouldUpdateSpace": false.
${cadCtx ? SPATIAL_CAD_NORMALIZED_SPEC : SPATIAL_GEOMETRY_SPEC}`;

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
    text: `${historyText ? `Recent conversation:\n${historyText}\n\n` : ''}User request: ${
      params.userMessage
    }${cadAnchorSection ? `\n\n${cadAnchorSection}` : ''}`,
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
            items: cadCtx ? GEMINI_NORMALIZED_LEVEL_SCHEMA : GEMINI_METER_LEVEL_SCHEMA,
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
    const rawPayload: Record<string, unknown> = {
      coordinateSpace: cadCtx ? 'normalized_1000' : 'meters',
      levels: parsed.updatedLevels,
      estimatedSqft: parsed.estimatedSqft,
    };
    const { patched, addedWalls } = supplementMissingCadWallsIfNeeded(
      rawPayload,
      cadCtx?.cadAnalysis
    );
    const normalized = normalizeSpaceData(patched, cadCtx);
    const { repaired, snappedCorners, projectedOpenings } =
      snapAndRepairSpaceData(normalized.data);
    trace.push({
      step: 1,
      phase: '3D Design Modified & Snapped',
      detail: `Snapped ${snappedCorners} corners, inferred ${
        repaired.levels[0]?.rooms.length || 0
      } room slabs${
        addedWalls > 0 ? `, recovered ${addedWalls} missed CAD walls` : ''
      }, projected ${projectedOpenings} openings.`,
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
