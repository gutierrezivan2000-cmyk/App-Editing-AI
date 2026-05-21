import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import { requireAuth } from "@/lib/api-auth";
import { downloadFromBlob, publicBlobUrl, uploadToBlob } from "@/lib/blob";
import type {
  ClienteProfile,
  PlanMulticlip,
  SubtitulosOverride,
  WordTimestamp,
} from "@/types";

/**
 * GET /api/pipeline/[projectId]/editor
 *
 * Carga TODO lo que el editor necesita para arrancar:
 *   - El proyecto (con su outputUrl/video_unido, clips, etc.)
 *   - El perfil del cliente (config base de subtitulos)
 *   - La transcripcion ajustada al timeline final (la que ven los
 *     subtitulos en el video unido — no la per-clip original)
 *   - El plan multiclip (snippets que arman el video)
 *
 * El editor lo usa para hidratar el estado inicial. Despues guarda via
 * PATCH a este mismo endpoint con los cambios.
 */
export async function GET(
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
      { error: "El editor solo soporta proyectos multiclip por ahora" },
      { status: 400 },
    );
  }
  if (project.status !== "completed") {
    return NextResponse.json(
      { error: "El proyecto debe estar completado para editar" },
      { status: 400 },
    );
  }
  if (!project.outputUrl) {
    return NextResponse.json(
      { error: "El proyecto no tiene video unido" },
      { status: 400 },
    );
  }

  // Cliente puede no existir si fue eliminado — pasamos undefined.
  let cliente: ClienteProfile | undefined;
  try {
    cliente = await getClienteProfile(project.clienteId);
  } catch {
    cliente = undefined;
  }

  // La transcripcion ajustada vive en blob storage. Usamos la URL canonica
  // que el pipeline siempre escribe.
  const transcripcionUrl = publicBlobUrl(
    `transcripciones-multiclip-final/${projectId}.json`,
  );
  let transcripcion: WordTimestamp[] = [];
  try {
    const buf = await downloadFromBlob(transcripcionUrl);
    transcripcion = JSON.parse(buf.toString()) as WordTimestamp[];
  } catch (err) {
    console.warn("[editor GET] no pude cargar transcripcion", err);
  }

  return NextResponse.json({
    project: {
      id: project.id,
      nombre: project.nombre,
      clienteId: project.clienteId,
      outputUrl: project.outputUrl,
      clips: project.clips ?? [],
      planMulticlip: project.planMulticlip ?? null,
      subtitulosOverride: project.subtitulosOverride ?? null,
      renderSubtitulos: project.renderSubtitulos ?? false,
    },
    cliente: cliente ?? null,
    transcripcion,
  });
}

/**
 * PATCH /api/pipeline/[projectId]/editor
 *
 * Persiste cambios del editor:
 *   - transcripcion: lista actualizada de palabras (start/end/texto)
 *   - planMulticlip: snippets reordenados / recortados (opcional)
 *   - enfasisPalabras: lista actualizada (opcional, dentro de plan)
 *
 * La transcripcion se sube como nuevo blob a la misma URL (allowOverwrite
 * + same key). El plan se persiste en proyectos.plan_multiclip.
 *
 * Despues de PATCH, el cliente normalmente llama POST regenerate-editables
 * para que se actualicen XML/EDL/CapCut/SRT con los cambios.
 */
export async function PATCH(
  req: Request,
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

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const updates: {
    transcripcion?: WordTimestamp[];
    planMulticlip?: PlanMulticlip;
    subtitulosOverride?: SubtitulosOverride;
  } = body;

  // Persistir transcripcion en blob si vino.
  if (Array.isArray(updates.transcripcion)) {
    await uploadToBlob(
      `transcripciones-multiclip-final/${projectId}.json`,
      Buffer.from(JSON.stringify(updates.transcripcion)),
      "application/json",
    );
  }

  // Persistir plan / override de subtítulos en DB si vinieron. updateProject
  // hace COALESCE de cada columna, asi que pasar varios juntos solo hace
  // UN UPDATE de toda la fila.
  if (updates.planMulticlip || updates.subtitulosOverride) {
    await updateProject(projectId, {
      planMulticlip: updates.planMulticlip,
      subtitulosOverride: updates.subtitulosOverride,
    });
  }

  return NextResponse.json({ ok: true, projectId });
}
