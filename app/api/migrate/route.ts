import { sql } from "@vercel/postgres";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        email      TEXT UNIQUE NOT NULL,
        password   TEXT NOT NULL,
        name       TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;

    await sql`
      CREATE TABLE IF NOT EXISTS clientes (
        id          TEXT PRIMARY KEY,
        nombre      TEXT NOT NULL,
        perfil_json JSONB NOT NULL,
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
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
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_proyectos_cliente ON proyectos(cliente_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_proyectos_status  ON proyectos(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_proyectos_clickup ON proyectos(clickup_task_id)`;

    return NextResponse.json({ ok: true, message: "Migración completada" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
