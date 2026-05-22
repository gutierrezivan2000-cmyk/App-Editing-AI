import path from "node:path";
import { readFile } from "node:fs/promises";
import { inngest } from "../client";
import { getMontaje, updateMontaje } from "@/lib/montajes-db";
import { uploadToBlob } from "@/lib/blob";
import {
  descargarA,
  extraerMetadata,
  detectarSilencios,
  calcularKeepSegments,
  cortarYMontar,
  limpiarTemp,
} from "@/lib/ffmpeg-local";

/**
 * Pipeline montaje: silencios → video MP4 ya cortado y montado.
 *
 * A diferencia del módulo "cortar" (que solo exporta XML/EDL), este módulo
 * entrega el video final renderizado, listo para descargar/publicar.
 *
 * No depende de Sandbox, Remotion, Claude ni Mirage. Solo ffmpeg-static.
 */
export const procesarMontaje = inngest.createFunction(
  {
    id: "montaje-cortar-y-montar",
    retries: 1,
    concurrency: { limit: 2 },
  },
  { event: "montaje/run" },
  async ({ event, step, logger }) => {
    const { montajeId } = event.data as { montajeId: string };

    const tmpDir = "/tmp";
    const inputPath = path.join(tmpDir, `montaje-input-${montajeId}.mp4`);
    const outputPath = path.join(tmpDir, `montaje-output-${montajeId}.mp4`);

    try {
      const montaje = await step.run("get-montaje", () => getMontaje(montajeId));

      await step.run("mark-processing", () =>
        updateMontaje(montajeId, { status: "processing", step: "downloading" })
      );

      // 1. Descarga el footage a /tmp.
      await step.run("download", async () => {
        logger.info(`Descargando footage para montaje ${montajeId}`);
        await descargarA(montaje.footageUrl, inputPath);
      });

      // 2. Extrae metadata (duración, dimensiones).
      const meta = await step.run("metadata", async () => {
        await updateMontaje(montajeId, { step: "metadata" });
        const m = await extraerMetadata(inputPath);
        logger.info(`Metadata: ${m.width}x${m.height}@${m.fps}fps, ${m.duracion}s`);
        await updateMontaje(montajeId, { duracionOriginalSeg: m.duracion });
        return m;
      });

      // 3. Detecta silencios.
      const silencios = await step.run("detect-silences", async () => {
        await updateMontaje(montajeId, { step: "detecting_silences" });
        const ranges = await detectarSilencios(inputPath, {
          umbralDb: montaje.umbralDb,
          duracionMinima: montaje.duracionMinima,
          margenSeg: montaje.margenSeg,
        });
        logger.info(`Detectados ${ranges.length} silencios`);
        await updateMontaje(montajeId, { silenciosCount: ranges.length });
        return ranges;
      });

      // 4. Calcula segmentos a conservar.
      const keeps = calcularKeepSegments(silencios, meta.duracion);
      if (keeps.length === 0) {
        throw new Error(
          "No quedó ningún segmento útil tras eliminar silencios. ¿El video es todo silencio o el umbral es demasiado alto?"
        );
      }
      await updateMontaje(montajeId, { segmentsCount: keeps.length });
      logger.info(`Segmentos a conservar: ${keeps.length}`);

      // 5. Corta y monta en un único paso ffmpeg.
      await step.run("cut-and-concat", async () => {
        await updateMontaje(montajeId, { step: "rendering" });
        await cortarYMontar(inputPath, outputPath, keeps);
      });

      // 6. Sube el resultado a Vercel Blob.
      const result = await step.run("upload", async () => {
        await updateMontaje(montajeId, { step: "uploading" });
        const buffer = await readFile(outputPath);
        const url = await uploadToBlob(
          `montajes/${montajeId}.mp4`,
          buffer,
          "video/mp4"
        );

        // Calcula la duración final como suma de los keep-segments.
        const duracionFinal = keeps.reduce((sum, k) => sum + k.duracion, 0);
        return { url, duracionFinal };
      });

      // 7. Marca como completado.
      await step.run("mark-completed", () =>
        updateMontaje(montajeId, {
          status: "completed",
          step: "done",
          videoFinalUrl: result.url,
          duracionFinalSeg: result.duracionFinal,
        })
      );

      return {
        montajeId,
        videoFinalUrl: result.url,
        silencios: silencios.length,
        segmentos: keeps.length,
        duracionOriginal: meta.duracion,
        duracionFinal: result.duracionFinal,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Montaje ${montajeId} falló: ${msg}`);
      await updateMontaje(montajeId, {
        status: "error",
        errorMessage: msg.slice(0, 1000),
      });
      throw err;
    } finally {
      // Limpia siempre los archivos temporales para no llenar /tmp.
      await limpiarTemp(inputPath, outputPath);
    }
  }
);
