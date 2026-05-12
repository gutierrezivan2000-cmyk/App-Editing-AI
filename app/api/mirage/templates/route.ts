import { NextResponse } from "next/server";
import { listarTemplates } from "@/lib/mirage";

// GET /api/mirage/templates
// Returns available caption templates for the configured MIRAGE_API_KEY.
// Use this to find the correct MIRAGE_CAPTION_TEMPLATE_ID value.
export async function GET() {
  try {
    const templates = await listarTemplates();
    return NextResponse.json({ templates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
