import { NextResponse } from "next/server";
import { getMontaje } from "@/lib/montajes-db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const m = await getMontaje(id);
    return NextResponse.json({
      id: m.id,
      nombre: m.nombre,
      footageUrl: m.footageUrl,
      videoFinalUrl: m.videoFinalUrl,
      status: m.status,
      step: m.step,
      errorMessage: m.errorMessage,
      silenciosCount: m.silenciosCount,
      segmentsCount: m.segmentsCount,
      duracionOriginalSeg: m.duracionOriginalSeg,
      duracionFinalSeg: m.duracionFinalSeg,
      updatedAt: m.updatedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
