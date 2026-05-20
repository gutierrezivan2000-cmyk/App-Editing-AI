import { NextResponse } from "next/server";
import JSZip from "jszip";
import { downloadFromBlob, uploadToBlob } from "@/lib/blob";
import { getProject, updateProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import { requireAuth } from "@/lib/api-auth";
import {
  generarCapCutDraftMulticlip,
  type ClipForExport,
} from "@/lib/multiclip-exports";
import {
  sanitizeClipFilename,
} from "@/lib/multiclip-utils";
import { getLocalFilename } from "@/lib/premiere-xml";
import type { WordTimestamp } from "@/types";

/**
 * Regenera SOLO el ZIP CapCut del proyecto a partir del estado actual de DB.
 * Útil cuando iteramos sobre el schema CapCut sin re-correr todo el pipeline.
 *
 * Solo soporta proyectos multiclip por ahora (el caso de uso actual).
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

  if (project.renderMethod !== "multiclip") {
    return NextResponse.json(
      { error: "Solo soportado para render_method=multiclip" },
      { status: 400 }
    );
  }
  if (!project.clips || project.clips.length === 0) {
    return NextResponse.json({ error: "Proyecto sin clips" }, { status: 400 });
  }
  if (!project.planMulticlip) {
    return NextResponse.json({ error: "Proyecto sin plan" }, { status: 400 });
  }

  const cliente = await getClienteProfile(project.clienteId);
  const subtitulosCfg = {
    ...cliente.subtitulos,
    ...(project.subtitulosOverride ?? {}),
  };

  // Reconstruir ClipForExport. La metadata vino en project.clips desde el run
  // anterior (rellenada por analyze-clips). Defaults safe si algo falta.
  const clipsForExport: ClipForExport[] = project.clips.map((c, idx) => ({
    index: idx,
    name: c.name,
    url: c.url,
    metadata: {
      width: c.width ?? 1920,
      height: c.height ?? 1080,
      fps: c.fps ?? 30,
      duracion: c.duracion ?? 0,
    },
    localFilename: sanitizeClipFilename(
      getLocalFilename(c.name, c.url),
      idx
    ),
  }));

  // Cargar transcripción ajustada que guardó el pipeline previo.
  const transcripcionAjustadaUrl = `https://6bxtwiuhddelayzi.public.blob.vercel-storage.com/transcripciones-multiclip-final/${projectId}.json`;
  let transcripcionAjustada: WordTimestamp[] = [];
  try {
    const buf = await downloadFromBlob(transcripcionAjustadaUrl);
    transcripcionAjustada = JSON.parse(buf.toString()) as WordTimestamp[];
  } catch (err) {
    console.warn("[regenerate-capcut] no pude cargar la transcripción ajustada, sigo sin subs", err);
  }

  const { draftJson, metaJson } = generarCapCutDraftMulticlip({
    videoName: project.nombre,
    clips: clipsForExport,
    snippets: project.planMulticlip.snippets,
    subtitulos:
      transcripcionAjustada.length > 0
        ? { transcripcion: transcripcionAjustada, config: subtitulosCfg }
        : undefined,
  });

  // Descargar todos los clips originales para empaquetar dentro del ZIP.
  const clipBuffers = await Promise.all(
    clipsForExport.map((c) => downloadFromBlob(c.url))
  );

  const zip = new JSZip();
  zip.file("draft_content.json", draftJson);
  zip.file("draft_meta_info.json", metaJson);
  clipsForExport.forEach((c, idx) => {
    zip.file(c.localFilename, clipBuffers[idx]);
  });
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
  });

  const capcutUrl = await uploadToBlob(
    `proyectos-capcut/${projectId}.zip`,
    buffer,
    "application/zip"
  );
  await updateProject(projectId, { capcutUrl });

  return NextResponse.json({
    ok: true,
    capcutUrl,
    clipsCount: clipsForExport.length,
    filenames: clipsForExport.map((c) => c.localFilename),
  });
}
