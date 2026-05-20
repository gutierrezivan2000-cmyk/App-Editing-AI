-- 0008: ownership por usuario.
--
-- Antes de esta migracion la app no tenia autorizacion: cualquier sesion
-- (o cualquier llamada no autenticada, dado que el middleware solo cubria
-- /dashboard) podia leer/escribir proyectos ajenos.
--
-- Decision: user_id NULLABLE para no romper filas existentes. Las queries
-- de read filtran por (user_id = $1 OR user_id IS NULL) para que los
-- proyectos pre-migracion sigan siendo visibles para el primer usuario
-- que los reclame. Las filas nuevas SIEMPRE traen user_id.

ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_proyectos_user ON proyectos(user_id);

ALTER TABLE cortes
  ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cortes_user ON cortes(user_id);
