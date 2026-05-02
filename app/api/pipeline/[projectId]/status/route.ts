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
      outputUrl: project.outputUrl ?? null,
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
