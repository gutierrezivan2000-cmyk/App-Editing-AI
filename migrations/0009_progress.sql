-- 0009: columna progress JSONB.
--
-- Hasta ahora la UI mostraba el step activo del pipeline inferiendo desde
-- los campos poblados (clips → step 1, planMulticlip → step 3, etc). Esto
-- daba la impresion de "nada pasa" durante steps largos como
-- analyze-clips (3-5 min) o el render Remotion (8-15 min).
--
-- Con esta columna, cada step del pipeline puede reportar su avance real:
--   {
--     "step": 2,                                    // indice 0-based
--     "label": "Transcripcion Whisper",            // que esta haciendo
--     "detail": "Procesando clip 3 de 6",          // sub-paso (opcional)
--     "startedAt": "2026-05-19T12:34:56.789Z",     // para el cronometro
--     "percent": 50                                 // opcional, 0-100
--   }
--
-- La UI hace polling y muestra el cronometro vivo + el detail.

ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS progress JSONB;
