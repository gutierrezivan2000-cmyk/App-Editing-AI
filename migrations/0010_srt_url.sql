-- 0010: srt_url para descargar subtitulos en formato SRT.
--
-- SRT es el formato universal de subtitulos — Premiere/DaVinci/CapCut
-- lo importan nativamente, sin conversion. Mejora notable sobre el
-- approach anterior que dejaba los subtitulos solo embebidos en el
-- CapCut draft (frances al editor de Premiere).

ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS srt_url TEXT;
