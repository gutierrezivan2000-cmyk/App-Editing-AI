import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { projectId } = await params;
    const project = await getProject(projectId, session.user.id);
    return NextResponse.json({
      status: project.status,
      renderMethod: project.renderMethod,
      outputUrl: project.outputUrl ?? null,
      xmlUrl: project.xmlUrl ?? null,
      edlUrl: project.edlUrl ?? null,
      capcutUrl: project.capcutUrl ?? null,
      srtUrl: project.srtUrl ?? null,
      renderSubtitulos: project.renderSubtitulos ?? false,
      cortesAnalysis: project.cortesAnalysis ?? null,
      keepSegmentsCount: project.keepSegmentsCount ?? null,
      duracionSeg: project.duracionSeg ?? null,
      clips: project.clips ?? null,
      guion: project.guion ?? null,
      planMulticlip: project.planMulticlip ?? null,
      errorMessage: project.errorMessage ?? null,
      progress: project.progress ?? null,
      updatedAt: project.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("[status/route]", error);
    return NextResponse.json(
      { error: "Proyecto no encontrado" },
      { status: 404 }
    );
  }
}
