import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  getDb,
  ensureDatabaseSchema,
  isDatabaseConfigured,
} from './server/db.ts';
import {
  users,
  projects,
  spaces,
  apiKeys,
  aiMessages,
  spatialEntities,
} from './src/db/schema.ts';
import {
  hashPassword,
  verifyPassword,
  hashToken,
  createUserSession,
  revokeSession,
  requireAuth,
  requireApiKeyOrSession,
  type AuthenticatedRequest,
  type ApiKeyRequest,
} from './server/auth.ts';
import {
  translateCadImageToSpace,
  runSpatialChat,
  getAiProviderStatus,
} from './server/ai.ts';
import type {
  SpaceData,
  SpatialEntityStatus,
  SpatialEntityType,
} from './src/types/space.ts';

const PORT = Number(process.env.PORT || 3000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

function createBlankSpaceData(): SpaceData {
  return {
    levels: [
      {
        id: 'level_1',
        name: 'Level 1',
        elevation: 0,
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
    settings: {
      showGrid: true,
      showLowerFloor: false,
      snapToGrid: true,
      gridSize: 0.5,
      unit: 'sqft',
      wallHeight: 2.8,
      wallThickness: 0.18,
    },
  };
}

function computeSpaceMetrics(data: SpaceData): {
  sqft: number;
  complexity: number;
  sizeKb: number;
} {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  let totalElements = 0;

  for (const level of data.levels) {
    for (const w of level.walls) {
      minX = Math.min(minX, w.x1, w.x2);
      maxX = Math.max(maxX, w.x1, w.x2);
      minZ = Math.min(minZ, w.z1, w.z2);
      maxZ = Math.max(maxZ, w.z1, w.z2);
    }
    totalElements +=
      level.walls.length +
      level.doors.length +
      level.windows.length +
      level.equipment.length;
  }

  let areaSqm = 0;
  if (Number.isFinite(minX) && maxX > minX && maxZ > minZ) {
    areaSqm = (maxX - minX) * (maxZ - minZ);
  }
  const sqft = Math.round(areaSqm * 10.7639);
  const complexity = Math.max(1, Math.min(10, Math.ceil(totalElements / 10)));
  const sizeKb = Math.max(
    1,
    Math.ceil(Buffer.byteLength(JSON.stringify(data), 'utf8') / 1024)
  );

  return { sqft, complexity, sizeKb };
}

function serializeSpace(row: typeof spaces.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    status: row.status as 'live' | 'draft',
    locked: row.locked,
    tags: row.tags ?? [],
    sqft: row.sqft,
    views: row.views,
    complexity: row.complexity,
    sizeKb: row.sizeKb,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    geoRotation: row.geoRotation,
    geoScale: row.geoScale,
    thumbnailUrl: row.thumbnailUrl,
    sourceCadImageUrl: row.sourceCadImageUrl,
    data: row.data,
    unpublishedData: row.unpublishedData,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const VALID_ENTITY_TYPES = new Set<SpatialEntityType>([
  'sensor',
  'beacon',
  'asset',
  'hvac',
  'camera',
  'zone_occupancy',
]);

const VALID_ENTITY_STATUSES = new Set<SpatialEntityStatus>([
  'online',
  'warning',
  'offline',
]);

function sanitizeEntityType(raw: unknown): SpatialEntityType {
  const val = String(raw || '').trim() as SpatialEntityType;
  return VALID_ENTITY_TYPES.has(val) ? val : 'sensor';
}

function sanitizeEntityStatus(raw: unknown): SpatialEntityStatus {
  const val = String(raw || '').trim() as SpatialEntityStatus;
  return VALID_ENTITY_STATUSES.has(val) ? val : 'online';
}

function sanitizeEntityMetadata(
  raw: unknown
): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    const key = String(k).trim().slice(0, 64);
    if (!key) continue;
    if (typeof v === 'string') out[key] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

function serializeEntity(row: typeof spatialEntities.$inferSelect) {
  return {
    id: row.id,
    spaceId: row.spaceId,
    levelId: row.levelId,
    name: row.name,
    entityType: sanitizeEntityType(row.entityType),
    status: sanitizeEntityStatus(row.status),
    x: row.x,
    z: row.z,
    elevation: row.elevation,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '16mb' }));
  app.use(express.urlencoded({ extended: true, limit: '16mb' }));

  // Health & DB status endpoint
  app.get('/api/health', async (_req, res) => {
    const dbConfigured = isDatabaseConfigured();
    if (!dbConfigured) {
      return res.json({
        ok: true,
        dbConfigured: false,
        dbConnected: false,
      });
    }
    try {
      await ensureDatabaseSchema();
      return res.json({ ok: true, dbConfigured: true, dbConnected: true });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        dbConfigured: true,
        dbConnected: false,
        error: err instanceof Error ? err.message : 'Database connection error',
      });
    }
  });

  // ---------------- GOOGLE MAPS CONFIG & GEOCODING PROXY ----------------
  app.get('/api/config/maps', requireAuth, (_req, res) => {
    const apiKey =
      process.env.GMAPS_API_KEY?.trim() ||
      process.env.VITE_GMAPS_API_KEY?.trim() ||
      '';
    return res.json({ apiKey });
  });

  app.get('/api/maps/geocode', requireAuth, async (req, res) => {
    try {
      const apiKey =
        process.env.GMAPS_API_KEY?.trim() ||
        process.env.VITE_GMAPS_API_KEY?.trim() ||
        '';
      if (!apiKey) {
        return res.status(503).json({
          error:
            'GMAPS_API_KEY is not configured. Add GMAPS_API_KEY in Settings > Secrets.',
        });
      }

      const q = String(req.query?.q || '').trim();
      if (!q || q.length > 300) {
        return res.status(400).json({ error: 'Valid search query is required' });
      }

      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        q
      )}&key=${encodeURIComponent(apiKey)}`;
      const upstream = await fetch(url);
      const data = (await upstream.json()) as {
        status?: string;
        error_message?: string;
        results?: Array<{
          formatted_address: string;
          geometry?: { location?: { lat: number; lng: number } };
        }>;
      };

      if (
        data.status &&
        data.status !== 'OK' &&
        data.status !== 'ZERO_RESULTS'
      ) {
        return res.status(502).json({
          error:
            data.error_message || `Geocoding failed (${data.status})`,
        });
      }

      const results = (data.results || [])
        .filter((r) => r.geometry?.location)
        .slice(0, 5)
        .map((r) => ({
          formattedAddress: r.formatted_address,
          lat: r.geometry!.location!.lat,
          lng: r.geometry!.location!.lng,
        }));

      return res.json({ results });
    } catch (err) {
      console.error('Maps geocode error:', err);
      return res.status(500).json({ error: 'Failed to geocode address' });
    }
  });

  // ---------------- AUTH ROUTES ----------------
  app.post('/api/auth/register', async (req, res) => {
    try {
      if (!isDatabaseConfigured()) {
        return res.status(503).json({
          error:
            'PostgreSQL is not configured. Set PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD in Settings > Secrets.',
        });
      }
      await ensureDatabaseSchema();
      const db = getDb();

      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const name = String(req.body?.name || '').trim() || email.split('@')[0];
      const workspaceName =
        String(req.body?.workspaceName || '').trim() || 'Personal spaces';

      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email address is required' });
      }
      if (password.length < 8) {
        return res
          .status(400)
          .json({ error: 'Password must be at least 8 characters' });
      }

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing.length > 0) {
        return res
          .status(409)
          .json({ error: 'An account with this email already exists' });
      }

      const passwordHash = hashPassword(password);
      const [created] = await db
        .insert(users)
        .values({
          email,
          name,
          passwordHash,
          workspaceName,
        })
        .returning();

      const { token } = await createUserSession(created.id);

      return res.status(201).json({
        token,
        user: {
          id: created.id,
          email: created.email,
          name: created.name,
          workspaceName: created.workspaceName,
          createdAt: created.createdAt.toISOString(),
        },
      });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'Failed to create account' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      if (!isDatabaseConfigured()) {
        return res.status(503).json({
          error:
            'PostgreSQL is not configured. Set PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD in Settings > Secrets.',
        });
      }
      await ensureDatabaseSchema();
      const db = getDb();

      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');

      if (!email || !password) {
        return res
          .status(400)
          .json({ error: 'Email and password are required' });
      }

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (rows.length === 0 || !verifyPassword(password, rows[0].passwordHash)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = rows[0];
      const { token } = await createUserSession(user.id);

      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          workspaceName: user.workspaceName,
          createdAt: user.createdAt.toISOString(),
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.sessionTokenHash) {
        await revokeSession(req.sessionTokenHash);
      }
      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: 'Logout failed' });
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    return res.json({ user: req.user });
  });

  app.patch('/api/auth/workspace', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const workspaceName = String(req.body?.workspaceName || '').trim().slice(0, 80);
      if (!workspaceName) {
        return res.status(400).json({ error: 'Workspace name is required' });
      }
      const [updated] = await db
        .update(users)
        .set({ workspaceName })
        .where(eq(users.id, req.user!.id))
        .returning();

      return res.json({
        user: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          workspaceName: updated.workspaceName,
          createdAt: updated.createdAt.toISOString(),
        },
      });
    } catch (err) {
      console.error('Update workspace error:', err);
      return res.status(500).json({ error: 'Failed to update workspace name' });
    }
  });

  // ---------------- SPACES ROUTES ----------------
  app.get('/api/spaces', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(spaces)
        .where(eq(spaces.userId, req.user!.id))
        .orderBy(desc(spaces.updatedAt));
      return res.json({ spaces: rows.map(serializeSpace) });
    } catch (err) {
      console.error('List spaces error:', err);
      return res.status(500).json({ error: 'Failed to load spaces' });
    }
  });

  app.post('/api/spaces', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const name = String(req.body?.name || '').trim() || 'Untitled space';
      const description = String(req.body?.description || '').trim();
      const projectId = req.body?.projectId ? String(req.body.projectId) : null;
      if (projectId) {
        const ownedProject = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.userId, req.user!.id)))
          .limit(1);
        if (ownedProject.length === 0) {
          return res.status(400).json({ error: 'Invalid project assignment' });
        }
      }
      const tags = Array.isArray(req.body?.tags)
        ? req.body.tags.map((t: unknown) => String(t)).filter(Boolean)
        : [];
      const data: SpaceData = req.body?.data || createBlankSpaceData();
      const metrics = computeSpaceMetrics(data);

      const id = `spc_${crypto.randomBytes(4).toString('hex')}`;
      const [created] = await db
        .insert(spaces)
        .values({
          id,
          userId: req.user!.id,
          projectId,
          name,
          description,
          status: 'live',
          tags,
          sqft: req.body?.sqft ? Number(req.body.sqft) : metrics.sqft,
          complexity: metrics.complexity,
          sizeKb: metrics.sizeKb,
          sourceCadImageUrl: req.body?.sourceCadImageUrl || null,
          thumbnailUrl: req.body?.thumbnailUrl || null,
          data,
          unpublishedData: null,
        })
        .returning();

      return res.status(201).json({ space: serializeSpace(created) });
    } catch (err) {
      console.error('Create space error:', err);
      return res.status(500).json({ error: 'Failed to create space' });
    }
  });

  app.get('/api/spaces/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const spaceId = String(req.params.id);
      const rows = await db
        .select()
        .from(spaces)
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .limit(1);

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Space not found' });
      }

      const [updated] = await db
        .update(spaces)
        .set({ views: sql`${spaces.views} + 1` })
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .returning();

      return res.json({ space: serializeSpace(updated) });
    } catch (err) {
      console.error('Get space error:', err);
      return res.status(500).json({ error: 'Failed to load space' });
    }
  });

  app.patch('/api/spaces/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const spaceId = String(req.params.id);
      const existingRows = await db
        .select()
        .from(spaces)
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .limit(1);

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Space not found' });
      }
      const current = existingRows[0];

      if (current.locked && req.body?.locked !== false && req.body?.unpublishedData !== undefined) {
        return res.status(423).json({
          error: 'This space is locked. Unlock it from the Edit menu to make changes.',
        });
      }

      const patch: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim() || current.name;
      if (typeof req.body?.description === 'string') patch.description = req.body.description;
      if (req.body?.status === 'live' || req.body?.status === 'draft') {
        patch.status = req.body.status;
      }
      if (typeof req.body?.locked === 'boolean') patch.locked = req.body.locked;
      if (Array.isArray(req.body?.tags)) {
        patch.tags = req.body.tags.map((t: unknown) => String(t)).filter(Boolean);
      }
      if (req.body?.projectId !== undefined) {
        const nextProjectId = req.body.projectId ? String(req.body.projectId) : null;
        if (nextProjectId) {
          const ownedProject = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, nextProjectId), eq(projects.userId, req.user!.id)))
            .limit(1);
          if (ownedProject.length === 0) {
            return res.status(400).json({ error: 'Invalid project assignment' });
          }
        }
        patch.projectId = nextProjectId;
      }
      if (req.body?.address !== undefined) patch.address = req.body.address;
      if (req.body?.latitude !== undefined) {
        if (req.body.latitude === null) {
          patch.latitude = null;
        } else {
          const val = Number(req.body.latitude);
          if (!Number.isFinite(val) || val < -90 || val > 90) {
            return res.status(400).json({ error: 'Invalid latitude' });
          }
          patch.latitude = val;
        }
      }
      if (req.body?.longitude !== undefined) {
        if (req.body.longitude === null) {
          patch.longitude = null;
        } else {
          const val = Number(req.body.longitude);
          if (!Number.isFinite(val) || val < -180 || val > 180) {
            return res.status(400).json({ error: 'Invalid longitude' });
          }
          patch.longitude = val;
        }
      }
      if (req.body?.geoRotation !== undefined) {
        const val = Number(req.body.geoRotation);
        patch.geoRotation = Number.isFinite(val) ? val : 0;
      }
      if (req.body?.geoScale !== undefined) {
        const val = Number(req.body.geoScale);
        patch.geoScale = Number.isFinite(val) && val > 0 ? val : 1;
      }
      if (typeof req.body?.thumbnailUrl === 'string') patch.thumbnailUrl = req.body.thumbnailUrl;

      if (req.body?.unpublishedData) {
        patch.unpublishedData = req.body.unpublishedData;
        const m = computeSpaceMetrics(req.body.unpublishedData as SpaceData);
        patch.sqft = m.sqft;
        patch.complexity = m.complexity;
        patch.sizeKb = m.sizeKb;
      }

      if (req.body?.data) {
        patch.data = req.body.data;
        const m = computeSpaceMetrics(req.body.data as SpaceData);
        patch.sqft = m.sqft;
        patch.complexity = m.complexity;
        patch.sizeKb = m.sizeKb;
      }

      const [updated] = await db
        .update(spaces)
        .set(patch)
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .returning();

      return res.json({ space: serializeSpace(updated) });
    } catch (err) {
      console.error('Update space error:', err);
      return res.status(500).json({ error: 'Failed to update space' });
    }
  });

  app.post('/api/spaces/:id/publish', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const spaceId = String(req.params.id);
      const rows = await db
        .select()
        .from(spaces)
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .limit(1);

      if (rows.length === 0) return res.status(404).json({ error: 'Space not found' });
      const current = rows[0];
      const nextData = current.unpublishedData ?? current.data;
      const m = computeSpaceMetrics(nextData);

      const [updated] = await db
        .update(spaces)
        .set({
          data: nextData,
          unpublishedData: null,
          status: 'live',
          sqft: m.sqft,
          complexity: m.complexity,
          sizeKb: m.sizeKb,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .returning();

      return res.json({ space: serializeSpace(updated) });
    } catch (err) {
      console.error('Publish space error:', err);
      return res.status(500).json({ error: 'Failed to publish space' });
    }
  });

  app.post('/api/spaces/:id/discard', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const spaceId = String(req.params.id);
      const rows = await db
        .select()
        .from(spaces)
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .limit(1);

      if (rows.length === 0) return res.status(404).json({ error: 'Space not found' });
      const m = computeSpaceMetrics(rows[0].data);

      const [updated] = await db
        .update(spaces)
        .set({
          unpublishedData: null,
          sqft: m.sqft,
          complexity: m.complexity,
          sizeKb: m.sizeKb,
          updatedAt: new Date(),
        })
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .returning();

      return res.json({ space: serializeSpace(updated) });
    } catch (err) {
      console.error('Discard error:', err);
      return res.status(500).json({ error: 'Failed to discard changes' });
    }
  });

  app.delete('/api/spaces/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const spaceId = String(req.params.id);
      await db
        .delete(spaces)
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)));
      return res.json({ ok: true });
    } catch (err) {
      console.error('Delete space error:', err);
      return res.status(500).json({ error: 'Failed to delete space' });
    }
  });

  // ---------------- SPATIAL ENTITIES ROUTES ----------------
  app.get('/api/spaces/:id/entities', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const spaceId = String(req.params.id);
      const owned = await db
        .select({ id: spaces.id })
        .from(spaces)
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .limit(1);
      if (owned.length === 0) {
        return res.status(404).json({ error: 'Space not found' });
      }
      const rows = await db
        .select()
        .from(spatialEntities)
        .where(
          and(
            eq(spatialEntities.spaceId, spaceId),
            eq(spatialEntities.userId, req.user!.id)
          )
        )
        .orderBy(desc(spatialEntities.updatedAt));
      return res.json({ entities: rows.map(serializeEntity) });
    } catch (err) {
      console.error('List entities error:', err);
      return res.status(500).json({ error: 'Failed to load spatial entities' });
    }
  });

  app.post('/api/spaces/:id/entities', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const spaceId = String(req.params.id);
      const spaceRows = await db
        .select()
        .from(spaces)
        .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
        .limit(1);
      if (spaceRows.length === 0) {
        return res.status(404).json({ error: 'Space not found' });
      }
      if (spaceRows[0].locked) {
        return res.status(423).json({
          error: 'This space is locked. Unlock it from the Edit menu to add entities.',
        });
      }

      const name = String(req.body?.name || '').trim().slice(0, 80);
      if (!name) {
        return res.status(400).json({ error: 'Entity name is required' });
      }

      const levelId =
        String(req.body?.levelId || '').trim() ||
        spaceRows[0].data.levels[0]?.id ||
        'level_1';
      const x = Number.isFinite(Number(req.body?.x)) ? Number(req.body.x) : 0;
      const z = Number.isFinite(Number(req.body?.z)) ? Number(req.body.z) : 0;
      const elevation = Number.isFinite(Number(req.body?.elevation))
        ? Number(req.body.elevation)
        : 1.2;

      const [created] = await db
        .insert(spatialEntities)
        .values({
          spaceId,
          userId: req.user!.id,
          levelId,
          name,
          entityType: sanitizeEntityType(req.body?.entityType),
          status: sanitizeEntityStatus(req.body?.status),
          x,
          z,
          elevation,
          metadata: sanitizeEntityMetadata(req.body?.metadata),
        })
        .returning();

      return res.status(201).json({ entity: serializeEntity(created) });
    } catch (err) {
      console.error('Create entity error:', err);
      return res.status(500).json({ error: 'Failed to create spatial entity' });
    }
  });

  app.patch(
    '/api/spaces/:id/entities/:entityId',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        const db = getDb();
        const spaceId = String(req.params.id);
        const entityId = String(req.params.entityId);

        const existing = await db
          .select()
          .from(spatialEntities)
          .where(
            and(
              eq(spatialEntities.id, entityId),
              eq(spatialEntities.spaceId, spaceId),
              eq(spatialEntities.userId, req.user!.id)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          return res.status(404).json({ error: 'Entity not found' });
        }

        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (typeof req.body?.name === 'string' && req.body.name.trim()) {
          patch.name = req.body.name.trim().slice(0, 80);
        }
        if (typeof req.body?.levelId === 'string' && req.body.levelId.trim()) {
          patch.levelId = req.body.levelId.trim();
        }
        if (req.body?.entityType !== undefined) {
          patch.entityType = sanitizeEntityType(req.body.entityType);
        }
        if (req.body?.status !== undefined) {
          patch.status = sanitizeEntityStatus(req.body.status);
        }
        if (req.body?.x !== undefined && Number.isFinite(Number(req.body.x))) {
          patch.x = Number(req.body.x);
        }
        if (req.body?.z !== undefined && Number.isFinite(Number(req.body.z))) {
          patch.z = Number(req.body.z);
        }
        if (
          req.body?.elevation !== undefined &&
          Number.isFinite(Number(req.body.elevation))
        ) {
          patch.elevation = Number(req.body.elevation);
        }
        if (req.body?.metadata !== undefined) {
          patch.metadata = sanitizeEntityMetadata(req.body.metadata);
        }

        const [updated] = await db
          .update(spatialEntities)
          .set(patch)
          .where(
            and(
              eq(spatialEntities.id, entityId),
              eq(spatialEntities.spaceId, spaceId),
              eq(spatialEntities.userId, req.user!.id)
            )
          )
          .returning();

        return res.json({ entity: serializeEntity(updated) });
      } catch (err) {
        console.error('Update entity error:', err);
        return res.status(500).json({ error: 'Failed to update spatial entity' });
      }
    }
  );

  app.delete(
    '/api/spaces/:id/entities/:entityId',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        const db = getDb();
        const spaceId = String(req.params.id);
        const entityId = String(req.params.entityId);

        await db
          .delete(spatialEntities)
          .where(
            and(
              eq(spatialEntities.id, entityId),
              eq(spatialEntities.spaceId, spaceId),
              eq(spatialEntities.userId, req.user!.id)
            )
          );
        return res.json({ ok: true });
      } catch (err) {
        console.error('Delete entity error:', err);
        return res.status(500).json({ error: 'Failed to delete spatial entity' });
      }
    }
  );

  // ---------------- PUBLIC EMBED ROUTE (LIVE SPACES ONLY) ----------------
  app.get('/api/public/spaces/:id', async (req, res) => {
    try {
      if (!isDatabaseConfigured()) {
        return res.status(503).json({ error: 'Database not configured' });
      }
      await ensureDatabaseSchema();
      const db = getDb();
      const spaceId = String(req.params.id);

      const rows = await db
        .select()
        .from(spaces)
        .where(and(eq(spaces.id, spaceId), eq(spaces.status, 'live')))
        .limit(1);

      if (rows.length === 0) {
        return res
          .status(404)
          .json({ error: 'Space is not published live or does not exist.' });
      }

      const [updated] = await db
        .update(spaces)
        .set({ views: sql`${spaces.views} + 1` })
        .where(eq(spaces.id, spaceId))
        .returning();

      const entityRows = await db
        .select()
        .from(spatialEntities)
        .where(eq(spatialEntities.spaceId, spaceId));

      return res.json({
        space: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          status: updated.status,
          tags: updated.tags ?? [],
          sqft: updated.sqft,
          views: updated.views,
          complexity: updated.complexity,
          address: updated.address,
          latitude: updated.latitude,
          longitude: updated.longitude,
          data: updated.data,
          updatedAt: updated.updatedAt.toISOString(),
        },
        entities: entityRows.map(serializeEntity),
      });
    } catch (err) {
      console.error('Public embed space error:', err);
      return res.status(500).json({ error: 'Failed to load embedded space' });
    }
  });

  // ---------------- PROJECTS ROUTES ----------------
  app.get('/api/projects', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const projectRows = await db
        .select()
        .from(projects)
        .where(eq(projects.userId, req.user!.id))
        .orderBy(desc(projects.updatedAt));

      const spaceRows = await db
        .select({ projectId: spaces.projectId })
        .from(spaces)
        .where(eq(spaces.userId, req.user!.id));

      const counts = new Map<string, number>();
      for (const s of spaceRows) {
        if (s.projectId) counts.set(s.projectId, (counts.get(s.projectId) || 0) + 1);
      }

      return res.json({
        projects: projectRows.map((p) => ({
          ...p,
          spaceCount: counts.get(p.id) || 0,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      console.error('List projects error:', err);
      return res.status(500).json({ error: 'Failed to load projects' });
    }
  });

  app.post('/api/projects', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Project name is required' });
      const description = String(req.body?.description || '').trim();
      const environment =
        req.body?.environment === 'staging' ? 'staging' : 'production';

      const [created] = await db
        .insert(projects)
        .values({
          userId: req.user!.id,
          name,
          description,
          environment,
        })
        .returning();

      return res.status(201).json({
        project: {
          ...created,
          spaceCount: 0,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      });
    } catch (err) {
      console.error('Create project error:', err);
      return res.status(500).json({ error: 'Failed to create project' });
    }
  });

  app.delete('/api/projects/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      await db
        .delete(projects)
        .where(
          and(
            eq(projects.id, String(req.params.id)),
            eq(projects.userId, req.user!.id)
          )
        );
      return res.json({ ok: true });
    } catch (err) {
      console.error('Delete project error:', err);
      return res.status(500).json({ error: 'Failed to delete project' });
    }
  });

  // ---------------- DEVELOPER API KEYS & USAGE ----------------
  app.get('/api/keys', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, req.user!.id))
        .orderBy(desc(apiKeys.createdAt));

      return res.json({
        keys: rows.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          scopes: k.scopes,
          requestCount: k.requestCount,
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          createdAt: k.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      console.error('List keys error:', err);
      return res.status(500).json({ error: 'Failed to load API keys' });
    }
  });

  app.post('/api/keys', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const name = String(req.body?.name || '').trim() || 'Default SDK Key';
      const rawKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`;
      const keyPrefix = `${rawKey.slice(0, 14)}...${rawKey.slice(-4)}`;
      const keyHash = hashToken(rawKey);

      const [created] = await db
        .insert(apiKeys)
        .values({
          userId: req.user!.id,
          name,
          keyPrefix,
          keyHash,
          scopes: ['spaces:read', 'geo:read', 'entities:write'],
        })
        .returning();

      return res.status(201).json({
        rawKey,
        key: {
          id: created.id,
          name: created.name,
          keyPrefix: created.keyPrefix,
          scopes: created.scopes,
          requestCount: created.requestCount,
          lastUsedAt: null,
          createdAt: created.createdAt.toISOString(),
        },
      });
    } catch (err) {
      console.error('Create key error:', err);
      return res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  app.delete('/api/keys/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      await db
        .delete(apiKeys)
        .where(
          and(
            eq(apiKeys.id, String(req.params.id)),
            eq(apiKeys.userId, req.user!.id)
          )
        );
      return res.json({ ok: true });
    } catch (err) {
      console.error('Delete key error:', err);
      return res.status(500).json({ error: 'Failed to revoke API key' });
    }
  });

  app.get('/api/usage', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const userSpaces = await db
        .select()
        .from(spaces)
        .where(eq(spaces.userId, req.user!.id));
      const userKeys = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, req.user!.id));
      const userEntities = await db
        .select({ spaceId: spatialEntities.spaceId })
        .from(spatialEntities)
        .where(eq(spatialEntities.userId, req.user!.id));

      const entityCounts = new Map<string, number>();
      for (const e of userEntities) {
        entityCounts.set(e.spaceId, (entityCounts.get(e.spaceId) || 0) + 1);
      }

      const totalSpaces = userSpaces.length;
      const totalSqft = userSpaces.reduce((acc, s) => acc + s.sqft, 0);
      const totalViews = userSpaces.reduce((acc, s) => acc + s.views, 0);
      const totalSizeKb = userSpaces.reduce((acc, s) => acc + s.sizeKb, 0);
      const totalApiRequests = userKeys.reduce((acc, k) => acc + k.requestCount, 0);
      const totalEntities = userEntities.length;
      const geolocatedSpaces = userSpaces.filter(
        (s) => s.latitude !== null && s.longitude !== null
      ).length;

      return res.json({
        usage: {
          totalSpaces,
          totalSqft,
          totalViews,
          totalSizeKb,
          totalApiRequests,
          totalEntities,
          geolocatedSpaces,
          spacesBreakdown: userSpaces.map((s) => ({
            id: s.id,
            name: s.name,
            sqft: s.sqft,
            views: s.views,
            complexity: s.complexity,
            sizeKb: s.sizeKb,
            levels: s.data.levels.length,
            equipmentCount: s.data.levels.reduce(
              (acc, l) => acc + l.equipment.length,
              0
            ),
            entityCount: entityCounts.get(s.id) || 0,
          })),
        },
      });
    } catch (err) {
      console.error('Usage error:', err);
      return res.status(500).json({ error: 'Failed to compute usage' });
    }
  });

  // ---------------- AI 2D CAD -> 3D & SPATIAL CHAT ----------------
  app.get('/api/config/ai', requireAuth, (_req, res) => {
    return res.json(getAiProviderStatus());
  });

  app.post(
    '/api/ai/cad-to-3d',
    requireAuth,
    upload.single('cadImage'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const db = getDb();
        let imageBase64 = '';
        let mimeType = 'image/png';

        if (req.file) {
          imageBase64 = req.file.buffer.toString('base64');
          mimeType = req.file.mimetype || 'image/png';
        } else if (typeof req.body?.imageDataUrl === 'string') {
          const match = req.body.imageDataUrl.match(
            /^data:([^;]+);base64,(.+)$/
          );
          if (match) {
            mimeType = match[1];
            imageBase64 = match[2];
          }
        } else if (typeof req.body?.imageBase64 === 'string') {
          imageBase64 = req.body.imageBase64;
          mimeType = req.body.mimeType || 'image/png';
        }

        if (!imageBase64) {
          return res.status(400).json({
            error: 'Please upload a 2D CAD / architectural floor plan image.',
          });
        }

        const promptHint =
          typeof req.body?.promptHint === 'string' ? req.body.promptHint : '';
        const customName =
          typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const targetSpaceId =
          typeof req.body?.spaceId === 'string' ? req.body.spaceId.trim() : '';

        const result = await translateCadImageToSpace({
          imageBase64,
          mimeType,
          promptHint,
        });

        const dataUrl = `data:${mimeType};base64,${imageBase64}`;
        // Store reference underlay on level 1
        if (result.data.levels[0]) {
          result.data.levels[0].underlayImageUrl = dataUrl;
          result.data.levels[0].underlayOpacity = 0.28;
        }
        const metrics = computeSpaceMetrics(result.data);

        if (targetSpaceId) {
          const existing = await db
            .select()
            .from(spaces)
            .where(
              and(
                eq(spaces.id, targetSpaceId),
                eq(spaces.userId, req.user!.id)
              )
            )
            .limit(1);

          if (existing.length === 0) {
            return res.status(404).json({ error: 'Target space not found' });
          }

          const [updated] = await db
            .update(spaces)
            .set({
              unpublishedData: result.data,
              sourceCadImageUrl: dataUrl,
              sqft: result.estimatedSqft || metrics.sqft,
              complexity: metrics.complexity,
              sizeKb: metrics.sizeKb,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(spaces.id, targetSpaceId),
                eq(spaces.userId, req.user!.id)
              )
            )
            .returning();

          return res.json({
            space: serializeSpace(updated),
            summary: result.description,
            provider: result.provider,
            agentTrace: result.agentTrace,
          });
        }

        const id = `spc_${crypto.randomBytes(4).toString('hex')}`;
        const [created] = await db
          .insert(spaces)
          .values({
            id,
            userId: req.user!.id,
            name: customName || result.suggestedName,
            description: result.description,
            status: 'live',
            tags: ['CAD Import', 'AI 3D'],
            sqft: result.estimatedSqft || metrics.sqft,
            complexity: metrics.complexity,
            sizeKb: metrics.sizeKb,
            sourceCadImageUrl: dataUrl,
            data: result.data,
            unpublishedData: null,
          })
          .returning();

        return res.status(201).json({
          space: serializeSpace(created),
          summary: result.description,
          provider: result.provider,
          agentTrace: result.agentTrace,
        });
      } catch (err) {
        console.error('CAD-to-3D error:', err);
        return res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to translate 2D CAD image into 3D space',
        });
      }
    }
  );

  app.get(
    '/api/spaces/:id/chat',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        const db = getDb();
        const spaceId = String(req.params.id);
        const rows = await db
          .select()
          .from(aiMessages)
          .where(
            and(
              eq(aiMessages.spaceId, spaceId),
              eq(aiMessages.userId, req.user!.id)
            )
          )
          .orderBy(aiMessages.createdAt);

        return res.json({
          messages: rows.map((m) => ({
            id: m.id,
            spaceId: m.spaceId,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            imageDataUrl: m.imageDataUrl,
            appliedDesignUpdate: m.appliedDesignUpdate,
            createdAt: m.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        console.error('Load chat error:', err);
        return res.status(500).json({ error: 'Failed to load chat history' });
      }
    }
  );

  app.post(
    '/api/ai/chat',
    requireAuth,
    upload.single('image'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const db = getDb();
        const spaceId = String(req.body?.spaceId || '').trim();
        const userMessage = String(req.body?.message || '').trim();

        if (!spaceId) {
          return res.status(400).json({ error: 'spaceId is required' });
        }
        if (!userMessage && !req.file && !req.body?.imageDataUrl) {
          return res
            .status(400)
            .json({ error: 'Please provide a message or image' });
        }

        const spaceRows = await db
          .select()
          .from(spaces)
          .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
          .limit(1);

        if (spaceRows.length === 0) {
          return res.status(404).json({ error: 'Space not found' });
        }

        const currentSpace = spaceRows[0];
        const activeData = currentSpace.unpublishedData ?? currentSpace.data;

        let imageBase64: string | undefined;
        let imageMimeType: string | undefined;
        let imageDataUrl: string | null = null;

        if (req.file) {
          imageBase64 = req.file.buffer.toString('base64');
          imageMimeType = req.file.mimetype || 'image/png';
          imageDataUrl = `data:${imageMimeType};base64,${imageBase64}`;
        } else if (typeof req.body?.imageDataUrl === 'string') {
          const match = req.body.imageDataUrl.match(
            /^data:([^;]+);base64,(.+)$/
          );
          if (match) {
            imageMimeType = match[1];
            imageBase64 = match[2];
            imageDataUrl = req.body.imageDataUrl;
          }
        }

        const historyRows = await db
          .select()
          .from(aiMessages)
          .where(
            and(
              eq(aiMessages.spaceId, spaceId),
              eq(aiMessages.userId, req.user!.id)
            )
          )
          .orderBy(aiMessages.createdAt);

        const [savedUserMsg] = await db
          .insert(aiMessages)
          .values({
            spaceId,
            userId: req.user!.id,
            role: 'user',
            content: userMessage || 'Convert this floor plan image into 3D geometry.',
            imageDataUrl,
            appliedDesignUpdate: false,
          })
          .returning();

        const aiResult = await runSpatialChat({
          spaceName: currentSpace.name,
          spaceData: activeData,
          userMessage:
            userMessage || 'Convert this uploaded floor plan image into 3D.',
          imageBase64,
          imageMimeType,
          history: historyRows.map((h) => ({
            role: h.role as 'user' | 'assistant',
            content: h.content,
          })),
        });

        let updatedSpace = currentSpace;
        let appliedUpdate = false;

        if (aiResult.shouldUpdateSpace && aiResult.updatedSpaceData && !currentSpace.locked) {
          const nextLvl0 = aiResult.updatedSpaceData.levels[0];
          const prevLvl0 = activeData.levels[0];
          if (nextLvl0) {
            if (imageDataUrl) {
              nextLvl0.underlayImageUrl = imageDataUrl;
              nextLvl0.underlayOpacity = 0.28;
            } else if (prevLvl0?.underlayImageUrl) {
              nextLvl0.underlayImageUrl = prevLvl0.underlayImageUrl;
              nextLvl0.underlayOpacity = prevLvl0.underlayOpacity ?? 0.28;
              nextLvl0.underlayScale = prevLvl0.underlayScale ?? 1;
              nextLvl0.underlayWidthMeters = prevLvl0.underlayWidthMeters;
              nextLvl0.underlayHeightMeters = prevLvl0.underlayHeightMeters;
              nextLvl0.underlayOffsetX = prevLvl0.underlayOffsetX;
              nextLvl0.underlayOffsetZ = prevLvl0.underlayOffsetZ;
            }
          }
          const metrics = computeSpaceMetrics(aiResult.updatedSpaceData);
          const [savedSpace] = await db
            .update(spaces)
            .set({
              unpublishedData: aiResult.updatedSpaceData,
              ...(imageDataUrl ? { sourceCadImageUrl: imageDataUrl } : {}),
              sqft: aiResult.estimatedSqft || metrics.sqft,
              complexity: metrics.complexity,
              sizeKb: metrics.sizeKb,
              updatedAt: new Date(),
            })
            .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.user!.id)))
            .returning();
          updatedSpace = savedSpace;
          appliedUpdate = true;
        }

        const [savedAssistantMsg] = await db
          .insert(aiMessages)
          .values({
            spaceId,
            userId: req.user!.id,
            role: 'assistant',
            content: aiResult.reply,
            appliedDesignUpdate: appliedUpdate,
          })
          .returning();

        return res.json({
          userMessage: {
            ...savedUserMsg,
            createdAt: savedUserMsg.createdAt.toISOString(),
          },
          assistantMessage: {
            ...savedAssistantMsg,
            createdAt: savedAssistantMsg.createdAt.toISOString(),
          },
          appliedDesignUpdate: appliedUpdate,
          space: serializeSpace(updatedSpace),
          provider: aiResult.provider,
          agentTrace: aiResult.agentTrace,
        });
      } catch (err) {
        console.error('AI Chat error:', err);
        return res.status(500).json({
          error:
            err instanceof Error ? err.message : 'AI spatial chat request failed',
        });
      }
    }
  );

  // ---------------- PUBLIC DEVELOPER SDK / REST API v1 ----------------
  app.get(
    '/api/v1/spaces/:id',
    requireApiKeyOrSession,
    async (req: ApiKeyRequest, res) => {
      try {
        const db = getDb();
        const rows = await db
          .select()
          .from(spaces)
          .where(
            and(
              eq(spaces.id, String(req.params.id)),
              eq(spaces.userId, req.apiKeyUserId!)
            )
          )
          .limit(1);

        if (rows.length === 0) {
          return res.status(404).json({ error: 'Space not found' });
        }

        const s = rows[0];
        return res.json({
          id: s.id,
          name: s.name,
          description: s.description,
          status: s.status,
          metrics: {
            sqft: s.sqft,
            levels: s.data.levels.length,
            complexity: s.complexity,
            sizeKb: s.sizeKb,
          },
          geospatial:
            s.latitude !== null && s.longitude !== null
              ? {
                  address: s.address,
                  latitude: s.latitude,
                  longitude: s.longitude,
                  rotationDeg: s.geoRotation,
                  scale: s.geoScale,
                }
              : null,
          levels: s.data.levels,
          updatedAt: s.updatedAt.toISOString(),
        });
      } catch (err) {
        console.error('SDK space fetch error:', err);
        return res.status(500).json({ error: 'Failed to retrieve space' });
      }
    }
  );

  app.get(
    '/api/v1/spaces/:id/geo',
    requireApiKeyOrSession,
    async (req: ApiKeyRequest, res) => {
      try {
        const db = getDb();
        const rows = await db
          .select()
          .from(spaces)
          .where(
            and(
              eq(spaces.id, String(req.params.id)),
              eq(spaces.userId, req.apiKeyUserId!)
            )
          )
          .limit(1);

        if (rows.length === 0) {
          return res.status(404).json({ error: 'Space not found' });
        }

        const s = rows[0];
        if (s.latitude === null || s.longitude === null) {
          return res.json({
            type: 'FeatureCollection',
            features: [],
          });
        }

        const lat = s.latitude;
        const lng = s.longitude;
        const metersToLat = 1 / 111320;
        const metersToLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
        const rot = ((s.geoRotation || 0) * Math.PI) / 180;
        const scale = s.geoScale || 1;

        const features = s.data.levels.flatMap((lvl) =>
          lvl.rooms
            .filter((r) => r.polygon.length >= 3)
            .map((r) => {
              const ring = r.polygon.map((pt) => {
                const sx = pt.x * scale;
                const sz = pt.z * scale;
                const rx = sx * Math.cos(rot) - sz * Math.sin(rot);
                const rz = sx * Math.sin(rot) + sz * Math.cos(rot);
                return [lng + rx * metersToLng, lat - rz * metersToLat];
              });
              ring.push(ring[0]);
              return {
                type: 'Feature',
                properties: {
                  id: r.id,
                  name: r.name,
                  level: lvl.name,
                  height: lvl.floorHeight,
                },
                geometry: {
                  type: 'Polygon',
                  coordinates: [ring],
                },
              };
            })
        );

        return res.json({
          type: 'FeatureCollection',
          features,
        });
      } catch (err) {
        console.error('SDK geo error:', err);
        return res.status(500).json({ error: 'Failed to generate GeoJSON' });
      }
    }
  );

  app.get(
    '/api/v1/spaces/:id/entities',
    requireApiKeyOrSession,
    async (req: ApiKeyRequest, res) => {
      try {
        const db = getDb();
        const spaceId = String(req.params.id);
        const owned = await db
          .select({ id: spaces.id })
          .from(spaces)
          .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.apiKeyUserId!)))
          .limit(1);
        if (owned.length === 0) {
          return res.status(404).json({ error: 'Space not found' });
        }
        const rows = await db
          .select()
          .from(spatialEntities)
          .where(
            and(
              eq(spatialEntities.spaceId, spaceId),
              eq(spatialEntities.userId, req.apiKeyUserId!)
            )
          )
          .orderBy(desc(spatialEntities.updatedAt));
        return res.json({
          spaceId,
          count: rows.length,
          entities: rows.map(serializeEntity),
        });
      } catch (err) {
        console.error('SDK entities list error:', err);
        return res.status(500).json({ error: 'Failed to retrieve entities' });
      }
    }
  );

  app.post(
    '/api/v1/spaces/:id/entities',
    requireApiKeyOrSession,
    async (req: ApiKeyRequest, res) => {
      try {
        const db = getDb();
        const spaceId = String(req.params.id);
        const spaceRows = await db
          .select()
          .from(spaces)
          .where(and(eq(spaces.id, spaceId), eq(spaces.userId, req.apiKeyUserId!)))
          .limit(1);
        if (spaceRows.length === 0) {
          return res.status(404).json({ error: 'Space not found' });
        }

        const name = String(req.body?.name || '').trim().slice(0, 80);
        if (!name) {
          return res.status(400).json({ error: 'Entity name is required' });
        }

        const [created] = await db
          .insert(spatialEntities)
          .values({
            spaceId,
            userId: req.apiKeyUserId!,
            levelId:
              String(req.body?.levelId || '').trim() ||
              spaceRows[0].data.levels[0]?.id ||
              'level_1',
            name,
            entityType: sanitizeEntityType(req.body?.entityType),
            status: sanitizeEntityStatus(req.body?.status),
            x: Number.isFinite(Number(req.body?.x)) ? Number(req.body.x) : 0,
            z: Number.isFinite(Number(req.body?.z)) ? Number(req.body.z) : 0,
            elevation: Number.isFinite(Number(req.body?.elevation))
              ? Number(req.body.elevation)
              : 1.2,
            metadata: sanitizeEntityMetadata(req.body?.metadata),
          })
          .returning();

        return res.status(201).json({ entity: serializeEntity(created) });
      } catch (err) {
        console.error('SDK entity create error:', err);
        return res.status(500).json({ error: 'Failed to create entity' });
      }
    }
  );

  app.patch(
    '/api/v1/spaces/:id/entities/:entityId',
    requireApiKeyOrSession,
    async (req: ApiKeyRequest, res) => {
      try {
        const db = getDb();
        const spaceId = String(req.params.id);
        const entityId = String(req.params.entityId);

        const existing = await db
          .select()
          .from(spatialEntities)
          .where(
            and(
              eq(spatialEntities.id, entityId),
              eq(spatialEntities.spaceId, spaceId),
              eq(spatialEntities.userId, req.apiKeyUserId!)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          return res.status(404).json({ error: 'Entity not found' });
        }

        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (typeof req.body?.name === 'string' && req.body.name.trim()) {
          patch.name = req.body.name.trim().slice(0, 80);
        }
        if (req.body?.entityType !== undefined) {
          patch.entityType = sanitizeEntityType(req.body.entityType);
        }
        if (req.body?.status !== undefined) {
          patch.status = sanitizeEntityStatus(req.body.status);
        }
        if (req.body?.x !== undefined && Number.isFinite(Number(req.body.x))) {
          patch.x = Number(req.body.x);
        }
        if (req.body?.z !== undefined && Number.isFinite(Number(req.body.z))) {
          patch.z = Number(req.body.z);
        }
        if (
          req.body?.elevation !== undefined &&
          Number.isFinite(Number(req.body.elevation))
        ) {
          patch.elevation = Number(req.body.elevation);
        }
        if (req.body?.metadata !== undefined) {
          patch.metadata = sanitizeEntityMetadata(req.body.metadata);
        }

        const [updated] = await db
          .update(spatialEntities)
          .set(patch)
          .where(
            and(
              eq(spatialEntities.id, entityId),
              eq(spatialEntities.spaceId, spaceId),
              eq(spatialEntities.userId, req.apiKeyUserId!)
            )
          )
          .returning();

        return res.json({ entity: serializeEntity(updated) });
      } catch (err) {
        console.error('SDK entity patch error:', err);
        return res.status(500).json({ error: 'Failed to update entity' });
      }
    }
  );

  // ---------------- VITE / STATIC SERVING ----------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SpaceKit server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SpaceKit server:', err);
  process.exit(1);
});
