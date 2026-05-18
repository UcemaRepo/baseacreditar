// src/db.js — Pool de conexiones a PostgreSQL
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// Render expone DATABASE_URL automáticamente cuando linkeás un Postgres al servicio.
// Si DATABASE_URL no existe (entorno local), usamos vars sueltas.
const connectionString = process.env.DATABASE_URL;

const config = connectionString
  ? {
      connectionString,
      // Render Postgres requiere SSL pero con certificado autofirmado
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'ucema_acreditacion',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    };

export const pool = new Pool({
  ...config,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db] Error inesperado en cliente idle:', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const dur = Date.now() - start;
  if (dur > 500) console.warn(`[db] Slow query (${dur}ms):`, text.slice(0, 80));
  return res;
}

export default pool;
