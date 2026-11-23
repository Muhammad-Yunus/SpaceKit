import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb, ensureDatabaseSchema, isDatabaseConfigured } from './db.ts';
import { users, sessions, apiKeys } from '../src/db/schema.ts';
import type { AuthUser } from '../src/types/space.ts';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionTokenHash?: string;
}

export interface ApiKeyRequest extends Request {
  apiKeyUserId?: string;
  apiKeyId?: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function createUserSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  await ensureDatabaseSchema();
  const db = getDb();
  const token = `sk_sess_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
  });

  return { token, expiresAt };
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await ensureDatabaseSchema();
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  return null;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!isDatabaseConfigured()) {
      return res.status(503).json({
        error:
          'Database connection is not configured. Set PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD in environment secrets.',
      });
    }

    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await ensureDatabaseSchema();
    const db = getDb();
    const tokenHash = hashToken(token);
    const now = new Date();

    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        workspaceName: users.workspaceName,
        createdAt: users.createdAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
      .limit(1);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const row = rows[0];
    req.user = {
      id: row.userId,
      email: row.email,
      name: row.name,
      workspaceName: row.workspaceName,
      createdAt: row.createdAt.toISOString(),
    };
    req.sessionTokenHash = tokenHash;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Authentication check failed' });
  }
}

export async function requireApiKeyOrSession(
  req: ApiKeyRequest & AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!isDatabaseConfigured()) {
      return res.status(503).json({
        error: 'Database connection is not configured.',
      });
    }

    await ensureDatabaseSchema();
    const db = getDb();

    const rawApiKey =
      (req.headers['x-spacekit-key'] as string | undefined)?.trim() ||
      (extractBearerToken(req)?.startsWith('sk_live_')
        ? extractBearerToken(req)
        : null);

    if (rawApiKey) {
      const keyHash = hashToken(rawApiKey);
      const found = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1);

      if (found.length === 0) {
        return res.status(401).json({ error: 'Invalid SpaceKit API key' });
      }

      await db
        .update(apiKeys)
        .set({
          requestCount: sql`${apiKeys.requestCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(apiKeys.id, found[0].id));

      req.apiKeyUserId = found[0].userId;
      req.apiKeyId = found[0].id;
      return next();
    }

    return requireAuth(req, res, () => {
      req.apiKeyUserId = req.user?.id;
      next();
    });
  } catch (err) {
    console.error('API key auth error:', err);
    return res.status(500).json({ error: 'API authentication failed' });
  }
}
