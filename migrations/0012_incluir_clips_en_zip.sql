-- 0012: flag incluir_clips_en_zip.
--
-- Por default el ZIP CapCut de proyectos multiclip NO incluye los clips
-- originales (puede pesar GB y demora 10-15 min en empaquetar+subir). El
-- usuario obtiene el ZIP con solo draft_content.json + draft_meta_info.json
-- + un README con las URLs publicas de los clips para descarga manual.
--
-- Si el cliente marca este flag al crear el proyecto, el pipeline embeded
-- los clips dentro del ZIP como antes (flujo legacy / power user).

ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS incluir_clips_en_zip BOOLEAN NOT NULL DEFAULT false;
