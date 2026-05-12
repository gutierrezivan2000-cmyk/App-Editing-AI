import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

// POST /api/migrate — runs pending schema migrations
// Protected by ADMIN_SECRET header to avoid accidental public access
export async function POST(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (!secret || secret !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await sql`
      ALTER TABLE proyectos
        ADD COLUMN IF NOT EXISTS render_method VARCHAR(20) NOT NULL DEFAULT 'original'
          CHECK (render_method IN ('original', 'mirage'))
    `;

    return NextResponse.json({ ok: true, message: "Migrations applied" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
