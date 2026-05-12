ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS render_method VARCHAR(20) NOT NULL DEFAULT 'original'
    CHECK (render_method IN ('original', 'mirage'));
