import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.PGHOST ?? '',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER ?? '',
    password: process.env.PGPASSWORD ?? '',
    database: process.env.PGDATABASE ?? 'postgres',
    ssl:
      process.env.PGHOST === 'localhost' || process.env.PGHOST === '127.0.0.1'
        ? false
        : { rejectUnauthorized: false },
  },
});
