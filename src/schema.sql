-- ┌────────────────────────────────────────────────────────────────────┐
-- │ UCEMA Acreditación — Schema PostgreSQL                             │
-- └────────────────────────────────────────────────────────────────────┘

-- Inscriptos previos al evento (cargados desde XLSX)
CREATE TABLE IF NOT EXISTS attendees (
  dni            TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  apellido       TEXT NOT NULL,
  colegio        TEXT,
  canal          TEXT,
  email          TEXT,
  telefono       TEXT,
  evento         TEXT NOT NULL DEFAULT 'ucema_open_mayo_2026',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Columnas VIP: se agregan vía ALTER para no romper bases existentes
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS es_admitido     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS carrera_admitida TEXT;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS asesor          TEXT;

CREATE INDEX IF NOT EXISTS idx_attendees_evento    ON attendees(evento);
CREATE INDEX IF NOT EXISTS idx_attendees_admitido  ON attendees(evento) WHERE es_admitido = TRUE;

-- Acreditaciones de inscriptos (registro del momento que se presentaron)
CREATE TABLE IF NOT EXISTS accreditations (
  id             BIGSERIAL PRIMARY KEY,
  dni            TEXT NOT NULL REFERENCES attendees(dni) ON DELETE CASCADE,
  acompaniantes  INTEGER NOT NULL DEFAULT 0,
  evento         TEXT NOT NULL DEFAULT 'ucema_open_mayo_2026',
  accredited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  device_id      TEXT,
  UNIQUE (dni, evento)
);

CREATE INDEX IF NOT EXISTS idx_acc_evento ON accreditations(evento);

-- Personas no inscriptas que se presentaron el día del evento
CREATE TABLE IF NOT EXISTS espontaneos (
  id             BIGSERIAL PRIMARY KEY,
  nombre         TEXT NOT NULL,
  dni            TEXT,
  telefono       TEXT,
  email          TEXT,
  acompaniantes  INTEGER NOT NULL DEFAULT 0,
  evento         TEXT NOT NULL DEFAULT 'ucema_open_mayo_2026',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  device_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_esp_evento ON espontaneos(evento);

-- Log de auditoría: toda acción queda registrada
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  action         TEXT NOT NULL,         -- 'accredit', 'deaccredit', 'esp_add', 'esp_remove', 'esp_update'
  dni            TEXT,
  payload        JSONB,
  device_id      TEXT,
  evento         TEXT NOT NULL DEFAULT 'ucema_open_mayo_2026',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_evento_time ON audit_log(evento, created_at DESC);
