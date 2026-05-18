// src/server.js — UCEMA Acreditación API + WebSocket
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import * as XLSX from 'xlsx';
import cors from 'cors';
import 'dotenv/config';
import { query, pool } from './db.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const EVENTO_DEFAULT = process.env.EVENTO_ID || 'ucema_open_mayo_2026';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Helpers ─────────────────────────────────────────────────────────
function normalizeDni(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[^\d]/g, '').trim();
}

async function ensureSchema() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('[boot] Schema OK');
}

async function broadcastState(evento) {
  const state = await getFullState(evento);
  io.to(`evento:${evento}`).emit('state:update', state);
}

async function getFullState(evento) {
  const [attRes, accRes, espRes] = await Promise.all([
    query(
      `SELECT dni, nombre, apellido, colegio, canal, email, telefono
         FROM attendees WHERE evento = $1 ORDER BY apellido, nombre`,
      [evento]
    ),
    query(
      `SELECT dni, acompaniantes, accredited_at, device_id
         FROM accreditations WHERE evento = $1`,
      [evento]
    ),
    query(
      `SELECT id, nombre, dni, telefono, email, acompaniantes, created_at, device_id
         FROM espontaneos WHERE evento = $1 ORDER BY created_at`,
      [evento]
    ),
  ]);

  return {
    ok: true,
    evento,
    attendees: attRes.rows,
    accreditations: accRes.rows.reduce((acc, row) => {
      acc[row.dni] = {
        acompaniantes: row.acompaniantes,
        accredited_at: row.accredited_at,
        device_id: row.device_id,
      };
      return acc;
    }, {}),
    espontaneos: espRes.rows,
    timestamp: new Date().toISOString(),
  };
}

async function logAction(action, dni, payload, deviceId, evento) {
  try {
    await query(
      `INSERT INTO audit_log (action, dni, payload, device_id, evento)
       VALUES ($1, $2, $3, $4, $5)`,
      [action, dni, payload, deviceId || null, evento]
    );
  } catch (e) {
    console.error('[audit] Error logging:', e.message);
  }
}

// ─── REST API ────────────────────────────────────────────────────────

