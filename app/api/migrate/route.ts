import { sql } from "@vercel/postgres";
import { NextResponse } from "next/server";

const DEMO_CLIENTE = {
  id: "cliente-demo",
  nombre: "Cliente Demo",
  redes: ["instagram_reels", "tiktok"],
  subtitulos: {
    fuente_principal: "Montserrat",
    fuente_enfasis: "Bebas Neue",
    tamano_base: 48,
    tamano_enfasis: 80,
    color_base: "#FFFFFF",
    color_enfasis: "#FF6B35",
    posicion: "bottom-center",
    animacion: "pop-scale",
    palabras_por_linea: 4,
    sombra: true,
  },
  silencio: { umbral_db: -35, duracion_minima_seg: 0.4, margen_seg: 0.15 },
  exportacion: { formatos: ["9:16", "1:1"], fps: 30, bitrate: "8M" },
};

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

    // Seed demo cliente
    await sql`
      INSERT INTO clientes (id, nombre, perfil_json)
      VALUES (
        ${DEMO_CLIENTE.id},
        ${DEMO_CLIENTE.nombre},
        ${JSON.stringify(DEMO_CLIENTE)}
      )
      ON CONFLICT (id) DO NOTHING
    `;

    return NextResponse.json({
      ok: true,
      message: "Migración y seed completados — cliente-demo insertado",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
