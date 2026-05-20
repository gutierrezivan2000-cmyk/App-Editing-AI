import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { CANCEL_MARKER } from "@/lib/pipeline-cancel";

/**
 * Marca un proyecto como cancelado. Se usa cuando el usuario quiere parar
 * un pipeline a mitad — sea porque cometio un error en la config, porque
 * esta tardando demasiado, o porque ya no le interesa el output.
 *
 * IMPORTANTE — limitaciones tecnicas:
 *
 * Inngest no expone una API simple para "matar" un job a mitad de un step
 * largo (ej. el render Remotion que puede durar 10-15 min). Lo que SI
 * podemos hacer:
 *
 *   1. Marcar el proyecto como `error` + errorMessage = "Cancelado por el
 *      usuario" en DB INMEDIATAMENTE. La UI lo refleja en el proximo poll
 *      (~1.5s), asi el operador sabe que la cancelacion se aplico.
 *
 *   2. Cuando el pipeline EVENTUALMENTE termine (porque Inngest no para
 *      hasta acabar el step actual), el ultimo `updateProject(status:
 *      "completed", ...)` NO sobrescribe el status — `updateProject`
 *      protege la cancelacion explicitamente (ver lib/db.ts).
 *
 * Limitacion: el sandbox sigue gastando ciclos hasta que termine el step
 * actual. No hay forma de pararlo en mitad sin acceso al sandbox API.
 * Es un trade-off: feedback inmediato al operador vs gasto residual.
 *
 * Para mitigar el gasto residual, en un v2 podriamos:
 *   - Llamar al sandbox API para forzar stop (vercel sandbox lo expone)
 *   - O agregar checks defensivos al inicio de cada step de Inngest
 *
 * El marker se vive en lib/pipeline-cancel.ts — Next.js no permite
 * exports adicionales en route handlers, romperia el type-check.
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
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  // Solo tiene sentido cancelar si esta en pending o processing. Si ya
  // termino, devolvemos lo que hay (idempotente).
  if (project.status === "completed" || project.status === "error") {
    return NextResponse.json({
      ok: true,
      already: project.status,
      message: "El proyecto ya habia terminado",
    });
  }

  await updateProject(projectId, {
    status: "error",
    errorMessage: CANCEL_MARKER,
  });

  return NextResponse.json({
    ok: true,
    projectId,
    cancelled: true,
  });
}
