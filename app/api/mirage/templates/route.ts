import { NextResponse } from "next/server";
import { listarTemplates } from "@/lib/mirage";
import { requireAuth } from "@/lib/api-auth";

// GET /api/mirage/templates
// Returns available caption templates for the configured MIRAGE_API_KEY.
// Use this to find the correct MIRAGE_CAPTION_TEMPLATE_ID value.
export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const templates = await listarTemplates();
    return NextResponse.json({ templates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
