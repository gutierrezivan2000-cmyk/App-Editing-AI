CREATE TABLE IF NOT EXISTS clientes (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  perfil_json JSONB NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proyectos (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  cliente_id      TEXT REFERENCES clientes(id),
  nombre          TEXT NOT NULL,
  brief           TEXT NOT NULL,
  footage_url     TEXT NOT NULL,
  output_url      TEXT,
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','error')),
  clickup_task_id TEXT,
  error_message   TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proyectos_cliente  ON proyectos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_proyectos_status   ON proyectos(status);
CREATE INDEX IF NOT EXISTS idx_proyectos_clickup  ON proyectos(clickup_task_id);
