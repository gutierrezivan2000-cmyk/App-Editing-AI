import JSZip from "jszip";
import { inngest } from "../client";
import { getProject, updateProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import { createPreprocessSandbox, runInSandbox } from "@/lib/sandbox";
import {
  detectarSilencios,
  ejecutarFFmpegCommands,
  extraerMetadata,
} from "@/lib/ffmpeg";
import {
  uploadFromSandboxToBlob,
  uploadToBlob,
  downloadFromBlob,
} from "@/lib/blob";
import { transcribirConWhisperDesdeUrl } from "@/lib/openai";
import {
  analizarCortesConClaude,
  type AnalisisCortes,
  type CorteIA,
} from "@/lib/anthropic-cortes";
import {
  calcularKeepSegments,
  generarPremiereXML,
} from "@/lib/premiere-xml";
import { generarDaVinciEDL } from "@/lib/davinci-edl";
import { generarCapCutDraft } from "@/lib/capcut-draft";
import {
  ajustarTranscripcionTrasCortes,
  buildFFmpegConcatCommand,
} from "@/lib/cuts-utils";
import { renderizarVideoFinal } from "@/lib/render";
import type { SilenceSegment, WordTimestamp } from "@/types";

/**
 * Pipeline completo: la IA decide qué cortar (silencios + errores + repeticiones
 * + muletillas), exportamos project files (XML/EDL/CapCut), cortamos el video
 * con ffmpeg, ajustamos los timestamps de la transcripción al video editado,
 * y renderizamos con Remotion un MP4 final con subtítulos dinámicos.
 */
export const procesarCortesProyecto = inngest.createFunction(
  {
    id: "procesar-cortes-proyecto",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "pipeline/cortes-run" },
  async ({ event, step }) => {
    const { projectId } = event.data as { projectId: string };

    try {
      const project = await step.run("get-project", () => getProject(projectId));
      const cliente = await step.run("get-cliente", () =>
        getClienteProfile(project.clienteId)
      );

      await step.run("mark-processing", () =>
        updateProject(projectId, { status: "processing" })
      );

      // Sandbox 1: descarga + silencios + metadata + audio (mp3)
      const { silencios, metadata, audioUrl } = await step.run(
        "analyze-footage",
        async () => {
          const sandbox = await createPreprocessSandbox();
          try {
            const dl = await runInSandbox(
              sandbox,
              `curl -fsSL "${project.footageUrl}" -o /tmp/input.mp4`
            );
            if (dl.exitCode !== 0) {
              throw new Error(
                `Descarga fallida (exit ${dl.exitCode}): ${dl.stderr.slice(-300)}`
              );
            }

            const metadata = await extraerMetadata(sandbox, "/tmp/input.mp4");

            const silencios = await detectarSilencios(
              sandbox,
              "/tmp/input.mp4",
              cliente.silencio
            );

            const fx = await runInSandbox(
              sandbox,
              `ffmpeg -y -i /tmp/input.mp4 -vn -ac 1 -ar 16000 -b:a 64k /tmp/audio.mp3`
            );
            if (fx.exitCode !== 0) {
              throw new Error(
                `Extracción de audio fallida (exit ${fx.exitCode}): ${fx.stderr.slice(-300)}`
              );
            }

            const audioUrl = await uploadFromSandboxToBlob(
              sandbox,
              "/tmp/audio.mp3",
              `audios/${projectId}.mp3`
            );

            return { silencios, metadata, audioUrl };
          } finally {
            await sandbox.stop();
          }
        }
      );

      // Whisper transcribe → guardar JSON en blob (para reusar entre steps)
      const transcripcionUrl = await step.run("transcribe", async () => {
        const words = await transcribirConWhisperDesdeUrl(audioUrl);
        return uploadToBlob(
          `transcripciones/${projectId}.json`,
          Buffer.from(JSON.stringify(words)),
          "application/json"
        );
      });

      // Claude analiza la transcripción + silencios → segmentos a cortar +
      // palabras de énfasis + animación recomendada.
      const analisis = await step.run("claude-cortes", async () => {
        const buf = await downloadFromBlob(transcripcionUrl);
        const transcripcion = JSON.parse(buf.toString()) as WordTimestamp[];
        return analizarCortesConClaude(
          transcripcion,
          silencios,
          project.brief,
          metadata.duracion,
          cliente.subtitulos.animacion
        );
      });

      // Reajustar timestamps de la transcripción para que coincidan con el
      // video ya cortado (palabras dentro de cortes desaparecen; las que
      // quedan se desplazan hacia atrás la duración de los cortes previos).
      // Se hace ANTES de generate-exports porque CapCut usa estas subs.
      const transcripcionAjustadaUrl = await step.run(
        "adjust-transcripcion",
        async () => {
          const buf = await downloadFromBlob(transcripcionUrl);
          const original = JSON.parse(buf.toString()) as WordTimestamp[];
          const ajustada = ajustarTranscripcionTrasCortes(
            original,
            analisis.cortes
          );
          return uploadToBlob(
            `transcripciones-ajustadas/${projectId}.json`,
            Buffer.from(JSON.stringify(ajustada)),
            "application/json"
          );
        }
      );

      // Generar XML/EDL/CapCut con los keep-segments (inverso de los cortes IA).
      // CapCut va a empaquetar el video original dentro del ZIP + un text track
      // de subtítulos editables (líneas agrupadas).
      const exportResult = await step.run("generate-exports", async () => {
        const cortesAsSilencios = analisisToSilencios(analisis);

        const exportOpts = {
          videoUrl: project.footageUrl,
          videoName: project.nombre,
          metadata,
          silencios: cortesAsSilencios,
          sequenceName: `${project.nombre}_editado`,
        };

        const { xml, segments } = generarPremiereXML(exportOpts);
        const { edl } = generarDaVinciEDL(exportOpts);

        const [videoBuffer, transcripcionAjustada] = await Promise.all([
          downloadFromBlob(project.footageUrl),
          downloadFromBlob(transcripcionAjustadaUrl).then(
            (b) => JSON.parse(b.toString()) as WordTimestamp[]
          ),
        ]);

        const { draftJson, metaJson, localFilename } = generarCapCutDraft({
          ...exportOpts,
          subtitulos: {
            transcripcion: transcripcionAjustada,
            config: cliente.subtitulos,
          },
        });

        const capcutZip = new JSZip();
        capcutZip.file("draft_content.json", draftJson);
        capcutZip.file("draft_meta_info.json", metaJson);
        capcutZip.file(localFilename, videoBuffer);
        const capcutBuffer = await capcutZip.generateAsync({
          type: "nodebuffer",
          compression: "STORE", // video ya está comprimido — deflate sería desperdicio
        });

        const [xmlUrl, edlUrl, capcutUrl] = await Promise.all([
          uploadToBlob(
            `proyectos-xml/${projectId}.xml`,
            Buffer.from(xml, "utf8"),
            "application/xml"
          ),
          uploadToBlob(
            `proyectos-edl/${projectId}.edl`,
            Buffer.from(edl, "utf8"),
            "text/plain"
          ),
          uploadToBlob(
            `proyectos-capcut/${projectId}.zip`,
            capcutBuffer,
            "application/zip"
          ),
        ]);

        return {
          xmlUrl,
          edlUrl,
          capcutUrl,
          keepSegmentsCount: segments.length,
        };
      });

      // Si Claude no encontró nada que cortar, usar el video original tal cual.
      const videoEditadoUrl = await step.run("ffmpeg-cut", async () => {
        const cortesAsSilencios = analisisToSilencios(analisis);
        const keepSegments = calcularKeepSegments(
          cortesAsSilencios,
          metadata.duracion
        );
        if (keepSegments.length <= 1 && analisis.cortes.length === 0) {
          return project.footageUrl;
        }

        const sandbox = await createPreprocessSandbox();
        try {
          const dl = await runInSandbox(
            sandbox,
            `curl -fsSL "${project.footageUrl}" -o /tmp/input.mp4`
          );
          if (dl.exitCode !== 0) {
            throw new Error(
              `Descarga fallida (exit ${dl.exitCode}): ${dl.stderr.slice(-300)}`
            );
          }
          const cmd = buildFFmpegConcatCommand(
            "/tmp/input.mp4",
            "/tmp/video_limpio.mp4",
            keepSegments
          );
          await ejecutarFFmpegCommands(sandbox, [cmd]);
          return await uploadFromSandboxToBlob(
            sandbox,
            "/tmp/video_limpio.mp4",
            `intermedio/${projectId}.mp4`
          );
        } finally {
          await sandbox.stop();
        }
      });

      const renderResult = await step.run("final-render", async () => {
        const buf = await downloadFromBlob(transcripcionAjustadaUrl);
        const transcripcion = JSON.parse(buf.toString()) as WordTimestamp[];
        return renderizarVideoFinal(projectId, {
          videoUrl: videoEditadoUrl,
          transcripcion,
          clienteProfile: {
            ...cliente,
            subtitulos: {
              ...cliente.subtitulos,
              animacion:
                analisis.animacionOverride ?? cliente.subtitulos.animacion,
            },
          },
          enfasisPalabras: analisis.enfasisPalabras,
        });
      });

      await step.run("mark-completed", () =>
        updateProject(projectId, {
          status: "completed",
          xmlUrl: exportResult.xmlUrl,
          edlUrl: exportResult.edlUrl,
          capcutUrl: exportResult.capcutUrl,
          outputUrl: renderResult.url,
          cortesAnalysis: analisis,
          keepSegmentsCount: exportResult.keepSegmentsCount,
          duracionSeg: metadata.duracion,
        })
      );

      return {
        projectId,
        xmlUrl: exportResult.xmlUrl,
        edlUrl: exportResult.edlUrl,
        capcutUrl: exportResult.capcutUrl,
        outputUrl: renderResult.url,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateProject(projectId, { status: "error", errorMessage: msg });
      throw err;
    }
  }
);

/**
 * Convierte la lista de cortes que devuelve Claude (con `razon` y `explicacion`)
 * a SilenceSegment, que es el tipo que esperan los generadores de project files.
 * El generador calcula keep-segments invirtiendo esta lista.
 */
function analisisToSilencios(analisis: AnalisisCortes): SilenceSegment[] {
  return analisis.cortes.map((c: CorteIA) => ({
    start: c.start,
    end: c.end,
    duracion: c.end - c.start,
  }));
}
