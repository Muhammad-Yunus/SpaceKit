import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { SpaceData } from '../types/space.ts';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  workspaceName: text('workspace_name').notNull().default('Personal spaces'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  environment: text('environment').notNull().default('production'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const spaces = pgTable('spaces', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('live'),
  locked: boolean('locked').notNull().default(false),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  sqft: integer('sqft').notNull().default(0),
  views: integer('views').notNull().default(0),
  complexity: integer('complexity').notNull().default(1),
  sizeKb: integer('size_kb').notNull().default(0),
  address: text('address'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  geoRotation: doublePrecision('geo_rotation').notNull().default(0),
  geoScale: doublePrecision('geo_scale').notNull().default(1),
  thumbnailUrl: text('thumbnail_url'),
  sourceCadImageUrl: text('source_cad_image_url'),
  data: jsonb('data').$type<SpaceData>().notNull(),
  unpublishedData: jsonb('unpublished_data').$type<SpaceData | null>(),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default(['spaces:read', 'geo:read']),
  requestCount: integer('request_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiMessages = pgTable('ai_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  spaceId: text('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  imageDataUrl: text('image_data_url'),
  appliedDesignUpdate: boolean('applied_design_update').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
