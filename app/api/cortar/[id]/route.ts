import { NextResponse } from "next/server";
import { getCorte } from "@/lib/cortes-db";
import { getLocalFilename } from "@/lib/premiere-xml";
import { requireAuth } from "@/lib/api-auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { id } = await params;
    const corte = await getCorte(id);
    return NextResponse.json({
      id: corte.id,
      nombre: corte.nombre,
      status: corte.status,
      xmlUrl: corte.xmlUrl,
      edlUrl: corte.edlUrl,
      capcutUrl: corte.capcutUrl,
      footageUrl: corte.footageUrl,
      localFilename: getLocalFilename(corte.nombre, corte.footageUrl),
      errorMessage: corte.errorMessage,
      silenciosCount: corte.silenciosCount,
      segmentsCount: corte.segmentsCount,
      duracionSeg: corte.duracionSeg,
      updatedAt: corte.updatedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
