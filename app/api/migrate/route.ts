import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

// POST /api/migrate — runs pending schema migrations
// Protected by ADMIN_SECRET header to avoid accidental public access
//
// Cada migración corre en su propio try/catch: si una falla por estado ya
// aplicado parcialmente (constraint violado por filas con valor nuevo, etc.)
// las siguientes migraciones igual se intentan. El response lista cuáles
// pasaron (`applied`) y cuáles fallaron (`failed`).
export async function POST(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (!secret || secret !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applied: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  async function runMigration(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      applied.push(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ name, error: msg });
    }
  }

  await runMigration("0002_render_method", async () => {
    await sql`
      ALTER TABLE proyectos
        ADD COLUMN IF NOT EXISTS render_method VARCHAR(20) NOT NULL DEFAULT 'original'
          CHECK (render_method IN ('original', 'mirage'))
    `;
  });

  await runMigration("0003_cortes", async () => {
    await sql`
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
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_cortes_status ON cortes(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cortes_created ON cortes(created_at DESC)`;
  });

  await runMigration("0004_edl_url", async () => {
    await sql`ALTER TABLE cortes ADD COLUMN IF NOT EXISTS edl_url TEXT`;
  });

  await runMigration("0005_capcut_url", async () => {
    await sql`ALTER TABLE cortes ADD COLUMN IF NOT EXISTS capcut_url TEXT`;
  });

  // 0006: extender proyectos para 'cortes'. El constraint se reaplica en 0007
  // con el conjunto completo de valores. Si esta migración cae por filas
  // ya en estado 'multiclip', NO bloquea las siguientes — la 0007 la
  // sobreescribirá con el constraint correcto.
  await runMigration("0006_proyectos_cortes_columns", async () => {
    await sql`
      ALTER TABLE proyectos
        ADD COLUMN IF NOT EXISTS xml_url TEXT,
        ADD COLUMN IF NOT EXISTS edl_url TEXT,
        ADD COLUMN IF NOT EXISTS capcut_url TEXT,
        ADD COLUMN IF NOT EXISTS cortes_analysis JSONB,
        ADD COLUMN IF NOT EXISTS keep_segments_count INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS duracion_seg REAL DEFAULT 0
    `;
  });

  await runMigration("0007_multiclip_columns", async () => {
    await sql`
      ALTER TABLE proyectos
        ADD COLUMN IF NOT EXISTS clips JSONB,
        ADD COLUMN IF NOT EXISTS guion TEXT,
        ADD COLUMN IF NOT EXISTS subtitulos_override JSONB,
        ADD COLUMN IF NOT EXISTS plan_multiclip JSONB
    `;
  });

  // 0007b: constraint final que admite los 4 valores. Se aplica DESPUÉS de
  // las columnas para no chocar con valores existentes que aún no encajan.
  await runMigration("0007b_render_method_constraint", async () => {
    await sql`
      ALTER TABLE proyectos
        DROP CONSTRAINT IF EXISTS proyectos_render_method_check
    `;
    await sql`
      ALTER TABLE proyectos
        ADD CONSTRAINT proyectos_render_method_check
        CHECK (render_method IN ('original', 'mirage', 'cortes', 'multiclip'))
    `;
  });

  // 0008: ownership por usuario (user_id nullable). Indices para acelerar
  // los WHERE user_id = $1 que ahora filtran todas las lecturas.
  await runMigration("0008_user_id", async () => {
    await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS user_id TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_proyectos_user ON proyectos(user_id)`;
    await sql`ALTER TABLE cortes ADD COLUMN IF NOT EXISTS user_id TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cortes_user ON cortes(user_id)`;
  });

  // 0009: columna progress JSONB para que cada step del pipeline reporte
  // su avance real (label, detail, startedAt, percent). La UI lo usa para
  // mostrar el cronometro vivo y el sub-paso actual sin tener que inferir
  // desde campos poblados.
  await runMigration("0009_progress", async () => {
    await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS progress JSONB`;
  });

  // 0010: srt_url para descargar subtitulos SRT. Universal — Premiere/
  // DaVinci/CapCut/YouTube lo importan sin conversion.
  await runMigration("0010_srt_url", async () => {
    await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS srt_url TEXT`;
  });

  // 0011: render_subtitulos flag. Si true, el pipeline multiclip hace el
  // step de render Remotion al final (MP4 con subs quemados, +10-15min).
  await runMigration("0011_render_subtitulos", async () => {
    await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS render_subtitulos BOOLEAN NOT NULL DEFAULT false`;
  });

  // 0012: incluir_clips_en_zip flag. Si true, el ZIP CapCut embebe los
  // clips originales adentro (puede pesar GB, +10-15min). Default false:
  // el ZIP queda en KB con solo draft + README con URLs publicas.
  await runMigration("0012_incluir_clips_en_zip", async () => {
    await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS incluir_clips_en_zip BOOLEAN NOT NULL DEFAULT false`;
  });

  return NextResponse.json({
    ok: failed.length === 0,
    applied,
    failed,
  });
}
