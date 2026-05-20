import JSZip from "jszip";
import { inngest } from "../client";
import { getProject, updateProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import {
  createPreprocessSandbox,
  downloadInSandbox,
  isNetworkError,
  runInSandbox,
} from "@/lib/sandbox";
import {
  ejecutarFFmpegCommands,
  extraerMetadata,
} from "@/lib/ffmpeg";
import {
  downloadFromBlob,
  uploadFromSandboxToBlob,
  uploadToBlob,
} from "@/lib/blob";
import { transcribirConWhisperDesdeUrl } from "@/lib/openai";
import {
  planificarMulticlipConClaude,
  type MulticlipInputClip,
} from "@/lib/anthropic-multiclip";
import {
  buildFFmpegMulticlipCommands,
  calcularDuracionFinal,
  sanitizeClipFilename,
  unirTranscripcionesMulticlip,
} from "@/lib/multiclip-utils";
import { getLocalFilename } from "@/lib/premiere-xml";
import {
  generarCapCutDraftMulticlip,
  generarDaVinciEDLMulticlip,
  generarPremiereXMLMulticlip,
  type ClipForExport,
} from "@/lib/multiclip-exports";
import { generarSRT } from "@/lib/srt";
import { renderizarVideoFinal } from "@/lib/render";
import { advanceToStep, startHeartbeat, updateProgress } from "@/lib/pipeline-progress";
import { preflightMulticlip } from "@/lib/preflight";
import type { ClipMultiSource, WordTimestamp } from "@/types";

/**
 * Pipeline multi-clip: N clips → analizar cada uno (metadata + Whisper) en
 * paralelo → Claude decide orden y cortes (con guión opcional) → ffmpeg
 * concat multi-source → ajustar transcripción al video final → Remotion
 * con subtítulos → exportar XML/EDL/CapCut con todos los clips originales
 * empaquetados en el ZIP CapCut.
 */
export const procesarMulticlipProyecto = inngest.createFunction(
  {
    id: "procesar-multiclip-proyecto",
    retries: 2,
    concurrency: { limit: 3 },
  },
  { event: "pipeline/multiclip-run" },
  async ({ event, step }) => {
    const { projectId } = event.data as { projectId: string };

    try {
      const project = await step.run("get-project", () => getProject(projectId));
      const cliente = await step.run("get-cliente", () =>
        getClienteProfile(project.clienteId)
      );

      if (!project.clips || project.clips.length === 0) {
        throw new Error("El proyecto no tiene clips configurados");
      }

      // ── 0. PREFLIGHT — fail fast en <10s si algo trivial falla ──
      //     Antes el pipeline tardaba 5-10 min en descubrir env vars
      //     faltantes o URLs rotas. Ahora rompe antes de gastar sandbox.
      await step.run("preflight", async () => {
        await updateProgress(projectId, {
          step: 0,
          label: "Validacion previa",
          detail: "Verificando claves del servidor y acceso a los clips",
          startedAt: new Date().toISOString(),
        });
        const result = await preflightMulticlip(project.clips!);
        if (!result.ok) {
          throw new Error(
            `Validacion fallo: ${result.problems.join(" · ")}`,
          );
        }
      });

      await step.run("mark-processing", () =>
        updateProject(projectId, { status: "processing" })
      );

      // ── 1. Analizar todos los clips en un solo sandbox (metadata + audio) ──
      const clipAnalysis = await step.run("analyze-clips", async () => {
        await advanceToStep(
          projectId,
          0,
          "Análisis de cada clip (metadata + audio)",
          `0 / ${project.clips!.length} clips`,
        );
        const stopHb = startHeartbeat(projectId);
        const sandbox = await createPreprocessSandbox();
        try {
          const out: Array<{
            index: number;
            url: string;
            name: string;
            duracion: number;
            width: number;
            height: number;
            fps: number;
            audioUrl: string;
          }> = [];

          const total = project.clips!.length;
          for (let i = 0; i < total; i++) {
            const c = project.clips![i];
            // Reportar progreso ANTES de cada iteracion. La UI ve
            // "Procesando clip 3 de 6" en vivo.
            await updateProgress(projectId, {
              step: 0,
              label: "Análisis de cada clip (metadata + audio)",
              detail: `Procesando clip ${i + 1} de ${total} (${c.name})`,
              startedAt: new Date().toISOString(),
              percent: Math.round((i / total) * 100),
            });

            const inputPath = `/tmp/clip_${i}.mp4`;
            const dl = await downloadInSandbox(sandbox, c.url, inputPath);
            if (dl.exitCode !== 0) {
              throw new Error(
                `Descarga del clip ${i} fallida: ${dl.stderr.slice(-300)}`
              );
            }

            const metadata = await extraerMetadata(sandbox, inputPath);

            const audioPath = `/tmp/audio_${i}.mp3`;
            const fx = await runInSandbox(
              sandbox,
              `ffmpeg -y -i ${inputPath} -vn -ac 1 -ar 16000 -b:a 64k ${audioPath}`
            );
            if (fx.exitCode !== 0) {
              throw new Error(
                `Extracción de audio del clip ${i} falló: ${fx.stderr.slice(-300)}`
              );
            }
            const audioUrl = await uploadFromSandboxToBlob(
              sandbox,
              audioPath,
              `audios-multiclip/${projectId}/clip_${i}.mp3`
            );

            out.push({
              index: i,
              url: c.url,
              name: c.name,
              duracion: metadata.duracion,
              width: metadata.width,
              height: metadata.height,
              fps: metadata.fps,
              audioUrl,
            });
          }

          return out;
        } finally {
          await sandbox.stop();
          stopHb();
        }
      });

      // ── 2. Transcribir cada clip con Whisper, guardar el JSON unificado ──
      const transcripcionesUrl = await step.run("transcribe-clips", async () => {
        await advanceToStep(
          projectId,
          1,
          "Transcripción Whisper de cada clip",
          `0 / ${clipAnalysis.length} clips`,
        );
        const stopHb = startHeartbeat(projectId);
        try {
          const transcripciones: WordTimestamp[][] = [];
          for (let i = 0; i < clipAnalysis.length; i++) {
            const c = clipAnalysis[i];
            await updateProgress(projectId, {
              step: 1,
              label: "Transcripción Whisper de cada clip",
              detail: `Transcribiendo clip ${i + 1} de ${clipAnalysis.length} (${c.name})`,
              startedAt: new Date().toISOString(),
              percent: Math.round((i / clipAnalysis.length) * 100),
            });
            const words = await transcribirConWhisperDesdeUrl(c.audioUrl);
            transcripciones.push(words);
          }
          return uploadToBlob(
            `transcripciones-multiclip/${projectId}.json`,
            Buffer.from(JSON.stringify(transcripciones)),
            "application/json"
          );
        } finally {
          stopHb();
        }
      });

      // ── 3. Claude: planificar snippets (orden + cortes + énfasis + animación) ──
      const plan = await step.run("claude-multiclip", async () => {
        await advanceToStep(
          projectId,
          2,
          "Plan Claude (orden + cortes + énfasis)",
          "Analizando transcripciones y decidiendo cortes",
        );
        const buf = await downloadFromBlob(transcripcionesUrl);
        const transcripciones = JSON.parse(buf.toString()) as WordTimestamp[][];

        const inputClips: MulticlipInputClip[] = clipAnalysis.map((c) => ({
          index: c.index,
          name: c.name,
          duracion: c.duracion,
          transcripcion: transcripciones[c.index] ?? [],
        }));

        return planificarMulticlipConClaude(
          inputClips,
          project.brief,
          project.guion ?? null,
          cliente.subtitulos.animacion
        );
      });

      // ── 4. ffmpeg concat multi-source → upload del video unido ──
      const videoUnidoUrl = await step.run("ffmpeg-multiclip-concat", async () => {
        await advanceToStep(
          projectId,
          3,
          "Concatenación FFmpeg multi-source",
          `Recortando y uniendo ${plan.snippets.length} snippets`,
        );
        const stopHb = startHeartbeat(projectId);
        try {
        const sandbox = await createPreprocessSandbox();
        try {
          // Descargar todos los clips
          for (let i = 0; i < clipAnalysis.length; i++) {
            const dl = await downloadInSandbox(
              sandbox,
              clipAnalysis[i].url,
              `/tmp/clip_${i}.mp4`
            );
            if (dl.exitCode !== 0) {
              throw new Error(
                `Descarga del clip ${i} para concat falló: ${dl.stderr.slice(-300)}`
              );
            }
          }
          const inputPaths = clipAnalysis.map((_, i) => `/tmp/clip_${i}.mp4`);
          // Canvas final = dimensiones del primer clip. Two-pass concat:
          // 1) recortar+uniformizar cada snippet a /tmp/segments/seg_NNN.mp4
          // 2) concat demuxer (sin re-encode) → /tmp/video_unido.mp4
          const first = clipAnalysis[0];
          await runInSandbox(sandbox, `mkdir -p /tmp/segments`);
          const cmds = buildFFmpegMulticlipCommands(
            inputPaths,
            "/tmp/video_unido.mp4",
            plan.snippets,
            "/tmp/segments",
            "/tmp/concat-list.txt",
            {
              canvasWidth: first.width,
              canvasHeight: first.height,
              fps: first.fps,
            }
          );
          await ejecutarFFmpegCommands(sandbox, cmds);
          return await uploadFromSandboxToBlob(
            sandbox,
            "/tmp/video_unido.mp4",
            `intermedio-multiclip/${projectId}.mp4`
          );
        } finally {
          await sandbox.stop();
        }
        } finally {
          stopHb();
        }
      });

      // ── 5. Ajustar transcripción a la timeline del video unido ──
      const transcripcionFinalUrl = await step.run("adjust-transcripcion-multiclip", async () => {
        await advanceToStep(
          projectId,
          4,
          "Ajuste de transcripción a la timeline final",
          "Reescribiendo timestamps según los snippets",
        );
        const buf = await downloadFromBlob(transcripcionesUrl);
        const transcripciones = JSON.parse(buf.toString()) as WordTimestamp[][];
        const unida = unirTranscripcionesMulticlip(transcripciones, plan.snippets);
        return uploadToBlob(
          `transcripciones-multiclip-final/${projectId}.json`,
          Buffer.from(JSON.stringify(unida)),
          "application/json"
        );
      });

      // ── 6. Generar XML/EDL/CapCut con todos los clips empaquetados ──
      //     Lo hacemos ANTES del render Remotion (opcional) para que el
      //     usuario tenga los editables disponibles cuanto antes — el
      //     render Remotion puede tomar 10+ minutos extra y bloquearia
      //     todo si fuera al revés.
      //
      //     Este step puede tardar varios minutos: hay que descargar TODOS
      //     los clips originales (potencialmente cientos de MB cada uno)
      //     para armar el ZIP CapCut, y despues subirlo de vuelta al blob.
      //     Por eso wrappeamos en startHeartbeat para que el watchdog
      //     server-side (stuck-pipeline-cron) no lo mate por inactividad.
      const exportResult = await step.run("generate-multiclip-exports", async () => {
        await advanceToStep(
          projectId,
          5,
          "Generación XML / EDL / CapCut / SRT",
          "Generando archivos editables",
        );
        const stopHb = startHeartbeat(projectId);
        try {
        // Reconstruir ClipForExport con metadata + localFilename
        const clipsForExport: ClipForExport[] = clipAnalysis.map((c) => ({
          index: c.index,
          name: c.name,
          url: c.url,
          metadata: {
            width: c.width,
            height: c.height,
            fps: c.fps,
            duracion: c.duracion,
          },
          localFilename: sanitizeClipFilename(
            getLocalFilename(c.name, c.url),
            c.index
          ),
        }));

        const transcripcionAjustada = JSON.parse(
          (await downloadFromBlob(transcripcionFinalUrl)).toString()
        ) as WordTimestamp[];

        const subtitulosCfg = {
          ...cliente.subtitulos,
          ...(project.subtitulosOverride ?? {}),
        };
        const { xml } = generarPremiereXMLMulticlip({
          videoName: project.nombre,
          clips: clipsForExport,
          snippets: plan.snippets,
          subtitulos: {
            transcripcion: transcripcionAjustada,
            config: subtitulosCfg,
          },
        });
        const { edl } = generarDaVinciEDLMulticlip({
          videoName: project.nombre,
          clips: clipsForExport,
          snippets: plan.snippets,
        });

        const { draftJson, metaJson } = generarCapCutDraftMulticlip({
          videoName: project.nombre,
          clips: clipsForExport,
          snippets: plan.snippets,
          subtitulos: {
            transcripcion: transcripcionAjustada,
            config: subtitulosCfg,
          },
        });

        // Descargar todos los videos originales para meterlos en el ZIP
        // CapCut. Hacemos descarga SECUENCIAL (no Promise.all paralelo)
        // para reportar progress claro por cada clip + bajar el pico de
        // memoria (todos los buffers no estan en RAM al mismo tiempo
        // mientras se descargan). Total puede tardar varios minutos para
        // 6+ clips de 100+ MB.
        const clipBuffers: Buffer[] = [];
        for (let i = 0; i < clipsForExport.length; i++) {
          const c = clipsForExport[i];
          await updateProgress(projectId, {
            step: 5,
            label: "Generación XML / EDL / CapCut / SRT",
            detail: `Descargando clip ${i + 1} de ${clipsForExport.length} (${c.name})`,
            startedAt: new Date().toISOString(),
            percent: Math.round((i / clipsForExport.length) * 80),
          });
          clipBuffers.push(await downloadFromBlob(c.url));
        }

        await updateProgress(projectId, {
          step: 5,
          label: "Generación XML / EDL / CapCut / SRT",
          detail: "Empaquetando ZIP CapCut",
          startedAt: new Date().toISOString(),
          percent: 85,
        });
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

        // Generar SRT con la misma agrupacion (palabras-por-linea) que
        // CapCut. Subimos las 4 cosas en paralelo.
        const srt = generarSRT(
          transcripcionAjustada,
          subtitulosCfg.palabras_por_linea ?? 4,
        );

        await updateProgress(projectId, {
          step: 5,
          label: "Generación XML / EDL / CapCut / SRT",
          detail: "Subiendo archivos al blob",
          startedAt: new Date().toISOString(),
          percent: 90,
        });
        const [xmlUrl, edlUrl, capcutUrl, srtUrl] = await Promise.all([
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
          uploadToBlob(
            `proyectos-srt/${projectId}.srt`,
            Buffer.from(srt, "utf8"),
            "text/plain; charset=utf-8"
          ),
        ]);

        return { xmlUrl, edlUrl, capcutUrl, srtUrl };
        } finally {
          stopHb();
        }
      });

      // ── 7. (OPCIONAL) Render Remotion con subtítulos quemados ──
      //
      // Solo se ejecuta si el cliente marco renderSubtitulos=true al crear
      // el proyecto. Toma 10-15 min adicionales. Si NO se pidio, el
      // outputUrl queda apuntando al video_unido.mp4 (sin subs quemados).
      let finalOutputUrl = videoUnidoUrl;
      if (project.renderSubtitulos) {
        const renderResult = await step.run("final-render", async () => {
          await advanceToStep(
            projectId,
            6,
            "Render MP4 con subtítulos quemados",
            "Esto suele tardar 5-15 minutos según la duración del video",
          );
          const stopHb = startHeartbeat(projectId);
          try {
            const buf = await downloadFromBlob(transcripcionFinalUrl);
            const transcripcion = JSON.parse(buf.toString()) as WordTimestamp[];
            return await renderizarVideoFinal(projectId, {
              videoUrl: videoUnidoUrl,
              transcripcion,
              clienteProfile: {
                ...cliente,
                subtitulos: {
                  ...cliente.subtitulos,
                  ...(project.subtitulosOverride ?? {}),
                  animacion:
                    plan.animacionOverride ??
                    project.subtitulosOverride?.animacion ??
                    cliente.subtitulos.animacion,
                },
              },
              enfasisPalabras: plan.enfasisPalabras,
            });
          } finally {
            stopHb();
          }
        });
        finalOutputUrl = renderResult.url;
      }

      const duracionFinal = calcularDuracionFinal(plan.snippets);

      await step.run("mark-completed", async () => {
        await advanceToStep(
          projectId,
          project.renderSubtitulos ? 7 : 6,
          "Finalizado",
          "Pipeline completado",
        );
        return updateProject(projectId, {
          status: "completed",
          xmlUrl: exportResult.xmlUrl,
          edlUrl: exportResult.edlUrl,
          capcutUrl: exportResult.capcutUrl,
          srtUrl: exportResult.srtUrl,
          outputUrl: finalOutputUrl,
          planMulticlip: plan,
          keepSegmentsCount: plan.snippets.length,
          duracionSeg: duracionFinal,
          clips: clipAnalysis.map<ClipMultiSource>((c) => ({
            url: c.url,
            name: c.name,
            duracion: c.duracion,
            width: c.width,
            height: c.height,
            fps: c.fps,
          })),
        });
      });

      return {
        projectId,
        outputUrl: finalOutputUrl,
        xmlUrl: exportResult.xmlUrl,
        edlUrl: exportResult.edlUrl,
        capcutUrl: exportResult.capcutUrl,
      };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      // Si es un network error (TypeError: terminated, UND_ERR_SOCKET,
      // etc.), traducimos a un mensaje accionable. El usuario sabe que
      // no es culpa de su material y que basta con reintentar.
      const msg = isNetworkError(err)
        ? `Conexión con Vercel Sandbox interrumpida después de varios reintentos. Probable problema de red temporal — dale Reintentar en unos segundos. (${rawMsg.slice(0, 100)})`
        : rawMsg;
      await updateProject(projectId, { status: "error", errorMessage: msg });
      throw err;
    }
  }
);
