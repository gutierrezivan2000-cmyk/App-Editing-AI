import { inngest } from "../client";
import { getProject, updateProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import { createPreprocessSandbox } from "@/lib/sandbox";
import { detectarSilencios, ejecutarFFmpegCommands } from "@/lib/ffmpeg";
import { transcribirConWhisperDesdeUrl } from "@/lib/openai";
import { buildOrchestrationPrompt, callClaude } from "@/lib/anthropic";
import { renderizarVideoFinal } from "@/lib/render";
import { uploadFromSandboxToBlob, uploadToBlob, downloadFromBlob } from "@/lib/blob";

export const procesarVideo = inngest.createFunction(
  {
    id: "procesar-video",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "pipeline/run" },
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

      const silencios = await step.run("detect-silences", async () => {
        const sandbox = await createPreprocessSandbox();
        try {
          await sandbox.runCommand({
            cmd: "bash",
            args: ["-lc", `curl -L "${project.footageUrl}" -o /tmp/input.mp4`],
          });
          return await detectarSilencios(sandbox, "/tmp/input.mp4", cliente.silencio);
        } finally {
          await sandbox.stop();
        }
      });

      // Store transcription in Blob to avoid Inngest's 25 MB step-result limit
      const transcripcionUrl = await step.run("transcribe", async () => {
        const words = await transcribirConWhisperDesdeUrl(project.footageUrl);
        return uploadToBlob(
          `transcripciones/${projectId}.json`,
          Buffer.from(JSON.stringify(words)),
          "application/json"
        );
      });

      const instrucciones = await step.run("claude-orchestrate", async () => {
        const buf = await downloadFromBlob(transcripcionUrl);
        const transcripcion = JSON.parse(buf.toString()) as Awaited<
          ReturnType<typeof transcribirConWhisperDesdeUrl>
        >;
        return callClaude(
          buildOrchestrationPrompt(
            cliente,
            transcripcion,
            silencios,
            project.brief,
            "/tmp/input.mp4",
            "/tmp/video_limpio.mp4"
          )
        );
      });

      const videoLimpioUrl = await step.run("ffmpeg-cuts", async () => {
        const sandbox = await createPreprocessSandbox();
        try {
          await sandbox.runCommand({
            cmd: "bash",
            args: ["-lc", `curl -L "${project.footageUrl}" -o /tmp/input.mp4`],
          });
          await ejecutarFFmpegCommands(sandbox, instrucciones.ffmpegCommands);
          return await uploadFromSandboxToBlob(
            sandbox,
            "/tmp/video_limpio.mp4",
            `intermedio/${projectId}.mp4`
          );
        } finally {
          await sandbox.stop();
        }
      });

      const { url: outputUrl } = await step.run("remotion-render", async () => {
        const buf = await downloadFromBlob(transcripcionUrl);
        const transcripcion = JSON.parse(buf.toString()) as Awaited<
          ReturnType<typeof transcribirConWhisperDesdeUrl>
        >;
        return renderizarVideoFinal(projectId, {
          videoUrl: videoLimpioUrl,
          transcripcion,
          clienteProfile: {
            ...cliente,
            subtitulos: {
              ...cliente.subtitulos,
              animacion:
                instrucciones.animacionOverride ?? cliente.subtitulos.animacion,
            },
          },
          enfasisPalabras: instrucciones.enfasisPalabras,
        });
      });

      await step.run("mark-completed", () =>
        updateProject(projectId, { status: "completed", outputUrl })
      );

      return { projectId, outputUrl };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateProject(projectId, { status: "error", errorMessage: msg });
      throw err;
    }
  }
);
