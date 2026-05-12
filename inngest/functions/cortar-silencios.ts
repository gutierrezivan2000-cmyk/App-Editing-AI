import { inngest } from "../client";
import { getCorte, updateCorte } from "@/lib/cortes-db";
import { createPreprocessSandbox, runInSandbox } from "@/lib/sandbox";
import { detectarSilencios } from "@/lib/ffmpeg";
import { uploadToBlob } from "@/lib/blob";
import { generarPremiereXML, type VideoMetadata } from "@/lib/premiere-xml";

/**
 * Pipeline simplificado: silencios → XML para Premiere Pro.
 * Independiente del pipeline principal (sin Claude, Whisper, Remotion ni Mirage).
 */
export const cortarSilencios = inngest.createFunction(
  {
    id: "cortar-silencios",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "cortar/run" },
  async ({ event, step }) => {
    const { corteId } = event.data as { corteId: string };

    try {
      const corte = await step.run("get-corte", () => getCorte(corteId));

      await step.run("mark-processing", () =>
        updateCorte(corteId, { status: "processing" })
      );

      const analisis = await step.run("analyze-footage", async () => {
        const sandbox = await createPreprocessSandbox();
        try {
          const dl = await runInSandbox(
            sandbox,
            `curl -fsSL "${corte.footageUrl}" -o /tmp/input.mp4`
          );
          if (dl.exitCode !== 0) {
            throw new Error(`Descarga fallida: ${dl.stderr.slice(-300)}`);
          }

          const metadata = await extraerMetadata(sandbox, "/tmp/input.mp4");

          const silencios = await detectarSilencios(sandbox, "/tmp/input.mp4", {
            umbral_db: corte.umbralDb,
            duracion_minima_seg: corte.duracionMinima,
            margen_seg: corte.margenSeg,
          });

          return { metadata, silencios };
        } finally {
          await sandbox.stop();
        }
      });

      const xmlResult = await step.run("generate-xml", async () => {
        const { xml, segments } = generarPremiereXML({
          videoUrl: corte.footageUrl,
          videoName: corte.nombre,
          metadata: analisis.metadata,
          silencios: analisis.silencios,
          sequenceName: `${corte.nombre}_sin_silencios`,
        });

        const xmlUrl = await uploadToBlob(
          `cortes-xml/${corteId}.xml`,
          Buffer.from(xml, "utf8"),
          "application/xml"
        );

        return {
          xmlUrl,
          segmentsCount: segments.length,
          silenciosCount: analisis.silencios.length,
          duracionSeg: analisis.metadata.duracion,
        };
      });

      await step.run("mark-completed", () =>
        updateCorte(corteId, {
          status: "completed",
          xmlUrl: xmlResult.xmlUrl,
          segmentsCount: xmlResult.segmentsCount,
          silenciosCount: xmlResult.silenciosCount,
          duracionSeg: xmlResult.duracionSeg,
        })
      );

      return { corteId, xmlUrl: xmlResult.xmlUrl };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateCorte(corteId, { status: "error", errorMessage: msg });
      throw err;
    }
  }
);

/**
 * Extrae width, height, fps y duración usando ffmpeg.
 * ffmpeg -i <file> sin output imprime la info por stderr y sale con código 1.
 */
async function extraerMetadata(
  sandbox: Awaited<ReturnType<typeof createPreprocessSandbox>>,
  videoPath: string
): Promise<VideoMetadata> {
  const { stdout } = await runInSandbox(
    sandbox,
    `ffmpeg -hide_banner -i "${videoPath}" 2>&1 || true`
  );

  const sizeMatch = stdout.match(/(\d{2,5})x(\d{2,5})/);
  const fpsMatch = stdout.match(/(\d+(?:\.\d+)?)\s*(?:fps|tbr)/);
  const durationMatch = stdout.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);

  const width = sizeMatch ? parseInt(sizeMatch[1], 10) : 1920;
  const height = sizeMatch ? parseInt(sizeMatch[2], 10) : 1080;
  const fps = fpsMatch ? Math.round(parseFloat(fpsMatch[1])) : 30;

  let duracion = 0;
  if (durationMatch) {
    duracion =
      parseInt(durationMatch[1], 10) * 3600 +
      parseInt(durationMatch[2], 10) * 60 +
      parseFloat(durationMatch[3]);
  }

  if (duracion === 0) {
    throw new Error("No se pudo extraer la duración del video");
  }

  return { width, height, fps: fps > 0 ? fps : 30, duracion };
}
