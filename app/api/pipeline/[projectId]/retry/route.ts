import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/pipeline/[projectId]/retry
 *
 * Re-encola un proyecto existente con su misma configuracion.
 * Util cuando:
 *   - El pipeline fallo y quiero reintentar
 *   - El resultado fue malo y quiero re-correr con el mismo input
 *     (probablemente cambio algo en el prompt o config global)
 *
 * Limpia el estado: status -> 'pending', errorMessage -> null, y vuelve
 * a emitir el evento Inngest correspondiente segun renderMethod.
 *
 * IMPORTANTE: NO borra los outputs anteriores (outputUrl/xmlUrl/etc).
 * Si el pipeline termina bien, los reemplaza. Si falla en mitad, el
 * usuario sigue teniendo los anteriores como backup.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  const { projectId } = await params;

  let project;
  try {
    project = await getProject(projectId, session.user.id);
  } catch {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  // Limpiar error y volver a pending. `null` fuerza SET error_message=NULL
  // en DB (ver lib/db.ts:updateProject), undefined mantendría el viejo.
  await updateProject(projectId, {
    status: "pending",
    errorMessage: null,
  });

  // Emitir el evento segun el modo de pipeline del proyecto.
  const eventName =
    project.renderMethod === "cortes"
      ? "pipeline/cortes-run"
      : project.renderMethod === "multiclip"
        ? "pipeline/multiclip-run"
        : "pipeline/run";

  const eventData =
    project.renderMethod === "cortes" || project.renderMethod === "multiclip"
      ? { projectId }
      : { projectId, renderMethod: project.renderMethod };

  await inngest.send({ name: eventName, data: eventData });

  return NextResponse.json({
    ok: true,
    projectId,
    renderMethod: project.renderMethod,
    event: eventName,
  });
}
