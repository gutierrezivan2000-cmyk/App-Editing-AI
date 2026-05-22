-- Módulo independiente: montaje (cortar silencios + entregar video final ya cortado)
-- Diferente del módulo "cortes" (que solo genera XML/EDL): este sí renderiza el MP4.
CREATE TABLE IF NOT EXISTS montajes (
  id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  nombre                   TEXT NOT NULL,
  footage_url              TEXT NOT NULL,
  video_final_url          TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  step                     TEXT,
  error_message            TEXT,
  umbral_db                REAL DEFAULT -30,
  duracion_minima          REAL DEFAULT 0.5,
  margen_seg               REAL DEFAULT 0.05,
  silencios_count          INT  DEFAULT 0,
  segments_count           INT  DEFAULT 0,
  duracion_original_seg    REAL DEFAULT 0,
  duracion_final_seg       REAL DEFAULT 0,
  created_at               TIMESTAMP DEFAULT NOW(),
  updated_at               TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_montajes_status  ON montajes(status);
CREATE INDEX IF NOT EXISTS idx_montajes_created ON montajes(created_at DESC);
