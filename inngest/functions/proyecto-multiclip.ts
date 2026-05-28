import JSZip from "jszip";
import { inngest } from "../client";
import { getProject, updateProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import {
  createPreprocessSandbox,
  downloadInSandbox,
  downloadInSandboxBatch,
  isNetworkError,
  runInSandbox,
} from "@/lib/sandbox";
import {
  ejecutarFFmpegCommands,
  extraerMetadata,
} from "@/lib/ffmpeg";
import {
  downloadFromBlob,
  publicBlobUrl,
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
import {
  generateClipsDownloadBatchScript,
  generateClipsDownloadShellScript,
  generateClipsReadme,
} from "@/lib/clips-bundle";
import { renderizarVideoFinal } from "@/lib/render";
import { advanceToStep, startHeartbeat, updateProgress } from "@/lib/pipeline-progress";
import { preflightMulticlip } from "@/lib/preflight";
import type { ClipMultiSource, WordTimestamp } from "@/types";

/**
 * Descarga N clips desde Vercel Blob a Node con concurrencia limitada.
 * Antes hacíamos esto secuencial — 16 clips × 60s c/u = 16 min. Con
 * concurrencia 4 cae a ~4 min sin saturar memoria ni la conexion.
 *
 * Importante: mantiene el orden del array de entrada (los buffers salen
 * indexed igual que los clips).
 */
async function downloadClipsParallel<T extends { url: string }>(
  items: T[],
  concurrency: number,
): Promise<Buffer[]> {
  const results: Buffer[] = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      results[idx] = await downloadFromBlob(items[idx].url);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

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
      //
      // Estrategia para ser rapido:
      //   a) Descargar TODOS los clips en paralelo (xargs -P 4 dentro del
      //      sandbox) — antes era secuencial, lo cual para 16 clips de 60MB
      //      tomaba 8-12 min. Paralelo: 2-3 min.
      //   b) Loop secuencial para metadata + extraer audio + upload audio,
      //      porque cada ffmpeg agarra CPU y los upload mp3 son chicos.
      //      Total: ~10s por clip = 2-3 min para 16 clips.
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

          // a) Descarga PARALELA de todos los clips.
          await updateProgress(projectId, {
            step: 0,
            label: "Análisis de cada clip (metadata + audio)",
            detail: `Descargando ${total} clips en paralelo (concurrencia 4)`,
            startedAt: new Date().toISOString(),
            percent: 5,
          });
          const dl = await downloadInSandboxBatch(
            sandbox,
            project.clips!.map((c, i) => ({
              url: c.url,
              destPath: `/tmp/clip_${i}.mp4`,
            })),
            4,
          );
          if (dl.exitCode !== 0) {
            throw new Error(
              `Descarga paralela de clips fallida: ${dl.stderr.slice(-500)}`,
            );
          }

          // b) Loop secuencial: metadata + audio + upload audio.
          for (let i = 0; i < total; i++) {
            const c = project.clips![i];
            await updateProgress(projectId, {
              step: 0,
              label: "Análisis de cada clip (metadata + audio)",
              detail: `Procesando audio ${i + 1} / ${total} (${c.name})`,
              startedAt: new Date().toISOString(),
              percent: 25 + Math.round((i / total) * 75),
            });

            const inputPath = `/tmp/clip_${i}.mp4`;
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
      //
      // Whisper API soporta concurrencia tranquila — el rate limit de OpenAI
      // por defecto es 50 req/min para Whisper, asi que con 3 paralelos
      // estamos lejos del limite. Para 16 clips, esto baja el tiempo de 3-5
      // min a ~1-2 min sin tocar el rate limit.
      const transcripcionesUrl = await step.run("transcribe-clips", async () => {
        await advanceToStep(
          projectId,
          1,
          "Transcripción Whisper de cada clip",
          `0 / ${clipAnalysis.length} clips`,
        );
        const stopHb = startHeartbeat(projectId);
        const WHISPER_CONCURRENCY = 3;
        try {
          const transcripciones: WordTimestamp[][] = new Array(
            clipAnalysis.length,
          );
          let nextIdx = 0;
          let completed = 0;
          async function worker() {
            while (true) {
              const idx = nextIdx++;
              if (idx >= clipAnalysis.length) return;
              const c = clipAnalysis[idx];
              const words = await transcribirConWhisperDesdeUrl(c.audioUrl);
              transcripciones[idx] = words;
              completed++;
              // Progress update por cada clip que termina. Como vienen en
              // paralelo, mostramos "X/N" en vez de el index del clip
              // actual (que ya no significa nada con concurrencia).
              await updateProgress(projectId, {
                step: 1,
                label: "Transcripción Whisper de cada clip",
                detail: `Transcritos ${completed} / ${clipAnalysis.length} clips (concurrencia ${WHISPER_CONCURRENCY})`,
                startedAt: new Date().toISOString(),
                percent: Math.round((completed / clipAnalysis.length) * 100),
              });
            }
          }
          const workers = Array.from(
            { length: Math.min(WHISPER_CONCURRENCY, clipAnalysis.length) },
            () => worker(),
          );
          await Promise.all(workers);
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
          // Descargar todos los clips en PARALELO (conc 4) — antes
          // hacíamos un loop secuencial que para 16 clips de 60MB tomaba
          // 4-8 min. La concurrencia baja eso a ~1-2 min sin saturar el
          // sandbox.
          const dl = await downloadInSandboxBatch(
            sandbox,
            clipAnalysis.map((c, i) => ({
              url: c.url,
              destPath: `/tmp/clip_${i}.mp4`,
            })),
            4,
          );
          if (dl.exitCode !== 0) {
            throw new Error(
              `Descarga de clips para concat falló: ${dl.stderr.slice(-500)}`,
            );
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

        // Armado del ZIP CapCut. Dos modos:
        //
        //  - incluirClipsEnZip = false (DEFAULT):
        //      ZIP liviano (~50 KB). Solo trae draft_content + meta + un
        //      README con URLs y dos scripts (sh/bat) que el usuario corre
        //      para descargar los clips a la misma carpeta del ZIP. Esto
        //      ahorra 5-15 min por pipeline porque NO hay que bajar +922MB
        //      de Vercel Blob para empaquetarlos + subir el ZIP gigante.
        //
        //  - incluirClipsEnZip = true (legacy / power user):
        //      Comportamiento historico. Descargamos los clips en
        //      PARALELO con concurrencia limitada y los embebemos. ZIP
        //      pesa los GB que pesen los clips.
        const incluirClips = project.incluirClipsEnZip === true;
        const capcutZip = new JSZip();
        capcutZip.file("draft_content.json", draftJson);
        capcutZip.file("draft_meta_info.json", metaJson);

        if (incluirClips) {
          // Promise.all con concurrencia limitada (4 a la vez) — antes era
          // secuencial y bajaba 922 MB en serial. 4 paralelos baja eso a
          // ~25% del tiempo sin saturar la conexion.
          await updateProgress(projectId, {
            step: 5,
            label: "Generación XML / EDL / CapCut / SRT",
            detail: `Descargando ${clipsForExport.length} clips en paralelo (concurrencia 4)`,
            startedAt: new Date().toISOString(),
            percent: 30,
          });
          const clipBuffers = await downloadClipsParallel(clipsForExport, 4);
          await updateProgress(projectId, {
            step: 5,
            label: "Generación XML / EDL / CapCut / SRT",
            detail: "Empaquetando ZIP CapCut con clips embebidos",
            startedAt: new Date().toISOString(),
            percent: 75,
          });
          clipsForExport.forEach((c, idx) => {
            capcutZip.file(c.localFilename, clipBuffers[idx]);
          });
        } else {
          // ZIP liviano: README + scripts.
          const bundleOpts = {
            videoName: project.nombre,
            clips: clipsForExport,
          };
          capcutZip.file("clips-README.md", generateClipsReadme(bundleOpts));
          capcutZip.file(
            "descargar-clips.sh",
            generateClipsDownloadShellScript(bundleOpts),
          );
          capcutZip.file(
            "descargar-clips.bat",
            generateClipsDownloadBatchScript(bundleOpts),
          );
        }
        const capcutBuffer = await capcutZip.generateAsync({
          type: "nodebuffer",
          compression: incluirClips ? "STORE" : "DEFLATE",
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

/**
 * Pipeline de RE-RENDER: re-arma el video final con el estado ACTUAL del
 * proyecto (plan_multiclip + transcripcion-final + subtitulos_override) sin
 * volver a transcribir ni a llamar a Claude. Lo encola el endpoint
 * /api/pipeline/[id]/rerender-output cuando el usuario aprieta "Re-render
 * final" en el editor visual.
 *
 * Diferencias con `procesarMulticlipProyecto`:
 *   - SIN preflight (asumimos que el proyecto ya corrio una vez OK)
 *   - SIN analyze-clips (la metadata ya vive en DB)
 *   - SIN transcribe-clips ni claude-multiclip (se reusa todo lo persistido)
 *   - SI ffmpeg-multiclip-concat (snippets pueden haberse reordenado)
 *   - SI generate-exports (regen XML/EDL/CapCut/SRT con plan + subs actuales)
 *   - SI final-render OPCIONAL (solo si renderSubtitulos=true)
 *
 * Tipicamente termina en 2-5 min si renderSubtitulos=false; 10-15 min si
 * renderSubtitulos=true. Esos rangos son los mismos del pipeline original
 * menos el preflight + analyze + transcribe + Claude (que sumaban 30-90s).
 */
export const rerenderizarMulticlipFinal = inngest.createFunction(
  {
    id: "rerenderizar-multiclip-final",
    retries: 1,
    concurrency: { limit: 3 },
  },
  { event: "pipeline/multiclip-rerender" },
  async ({ event, step }) => {
    const { projectId } = event.data as { projectId: string };

    try {
      const project = await step.run("get-project", () => getProject(projectId));
      const cliente = await step.run("get-cliente", () =>
        getClienteProfile(project.clienteId),
      );

      if (!project.clips || project.clips.length === 0) {
        throw new Error("El proyecto no tiene clips configurados");
      }
      if (!project.planMulticlip) {
        throw new Error("El proyecto no tiene plan multiclip");
      }
      const plan = project.planMulticlip;

      await step.run("mark-processing", () =>
        updateProject(projectId, {
          status: "processing",
          errorMessage: null,
        }),
      );

      // ── 1. Re-armar video_unido.mp4 con los snippets actuales ──
      const videoUnidoUrl = await step.run("ffmpeg-rerender-concat", async () => {
        await advanceToStep(
          projectId,
          0,
          "Re-armado del video con FFmpeg",
          `Recortando y uniendo ${plan.snippets.length} snippets`,
        );
        const stopHb = startHeartbeat(projectId);
        try {
          const sandbox = await createPreprocessSandbox();
          try {
            // Descarga paralela (conc 4) — mismo patron que analyze-clips
            // y ffmpeg-multiclip-concat del pipeline original.
            const dl = await downloadInSandboxBatch(
              sandbox,
              project.clips!.map((c, i) => ({
                url: c.url,
                destPath: `/tmp/clip_${i}.mp4`,
              })),
              4,
            );
            if (dl.exitCode !== 0) {
              throw new Error(
                `Descarga paralela de clips fallida: ${dl.stderr.slice(-500)}`,
              );
            }
            const inputPaths = project.clips!.map((_, i) => `/tmp/clip_${i}.mp4`);
            // Canvas = dimensiones del primer clip (igual que el pipeline
            // original). Si los clips no tienen width/height/fps en DB
            // (proyectos muy viejos), fallback a 1080x1920@30.
            const first = project.clips![0];
            const canvasWidth = first.width ?? 1080;
            const canvasHeight = first.height ?? 1920;
            const fps = first.fps ?? 30;
            await runInSandbox(sandbox, `mkdir -p /tmp/segments`);
            const cmds = buildFFmpegMulticlipCommands(
              inputPaths,
              "/tmp/video_unido.mp4",
              plan.snippets,
              "/tmp/segments",
              "/tmp/concat-list.txt",
              { canvasWidth, canvasHeight, fps },
            );
            await ejecutarFFmpegCommands(sandbox, cmds);
            return await uploadFromSandboxToBlob(
              sandbox,
              "/tmp/video_unido.mp4",
              `intermedio-multiclip/${projectId}.mp4`,
            );
          } finally {
            await sandbox.stop();
          }
        } finally {
          stopHb();
        }
      });

      // ── 2. Regenerar XML / EDL / CapCut / SRT con plan + subs actuales ──
      const exportResult = await step.run("rerender-exports", async () => {
        await advanceToStep(
          projectId,
          1,
          "Regeneracion XML / EDL / CapCut / SRT",
          "Generando archivos editables con el plan actual",
        );
        const stopHb = startHeartbeat(projectId);
        try {
          const clipsForExport: ClipForExport[] = project.clips!.map((c, idx) => ({
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
              idx,
            ),
          }));

          // Cargar transcripcion ajustada (el editor ya la persistio al
          // guardar antes de encolar el rerender).
          const transcripcionUrl = publicBlobUrl(
            `transcripciones-multiclip-final/${projectId}.json`,
          );
          let transcripcion: WordTimestamp[] = [];
          try {
            const buf = await downloadFromBlob(transcripcionUrl);
            transcripcion = JSON.parse(buf.toString()) as WordTimestamp[];
          } catch (err) {
            console.warn("[rerender] no pude cargar transcripcion-final", err);
          }

          const subtitulosCfg = {
            ...cliente.subtitulos,
            ...(project.subtitulosOverride ?? {}),
          };
          const subtitulos = transcripcion.length > 0
            ? { transcripcion, config: subtitulosCfg }
            : undefined;

          const { xml } = generarPremiereXMLMulticlip({
            videoName: project.nombre,
            clips: clipsForExport,
            snippets: plan.snippets,
            subtitulos,
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
            subtitulos,
          });

          // ZIP CapCut: respeta incluirClipsEnZip del proyecto. Ver
          // comentario equivalente en el pipeline original (generate-
          // multiclip-exports) — misma logica de dos modos.
          const incluirClipsRerender = project.incluirClipsEnZip === true;
          const capcutZip = new JSZip();
          capcutZip.file("draft_content.json", draftJson);
          capcutZip.file("draft_meta_info.json", metaJson);

          if (incluirClipsRerender) {
            await updateProgress(projectId, {
              step: 1,
              label: "Regeneracion XML / EDL / CapCut / SRT",
              detail: `Descargando ${clipsForExport.length} clips en paralelo (concurrencia 4)`,
              startedAt: new Date().toISOString(),
              percent: 30,
            });
            const clipBuffers = await downloadClipsParallel(clipsForExport, 4);
            await updateProgress(projectId, {
              step: 1,
              label: "Regeneracion XML / EDL / CapCut / SRT",
              detail: "Empaquetando ZIP CapCut con clips embebidos",
              startedAt: new Date().toISOString(),
              percent: 75,
            });
            clipsForExport.forEach((c, idx) => {
              capcutZip.file(c.localFilename, clipBuffers[idx]);
            });
          } else {
            const bundleOpts = {
              videoName: project.nombre,
              clips: clipsForExport,
            };
            capcutZip.file("clips-README.md", generateClipsReadme(bundleOpts));
            capcutZip.file(
              "descargar-clips.sh",
              generateClipsDownloadShellScript(bundleOpts),
            );
            capcutZip.file(
              "descargar-clips.bat",
              generateClipsDownloadBatchScript(bundleOpts),
            );
          }
          const capcutBuffer = await capcutZip.generateAsync({
            type: "nodebuffer",
            compression: incluirClipsRerender ? "STORE" : "DEFLATE",
          });
          const srt = generarSRT(
            transcripcion,
            subtitulosCfg.palabras_por_linea ?? 4,
          );

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

          return { xmlUrl, edlUrl, capcutUrl, srtUrl, transcripcion };
        } finally {
          stopHb();
        }
      });

      // ── 3. (OPCIONAL) Render Remotion con subs quemados ──
      // Solo si el proyecto se creo con renderSubtitulos=true. Si no, el
      // output queda apuntando al video_unido sin subs (CapCut/Premiere
      // los queman al exportar).
      let finalOutputUrl = videoUnidoUrl;
      if (project.renderSubtitulos) {
        finalOutputUrl = await step.run("rerender-final-render", async () => {
          await advanceToStep(
            projectId,
            2,
            "Re-render MP4 con subtitulos quemados",
            "Suele tardar 5-15 minutos segun la duracion del video",
          );
          const stopHb = startHeartbeat(projectId);
          try {
            const subtitulosEfectivos = {
              ...cliente.subtitulos,
              ...(project.subtitulosOverride ?? {}),
              animacion:
                plan.animacionOverride ??
                project.subtitulosOverride?.animacion ??
                cliente.subtitulos.animacion,
            };
            const { url } = await renderizarVideoFinal(projectId, {
              videoUrl: videoUnidoUrl,
              transcripcion: exportResult.transcripcion,
              clienteProfile: {
                ...cliente,
                subtitulos: subtitulosEfectivos,
              },
              enfasisPalabras: plan.enfasisPalabras,
            });
            return url;
          } finally {
            stopHb();
          }
        });
      }

      const duracionFinal = calcularDuracionFinal(plan.snippets);

      await step.run("mark-completed", async () => {
        await advanceToStep(
          projectId,
          project.renderSubtitulos ? 3 : 2,
          "Finalizado",
          "Re-render completado",
        );
        return updateProject(projectId, {
          status: "completed",
          xmlUrl: exportResult.xmlUrl,
          edlUrl: exportResult.edlUrl,
          capcutUrl: exportResult.capcutUrl,
          srtUrl: exportResult.srtUrl,
          outputUrl: finalOutputUrl,
          duracionSeg: duracionFinal,
          keepSegmentsCount: plan.snippets.length,
        });
      });

      return {
        projectId,
        outputUrl: finalOutputUrl,
        xmlUrl: exportResult.xmlUrl,
        edlUrl: exportResult.edlUrl,
        capcutUrl: exportResult.capcutUrl,
        srtUrl: exportResult.srtUrl,
      };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = isNetworkError(err)
        ? `Conexion con Vercel Sandbox interrumpida durante el re-render. Probable problema de red temporal — dale Reintentar en unos segundos. (${rawMsg.slice(0, 100)})`
        : rawMsg;
      await updateProject(projectId, { status: "error", errorMessage: msg });
      throw err;
    }
  },
);

/**
 * Pipeline de RE-PLANEO: re-ejecuta Claude para regenerar el
 * plan_multiclip a partir de las transcripciones per-clip que ya viven
 * en blob storage. NO re-corre analyze-clips ni transcribe-clips (ahorra
 * 5-10 min en proyectos con clips ya procesados).
 *
 * Encolado por POST /api/pipeline/[id]/replan. Util cuando:
 *   - Se mejoro el prompt de Claude o la lógica del planning, y queremos
 *     validar contra un proyecto existente sin re-procesar todo.
 *   - El plan original no respetaba el guion, dejaba silencios, repetia
 *     ideas, etc.
 *
 * Al terminar, dispara el evento `pipeline/multiclip-rerender` para que
 * el rerender existing arme el video_unido + exports + opcional MP4
 * quemado con el plan nuevo.
 */
export const replanificarMulticlipFinal = inngest.createFunction(
  {
    id: "replanificar-multiclip-final",
    retries: 1,
    concurrency: { limit: 3 },
  },
  { event: "pipeline/multiclip-replan" },
  async ({ event, step }) => {
    const { projectId } = event.data as { projectId: string };

    try {
      const project = await step.run("get-project", () => getProject(projectId));
      const cliente = await step.run("get-cliente", () =>
        getClienteProfile(project.clienteId),
      );

      if (!project.clips || project.clips.length === 0) {
        throw new Error("El proyecto no tiene clips configurados");
      }

      await step.run("mark-processing", () =>
        updateProject(projectId, {
          status: "processing",
          errorMessage: null,
        }),
      );

      // 1. Cargar transcripciones per-clip del blob (las que Whisper
      //    genero en la corrida original).
      const perClipTranscripciones = await step.run(
        "load-per-clip-transcripcions",
        async () => {
          await advanceToStep(
            projectId,
            0,
            "Re-planeo: cargando transcripciones",
            `Trayendo transcripciones de ${project.clips!.length} clips`,
          );
          const url = publicBlobUrl(
            `transcripciones-multiclip/${projectId}.json`,
          );
          let perClip: WordTimestamp[][];
          try {
            const buf = await downloadFromBlob(url);
            perClip = JSON.parse(buf.toString()) as WordTimestamp[][];
          } catch (err) {
            throw new Error(
              "No se pudieron cargar las transcripciones per-clip — " +
                "el proyecto probablemente fue creado antes de esta feature " +
                "y no las tiene en blob. Ejecuta el pipeline completo con " +
                "'Reintentar' en lugar de re-planear. " +
                (err instanceof Error ? err.message : String(err)),
            );
          }
          if (!Array.isArray(perClip)) {
            throw new Error(
              "Formato invalido en transcripciones-multiclip blob",
            );
          }
          return perClip;
        },
      );

      // 2. Re-ejecutar Claude con el prompt actual y las transcripciones.
      const plan = await step.run("claude-replan", async () => {
        await advanceToStep(
          projectId,
          1,
          "Re-planeo: Claude analiza transcripciones",
          "Decidiendo orden, cortes y enfasis con el plan actualizado",
        );
        const inputClips: MulticlipInputClip[] = project.clips!.map((c, i) => ({
          index: i,
          name: c.name,
          duracion: c.duracion ?? 0,
          transcripcion: perClipTranscripciones[i] ?? [],
        }));
        return planificarMulticlipConClaude(
          inputClips,
          project.brief,
          project.guion ?? null,
          cliente.subtitulos.animacion,
        );
      });

      // 3. Re-derivar la transcripcion ajustada al timeline final con el
      //    plan nuevo, y persistir ambos.
      await step.run("persist-new-plan-and-transcripcion", async () => {
        await advanceToStep(
          projectId,
          2,
          "Re-planeo: ajustando transcripcion al nuevo plan",
          "Recalculando timestamps segun los snippets reordenados",
        );
        const transcripcionFinal = unirTranscripcionesMulticlip(
          perClipTranscripciones,
          plan.snippets,
        );
        await uploadToBlob(
          `transcripciones-multiclip-final/${projectId}.json`,
          Buffer.from(JSON.stringify(transcripcionFinal)),
          "application/json",
        );
        await updateProject(projectId, { planMulticlip: plan });
      });

      // 4. Disparar el rerender — arma video_unido + exports +
      //    opcional MP4 quemado con el plan nuevo. Lo encolamos como
      //    evento separado para que cada fn tenga una responsabilidad
      //    clara y el progreso se vea en steps.
      await step.sendEvent("trigger-rerender", {
        name: "pipeline/multiclip-rerender",
        data: { projectId },
      });

      return {
        projectId,
        replanned: true,
        snippets: plan.snippets.length,
      };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = isNetworkError(err)
        ? `Conexion con Claude/Blob interrumpida durante el re-plan. Reintentar en unos segundos. (${rawMsg.slice(0, 100)})`
        : rawMsg;
      await updateProject(projectId, { status: "error", errorMessage: msg });
      throw err;
    }
  },
);
