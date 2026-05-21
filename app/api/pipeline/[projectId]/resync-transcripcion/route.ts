import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { downloadFromBlob, publicBlobUrl } from "@/lib/blob";
import { unirTranscripcionesMulticlip } from "@/lib/multiclip-utils";
import type { WordTimestamp } from "@/types";

/**
 * POST /api/pipeline/[projectId]/resync-transcripcion
 *
 * Re-deriva la transcripcion ajustada al video final usando:
 *   - Las transcripciones per-clip ORIGINALES (las que Whisper genero por
 *     cada clip al correr el pipeline multiclip; viven en
 *     `transcripciones-multiclip/{projectId}.json`)
 *   - El plan_multiclip ACTUAL (con los snippets reordenados / recortados
 *     por el usuario en el editor visual)
 *
 * Resultado: una nueva transcripcion donde los timestamps coinciden con el
 * orden y duracion actuales de los snippets. Util cuando el editor detecta
 * drift (snippets reordenados despues de la ultima regeneracion) y los subs
 * dejan de calzar con el audio.
 *
 * CAVEAT importante: si el usuario edito el texto de palabras desde el
 * editor (cambiando `texto` de algun WordTimestamp), esas ediciones se
 * pierden — esta funcion reconstruye desde el zero usando lo que Whisper
 * transcribio originalmente. El cliente debe avisar al usuario antes de
 * llamar este endpoint.
 *
 * NO persiste el resultado en blob; lo devuelve al cliente para que actualice
 * el estado del editor (que ya hace el save con su flujo normal cuando el
 * usuario confirma).
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
      { error: "Solo soportado para proyectos multiclip" },
      { status: 400 },
    );
  }
  if (!project.planMulticlip || !project.clips) {
    return NextResponse.json(
      { error: "El proyecto no tiene plan o clips" },
      { status: 400 },
    );
  }

  // Carga de transcripciones per-clip. Si el archivo no existe (proyecto
  // viejo previo a esta feature), no podemos resync — el usuario tendria
  // que correr el pipeline completo.
  const perClipUrl = publicBlobUrl(`transcripciones-multiclip/${projectId}.json`);
  let perClip: WordTimestamp[][];
  try {
    const buf = await downloadFromBlob(perClipUrl);
    perClip = JSON.parse(buf.toString()) as WordTimestamp[][];
  } catch (err) {
    console.warn("[resync-transcripcion] no pude cargar per-clip", err);
    return NextResponse.json(
      {
        error:
          "No hay transcripciones por-clip disponibles para este proyecto. Probablemente fue creado antes de esta feature — re-ejecuta el pipeline para regenerarlas.",
      },
      { status: 400 },
    );
  }

  if (!Array.isArray(perClip)) {
    return NextResponse.json(
      { error: "Formato de transcripciones invalido" },
      { status: 500 },
    );
  }

  const nuevaTranscripcion = unirTranscripcionesMulticlip(
    perClip,
    project.planMulticlip.snippets,
  );

  return NextResponse.json({
    ok: true,
    transcripcion: nuevaTranscripcion,
    // El cliente usa esto para mostrar diff/aviso ("antes 124, ahora 118").
    palabras: nuevaTranscripcion.length,
  });
}
