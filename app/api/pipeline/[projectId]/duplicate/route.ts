import { NextResponse } from "next/server";
import { getProject, createProject } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { requireAuth } from "@/lib/api-auth";
import type { SubtitulosOverride } from "@/types";

/**
 * POST /api/pipeline/[projectId]/duplicate
 *
 * Crea un proyecto NUEVO a partir de uno existente, reutilizando los mismos
 * clips/brief/guion/cliente pero permitiendo overrides puntuales (nombre,
 * subtitulos, etc).
 *
 * Util para iterar: el cliente quiere "lo mismo pero con animacion typewriter
 * y color rojo" — en vez de crear desde cero, duplica.
 *
 * Body opcional (JSON):
 *   {
 *     "nombre"?: string                // default: "<original> (copia)"
 *     "brief"?: string                  // default: el del original
 *     "guion"?: string                  // default: el del original
 *     "subtitulosOverride"?: object    // default: el del original
 *     "encolar"?: boolean               // default: true (arranca pipeline)
 *   }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  const { projectId } = await params;

  let original;
  try {
    original = await getProject(projectId, session.user.id);
  } catch {
    return NextResponse.json(
      { error: "Proyecto original no encontrado" },
      { status: 404 }
    );
  }

  // Body es opcional; si no hay JSON valido seguimos con los defaults.
  let overrides: {
    nombre?: string;
    brief?: string;
    guion?: string;
    subtitulosOverride?: SubtitulosOverride;
    encolar?: boolean;
  } = {};
  try {
    overrides = await req.json();
  } catch {
    // body vacio o no-JSON — usamos defaults
  }

  const nombre = overrides.nombre?.trim() || `${original.nombre} (copia)`;
  const brief = overrides.brief ?? original.brief;
  const guion = overrides.guion ?? original.guion;
  const subtitulosOverride =
    overrides.subtitulosOverride ?? original.subtitulosOverride;
  const encolar = overrides.encolar ?? true;

  const nuevo = await createProject({
    clienteId: original.clienteId,
    nombre,
    brief,
    footageUrl: original.footageUrl,
    renderMethod: original.renderMethod,
    // clickupTaskId NO se duplica — si el original venia de ClickUp, el
    // duplicado es una iteracion manual y no deberia colisionar.
    clips: original.clips,
    guion: guion ?? undefined,
    subtitulosOverride,
    userId: session.user.id,
  });

  if (encolar) {
    const eventName =
      nuevo.renderMethod === "cortes"
        ? "pipeline/cortes-run"
        : nuevo.renderMethod === "multiclip"
          ? "pipeline/multiclip-run"
          : "pipeline/run";

    const eventData =
      nuevo.renderMethod === "cortes" || nuevo.renderMethod === "multiclip"
        ? { projectId: nuevo.id }
        : { projectId: nuevo.id, renderMethod: nuevo.renderMethod };

    await inngest.send({ name: eventName, data: eventData });
  }

  return NextResponse.json(
    {
      ok: true,
      projectId: nuevo.id,
      renderMethod: nuevo.renderMethod,
      status: encolar ? "queued" : "pending",
    },
    { status: 201 }
  );
}
