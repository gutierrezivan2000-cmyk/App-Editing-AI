import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { inngest } from "@/inngest/client";

/**
 * POST /api/pipeline/[projectId]/replan
 *
 * Re-ejecuta el step "Plan Claude" del pipeline multiclip usando las
 * transcripciones per-clip que YA estan en blob storage. NO re-corre
 * analyze-clips ni transcribe-clips (ahorra 5-10 min para clips ya
 * procesados).
 *
 * Util cuando:
 *   - Se mejora el prompt de Claude o las heuristicas del planning, y
 *     queremos validar contra un proyecto existente sin recrearlo.
 *   - El plan original no respeta el guion, deja silencios, repite ideas.
 *
 * Despues del re-plan, el pipeline:
 *   1. Re-genera la transcripcion ajustada con el plan nuevo
 *   2. Re-arma el video_unido con ffmpeg-multiclip-concat
 *   3. Re-genera XML/EDL/CapCut/SRT
 *   4. (Opcional, si renderSubtitulos) re-corre Remotion para MP4 quemado
 *
 * Solo soporta proyectos multiclip que ya esten completados (es decir,
 * que hayan corrido al menos una vez el pipeline original y tengan las
 * transcripciones per-clip + metadata de cada clip persistida).
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
  if (!project.clips || project.clips.length === 0) {
    return NextResponse.json(
      { error: "El proyecto no tiene clips" },
      { status: 400 },
    );
  }
  if (project.status === "processing") {
    return NextResponse.json(
      { error: "Ya hay un job corriendo para este proyecto" },
      { status: 409 },
    );
  }

  // Marcamos processing + limpiamos errores. El plan_multiclip viejo se
  // mantiene hasta que Claude devuelva el nuevo (asi si el job falla
  // queda el plan anterior, no nada).
  await updateProject(projectId, {
    status: "processing",
    errorMessage: null,
  });

  await inngest.send({
    name: "pipeline/multiclip-replan",
    data: { projectId },
  });

  return NextResponse.json(
    { projectId, status: "queued" },
    { status: 202 },
  );
}
