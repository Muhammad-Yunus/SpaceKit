import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema.ts';

let pool: Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;
let schemaInitialized = false;
let schemaInitPromise: Promise<void> | null = null;

function buildPoolConfig() {
  const host = process.env.PGHOST?.trim();
  const user = process.env.PGUSER?.trim();
  const password = process.env.PGPASSWORD?.trim();
  const database = process.env.PGDATABASE?.trim() || 'postgres';
  const port = Number(process.env.PGPORT || 5432);

  if (host && user && password) {
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    return {
      host,
      port,
      database,
      user,
      password,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    };
  }

  return null;
}

export function isDatabaseConfigured(): boolean {
  return buildPoolConfig() !== null;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (dbInstance) return dbInstance;
  const config = buildPoolConfig();
  if (!config) {
    throw new Error(
      'PostgreSQL connection is not configured. Set PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD in environment variables.'
    );
  }
  pool = new Pool(config);
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}

export async function ensureDatabaseSchema(): Promise<void> {
  if (schemaInitialized) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    const config = buildPoolConfig();
    if (!config) return;
    getDb();
    if (!pool) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        workspace_name TEXT NOT NULL DEFAULT 'Personal spaces',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        environment TEXT NOT NULL DEFAULT 'production',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'live',
        locked BOOLEAN NOT NULL DEFAULT FALSE,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        sqft INTEGER NOT NULL DEFAULT 0,
        views INTEGER NOT NULL DEFAULT 0,
        complexity INTEGER NOT NULL DEFAULT 1,
        size_kb INTEGER NOT NULL DEFAULT 0,
        address TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        geo_rotation DOUBLE PRECISION NOT NULL DEFAULT 0,
        geo_scale DOUBLE PRECISION NOT NULL DEFAULT 1,
        thumbnail_url TEXT,
        source_cad_image_url TEXT,
        data JSONB NOT NULL,
        unpublished_data JSONB,
        published_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        scopes JSONB NOT NULL DEFAULT '["spaces:read","geo:read"]'::jsonb,
        request_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ai_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        image_data_url TEXT,
        applied_design_update BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS spatial_entities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        level_id TEXT NOT NULL DEFAULT 'level_1',
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL DEFAULT 'sensor',
        status TEXT NOT NULL DEFAULT 'online',
        x DOUBLE PRECISION NOT NULL DEFAULT 0,
        z DOUBLE PRECISION NOT NULL DEFAULT 0,
        elevation DOUBLE PRECISION NOT NULL DEFAULT 1.2,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    schemaInitialized = true;
  })().catch((err) => {
    schemaInitPromise = null;
    throw err;
  });

  return schemaInitPromise;
}