// GET /api/state — estado completo (inscriptos + acreditados + espontáneos)
app.get('/api/state', async (req, res) => {
  try {
    const evento = req.query.evento || EVENTO_DEFAULT;
    const state = await getFullState(evento);
    res.json(state);
  } catch (e) {
    console.error('[GET /api/state]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/accredit — acreditar a un inscripto
app.post('/api/accredit', async (req, res) => {
  try {
    const { dni, acompaniantes = 0, device_id } = req.body;
    const evento = req.body.evento || EVENTO_DEFAULT;
    const cleanDni = normalizeDni(dni);
    if (!cleanDni) return res.status(400).json({ ok: false, error: 'DNI requerido' });

    const exists = await query('SELECT 1 FROM attendees WHERE dni = $1 AND evento = $2', [cleanDni, evento]);
    if (exists.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'DNI no está en la lista de inscriptos' });
    }

    await query(
      `INSERT INTO accreditations (dni, acompaniantes, evento, device_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (dni, evento)
       DO UPDATE SET acompaniantes = EXCLUDED.acompaniantes,
                     accredited_at = NOW(),
                     device_id = EXCLUDED.device_id`,
      [cleanDni, parseInt(acompaniantes) || 0, evento, device_id || null]
    );

    await logAction('accredit', cleanDni, { acompaniantes }, device_id, evento);
    await broadcastState(evento);
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/accredit]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/deaccredit — quitar acreditación
app.post('/api/deaccredit', async (req, res) => {
  try {
    const { dni, device_id } = req.body;
    const evento = req.body.evento || EVENTO_DEFAULT;
    const cleanDni = normalizeDni(dni);
    if (!cleanDni) return res.status(400).json({ ok: false, error: 'DNI requerido' });

    await query('DELETE FROM accreditations WHERE dni = $1 AND evento = $2', [cleanDni, evento]);
    await logAction('deaccredit', cleanDni, {}, device_id, evento);
    await broadcastState(evento);
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/deaccredit]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/espontaneo — agregar espontáneo
app.post('/api/espontaneo', async (req, res) => {
  try {
    const { nombre, dni, telefono, email, acompaniantes = 0, device_id } = req.body;
    const evento = req.body.evento || EVENTO_DEFAULT;
    if (!nombre || !nombre.trim()) return res.status(400).json({ ok: false, error: 'Nombre requerido' });

    const r = await query(
      `INSERT INTO espontaneos (nombre, dni, telefono, email, acompaniantes, evento, device_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        nombre.trim(),
        dni ? normalizeDni(dni) : null,
        telefono || null,
        email || null,
        parseInt(acompaniantes) || 0,
        evento,
        device_id || null,
      ]
    );

    await logAction('esp_add', null, { id: r.rows[0].id, nombre, dni }, device_id, evento);
    await broadcastState(evento);
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    console.error('[POST /api/espontaneo]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/espontaneo/:id
app.delete('/api/espontaneo/:id', async (req, res) => {
  try {
    const evento = req.query.evento || EVENTO_DEFAULT;
    const deviceId = req.query.device_id;
    await query('DELETE FROM espontaneos WHERE id = $1 AND evento = $2', [req.params.id, evento]);
    await logAction('esp_remove', null, { id: req.params.id }, deviceId, evento);
    await broadcastState(evento);
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /api/espontaneo]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/upload-attendees — subir XLSX de inscriptos
// Espera columnas: nombre, apellido, dni, colegio, canal, email, telefono (case-insensitive)
app.post('/api/upload-attendees', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' });
    const evento = req.body.evento || EVENTO_DEFAULT;
    const replace = req.body.replace === 'true';

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'El archivo está vacío' });
    }

    // Mapeo flexible de columnas (case-insensitive, sin acentos)
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const first = rows[0];
    const keys = Object.keys(first);
    const findKey = (...candidates) => {
      for (const k of keys) {
        const nk = norm(k);
        if (candidates.some((c) => nk === norm(c) || nk.includes(norm(c)))) return k;
      }
      return null;
    };
    const kDni = findKey('dni', 'documento');
    const kNombre = findKey('nombre', 'first name');
    const kApellido = findKey('apellido', 'last name');
    const kColegio = findKey('colegio', 'school', 'institucion');
    const kCanal = findKey('canal', 'origen', 'source');
    const kEmail = findKey('email', 'correo', 'mail');
    const kTel = findKey('telefono', 'phone', 'celular', 'whatsapp');

    if (!kDni || !kNombre || !kApellido) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan columnas obligatorias: nombre, apellido, dni',
        detectedColumns: keys,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (replace) {
        await client.query('DELETE FROM attendees WHERE evento = $1', [evento]);
      }

      let inserted = 0;
      let skipped = 0;
      for (const row of rows) {
        const dni = normalizeDni(row[kDni]);
        if (!dni) { skipped++; continue; }
        await client.query(
          `INSERT INTO attendees (dni, nombre, apellido, colegio, canal, email, telefono, evento)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (dni) DO UPDATE SET
             nombre = EXCLUDED.nombre,
             apellido = EXCLUDED.apellido,
             colegio = EXCLUDED.colegio,
             canal = EXCLUDED.canal,
             email = EXCLUDED.email,
             telefono = EXCLUDED.telefono`,
          [
            dni,
            String(row[kNombre] || '').trim(),
            String(row[kApellido] || '').trim(),
            kColegio ? String(row[kColegio] || '').trim() : '',
            kCanal ? String(row[kCanal] || '').trim() : '',
            kEmail ? String(row[kEmail] || '').trim() : null,
            kTel ? String(row[kTel] || '').trim() : null,
            evento,
          ]
        );
        inserted++;
      }
      await client.query('COMMIT');
      await broadcastState(evento);
      res.json({ ok: true, inserted, skipped, total: rows.length });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('[POST /api/upload-attendees]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/audit — últimas N entradas del log (para debug / panel admin)
app.get('/api/audit', async (req, res) => {
  try {
    const evento = req.query.evento || EVENTO_DEFAULT;
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const r = await query(
      `SELECT id, action, dni, payload, device_id, created_at
         FROM audit_log WHERE evento = $1 ORDER BY created_at DESC LIMIT $2`,
      [evento, limit]
    );
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Healthcheck para Render
app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Socket.IO ───────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const evento = socket.handshake.query.evento || EVENTO_DEFAULT;
  socket.join(`evento:${evento}`);
  console.log(`[ws] cliente conectado: ${socket.id} → ${evento}`);

  // Mandamos estado inicial al conectarse
  getFullState(evento).then((state) => socket.emit('state:update', state)).catch(console.error);

  socket.on('disconnect', () => {
    console.log(`[ws] cliente desconectado: ${socket.id}`);
  });
});

// ─── Boot ────────────────────────────────────────────────────────────
ensureSchema()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`[boot] UCEMA Acreditación escuchando en :${PORT}`);
      console.log(`[boot] Evento por defecto: ${EVENTO_DEFAULT}`);
    });
  })
  .catch((e) => {
    console.error('[boot] No se pudo inicializar:', e);
    process.exit(1);
  });
