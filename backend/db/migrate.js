import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const run = async () => {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] No migration files found');
    process.exit(0);
  }

  const client = await pool.connect();

  try {
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      console.log(`[migrate] Running ${file}`);
      await client.query(sql);
    }

    console.log('[migrate] All migrations completed');
    process.exit(0);
  } catch (error) {
    console.error('[migrate] Failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

run();
