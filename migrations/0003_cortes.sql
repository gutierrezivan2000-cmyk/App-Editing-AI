-- Tabla independiente para el módulo de cortes → XML Premiere
-- Separada de proyectos para no interferir con el pipeline original

CREATE TABLE IF NOT EXISTS cortes (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  nombre            TEXT NOT NULL,
  footage_url       TEXT NOT NULL,
  xml_url           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  error_message     TEXT,
  umbral_db         REAL DEFAULT -30,
  duracion_minima   REAL DEFAULT 0.5,
  margen_seg        REAL DEFAULT 0.05,
  silencios_count   INT  DEFAULT 0,
  segments_count    INT  DEFAULT 0,
  duracion_seg      REAL DEFAULT 0,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cortes_status ON cortes(status);
CREATE INDEX IF NOT EXISTS idx_cortes_created ON cortes(created_at DESC);
