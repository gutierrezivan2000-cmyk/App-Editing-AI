import { NextResponse } from "next/server";
import JSZip from "jszip";
import { getProject, updateProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import { requireAuth } from "@/lib/api-auth";
import { downloadFromBlob, uploadToBlob } from "@/lib/blob";
import {
  generarCapCutDraftMulticlip,
  generarDaVinciEDLMulticlip,
  generarPremiereXMLMulticlip,
  type ClipForExport,
} from "@/lib/multiclip-exports";
import { sanitizeClipFilename } from "@/lib/multiclip-utils";
import { generarSRT } from "@/lib/srt";
import { getLocalFilename } from "@/lib/premiere-xml";
import type { WordTimestamp } from "@/types";

/**
 * POST /api/pipeline/[projectId]/regenerate-editables
 *
 * Regenera los 4 archivos editables (XML Premiere, EDL DaVinci, CapCut ZIP,
 * SRT) a partir del ESTADO ACTUAL del proyecto en DB y blob storage. NO
 * re-corre el pipeline pesado (Whisper, Claude, FFmpeg, Sandbox) — solo
 * los pasos que toman menos de 30 segundos:
 *
 *   1. Leer planMulticlip + clips de DB
 *   2. Descargar transcripcion ajustada de blob
 *   3. Generar XML/EDL/CapCut/SRT con esa data
 *   4. Re-armar el ZIP de CapCut con los clips originales
 *   5. Subir las 4 cosas con allowOverwrite
 *
 * Es el endpoint que el editor llama tras guardar cambios — el usuario
 * edita subtitulos en la UI, guarda (PATCH editor), y despues llama esto
 * para tener los editables sincronizados.
 *
 * Soporta proyectos multiclip Y cortes. Para 'original' / 'mirage' no hay
 * editables que regenerar.
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
  if (!project.planMulticlip || !project.clips) {
    return NextResponse.json(
      { error: "El proyecto no tiene plan o clips" },
      { status: 400 },
    );
  }

  const cliente = await getClienteProfile(project.clienteId);
  const subtitulosCfg = {
    ...cliente.subtitulos,
    ...(project.subtitulosOverride ?? {}),
  };

  // Reconstruir ClipForExport (igual que en el pipeline original).
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
    localFilename: sanitizeClipFilename(getLocalFilename(c.name, c.url), idx),
  }));

  // Cargar transcripcion ajustada. Si no esta, los editables se generan sin
  // subtitulos (el usuario probablemente acaba de empezar).
  const transcripcionUrl = `https://6bxtwiuhddelayzi.public.blob.vercel-storage.com/transcripciones-multiclip-final/${projectId}.json`;
  let transcripcion: WordTimestamp[] = [];
  try {
    const buf = await downloadFromBlob(transcripcionUrl);
    transcripcion = JSON.parse(buf.toString()) as WordTimestamp[];
  } catch (err) {
    console.warn("[regenerate-editables] no pude cargar transcripcion", err);
  }

  // Generar XML, EDL, CapCut draft, SRT
  const { xml } = generarPremiereXMLMulticlip({
    videoName: project.nombre,
    clips: clipsForExport,
    snippets: project.planMulticlip.snippets,
    subtitulos: transcripcion.length > 0
      ? { transcripcion, config: subtitulosCfg }
      : undefined,
  });
  const { edl } = generarDaVinciEDLMulticlip({
    videoName: project.nombre,
    clips: clipsForExport,
    snippets: project.planMulticlip.snippets,
  });
  const { draftJson, metaJson } = generarCapCutDraftMulticlip({
    videoName: project.nombre,
    clips: clipsForExport,
    snippets: project.planMulticlip.snippets,
    subtitulos: transcripcion.length > 0
      ? { transcripcion, config: subtitulosCfg }
      : undefined,
  });
  const srt = generarSRT(transcripcion, subtitulosCfg.palabras_por_linea ?? 4);

  // Descargar los clips originales para el ZIP CapCut.
  const clipBuffers = await Promise.all(
    clipsForExport.map((c) => downloadFromBlob(c.url)),
  );
  const capcutZip = new JSZip();
  capcutZip.file("draft_content.json", draftJson);
  capcutZip.file("draft_meta_info.json", metaJson);
  clipsForExport.forEach((c, idx) => {
    capcutZip.file(c.localFilename, clipBuffers[idx]);
  });
  const capcutBuffer = await capcutZip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
  });

  const [xmlUrl, edlUrl, capcutUrl, srtUrl] = await Promise.all([
    uploadToBlob(
      `proyectos-xml/${projectId}.xml`,
      Buffer.from(xml, "utf8"),
      "application/xml",
    ),
    uploadToBlob(
      `proyectos-edl/${projectId}.edl`,
      Buffer.from(edl, "utf8"),
      "text/plain",
    ),
    uploadToBlob(
      `proyectos-capcut/${projectId}.zip`,
      capcutBuffer,
      "application/zip",
    ),
    uploadToBlob(
      `proyectos-srt/${projectId}.srt`,
      Buffer.from(srt, "utf8"),
      "text/plain; charset=utf-8",
    ),
  ]);

  await updateProject(projectId, { xmlUrl, edlUrl, capcutUrl, srtUrl });

  return NextResponse.json({
    ok: true,
    projectId,
    regenerated: ["xml", "edl", "capcut", "srt"],
  });
}
