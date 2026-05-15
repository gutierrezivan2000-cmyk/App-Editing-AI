import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const project = await getProject(projectId);
    return NextResponse.json({
      status: project.status,
      renderMethod: project.renderMethod,
      outputUrl: project.outputUrl ?? null,
      xmlUrl: project.xmlUrl ?? null,
      edlUrl: project.edlUrl ?? null,
      capcutUrl: project.capcutUrl ?? null,
      cortesAnalysis: project.cortesAnalysis ?? null,
      keepSegmentsCount: project.keepSegmentsCount ?? null,
      duracionSeg: project.duracionSeg ?? null,
      errorMessage: project.errorMessage ?? null,
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
