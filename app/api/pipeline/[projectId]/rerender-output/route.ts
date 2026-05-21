import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { inngest } from "@/inngest/client";

/**
 * POST /api/pipeline/[projectId]/rerender-output
 *
 * Encola un job Inngest que re-arma el video final del proyecto con el
 * estado actual:
 *   - plan_multiclip (snippets reordenados / recortados en el editor)
 *   - transcripcion ajustada (palabras editadas en el editor)
 *   - subtitulos_override (estilo personalizado del editor)
 *
 * Solo soportado para proyectos multiclip que ya esten en estado
 * `completed` (es decir, ya corrio el pipeline original al menos una vez).
 * Marca el proyecto como `processing` y limpia errores previos.
 *
 * El usuario recibe 202 inmediato. La UI debe navegar al detalle del
 * proyecto donde PipelineStatus muestra el progreso en vivo via polling.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  const { projectId } = await params;

  let project;
  try {
    project = await getProject(projectId, session.user.id);
  } catch {
    return NextResponse.json(
      { error: "Proyecto no encontrado" },
      { status: 404 },
    );
  }

  if (project.renderMethod !== "multiclip") {
    return NextResponse.json(
      { error: "Solo soportado para proyectos multiclip por ahora" },
      { status: 400 },
    );
  }
  if (!project.planMulticlip || !project.clips || project.clips.length === 0) {
    return NextResponse.json(
      { error: "El proyecto no tiene plan o clips para re-renderizar" },
      { status: 400 },
    );
  }
  // No permitimos encolar si ya hay un job corriendo. Si esta en error o
  // completed, OK reencolar (el editor llama esto despues de editar).
  if (project.status === "processing") {
    return NextResponse.json(
      { error: "Ya hay un job corriendo para este proyecto" },
      { status: 409 },
    );
  }

  // Marcamos processing + limpiamos error message (si lo habia) ANTES de
  // encolar. Asi la UI ve el cambio de estado al instante en el polling
  // siguiente, sin esperar a que el job arranque.
  await updateProject(projectId, {
    status: "processing",
    errorMessage: null,
  });

  await inngest.send({
    name: "pipeline/multiclip-rerender",
    data: { projectId },
  });

  return NextResponse.json(
    { projectId, status: "queued" },
    { status: 202 },
  );
}
