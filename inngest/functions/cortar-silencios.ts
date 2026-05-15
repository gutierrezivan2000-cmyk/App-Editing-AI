import JSZip from "jszip";
import { inngest } from "../client";
import { getCorte, updateCorte } from "@/lib/cortes-db";
import { createPreprocessSandbox, runInSandbox } from "@/lib/sandbox";
import { detectarSilencios, extraerMetadata } from "@/lib/ffmpeg";
import { uploadToBlob, downloadFromBlob } from "@/lib/blob";
import { generarPremiereXML } from "@/lib/premiere-xml";
import { generarDaVinciEDL } from "@/lib/davinci-edl";
import { generarCapCutDraft } from "@/lib/capcut-draft";

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

      const exportResult = await step.run("generate-exports", async () => {
        const exportOpts = {
          videoUrl: corte.footageUrl,
          videoName: corte.nombre,
          metadata: analisis.metadata,
          silencios: analisis.silencios,
          sequenceName: `${corte.nombre}_sin_silencios`,
        };

        const { xml, segments } = generarPremiereXML(exportOpts);
        const { edl } = generarDaVinciEDL(exportOpts);
        const { draftJson, metaJson, localFilename } = generarCapCutDraft(
          exportOpts
        );

        // Descargar el video original en paralelo con la generación de los
        // otros formatos para empaquetarlo dentro del ZIP de CapCut.
        const videoBuffer = await downloadFromBlob(corte.footageUrl);

        const capcutZip = new JSZip();
        capcutZip.file("draft_content.json", draftJson);
        capcutZip.file("draft_meta_info.json", metaJson);
        capcutZip.file(localFilename, videoBuffer);
        const capcutBuffer = await capcutZip.generateAsync({
          type: "nodebuffer",
          compression: "STORE",
        });

        const [xmlUrl, edlUrl, capcutUrl] = await Promise.all([
          uploadToBlob(
            `cortes-xml/${corteId}.xml`,
            Buffer.from(xml, "utf8"),
            "application/xml"
          ),
          uploadToBlob(
            `cortes-edl/${corteId}.edl`,
            Buffer.from(edl, "utf8"),
            "text/plain"
          ),
          uploadToBlob(
            `cortes-capcut/${corteId}.zip`,
            capcutBuffer,
            "application/zip"
          ),
        ]);

        return {
          xmlUrl,
          edlUrl,
          capcutUrl,
          segmentsCount: segments.length,
          silenciosCount: analisis.silencios.length,
          duracionSeg: analisis.metadata.duracion,
        };
      });

      await step.run("mark-completed", () =>
        updateCorte(corteId, {
          status: "completed",
          xmlUrl: exportResult.xmlUrl,
          edlUrl: exportResult.edlUrl,
          capcutUrl: exportResult.capcutUrl,
          segmentsCount: exportResult.segmentsCount,
          silenciosCount: exportResult.silenciosCount,
          duracionSeg: exportResult.duracionSeg,
        })
      );

      return {
        corteId,
        xmlUrl: exportResult.xmlUrl,
        edlUrl: exportResult.edlUrl,
        capcutUrl: exportResult.capcutUrl,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateCorte(corteId, { status: "error", errorMessage: msg });
      throw err;
    }
  }
);

