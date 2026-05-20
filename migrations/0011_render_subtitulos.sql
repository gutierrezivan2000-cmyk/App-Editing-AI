-- 0011: flag render_subtitulos.
--
-- Por default el pipeline multiclip NO renderiza un MP4 con subs quemados
-- (toma 10-15 min adicionales). Si el cliente marca este flag al crear el
-- proyecto, el pipeline ejecuta el step de render Remotion al final.
--
-- Sirve para casos donde el usuario final necesita un MP4 plug-and-play
-- (postear directo a redes sin pasar por CapCut/Premiere).

ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS render_subtitulos BOOLEAN NOT NULL DEFAULT false;
