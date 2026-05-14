import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

// POST /api/migrate — runs pending schema migrations
// Protected by ADMIN_SECRET header to avoid accidental public access
export async function POST(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (!secret || secret !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applied: string[] = [];
  try {
    // 0002: render_method en proyectos
    await sql`
      ALTER TABLE proyectos
        ADD COLUMN IF NOT EXISTS render_method VARCHAR(20) NOT NULL DEFAULT 'original'
          CHECK (render_method IN ('original', 'mirage'))
    `;
    applied.push("0002_render_method");

    // 0003: tabla cortes (módulo independiente silencios → XML)
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
    applied.push("0003_cortes");

    // 0004: columna edl_url en cortes (DaVinci Resolve export)
    await sql`
      ALTER TABLE cortes
        ADD COLUMN IF NOT EXISTS edl_url TEXT
    `;
    applied.push("0004_edl_url");

    // 0005: tabla montajes (cortar silencios + montar MP4 final)
    await sql`
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
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_montajes_status  ON montajes(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_montajes_created ON montajes(created_at DESC)`;
    applied.push("0005_montajes");

    return NextResponse.json({ ok: true, applied });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, applied }, { status: 500 });
  }
}
