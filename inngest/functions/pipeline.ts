import { inngest } from "../client";
import { getProject, updateProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import { createPreprocessSandbox } from "@/lib/sandbox";
import { detectarSilencios, ejecutarFFmpegCommands } from "@/lib/ffmpeg";
import { transcribirConWhisperDesdeUrl } from "@/lib/openai";
import { buildOrchestrationPrompt, callClaude } from "@/lib/anthropic";
import { renderizarVideoFinal } from "@/lib/render";
import { uploadFromSandboxToBlob } from "@/lib/blob";

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

      const transcripcion = await step.run("transcribe", () =>
        transcribirConWhisperDesdeUrl(project.footageUrl)
      );

      const instrucciones = await step.run("claude-orchestrate", () =>
        callClaude(
          buildOrchestrationPrompt(
            cliente,
            transcripcion,
            silencios,
            project.brief,
            "/tmp/input.mp4",
            "/tmp/video_limpio.mp4"
          )
        )
      );

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

      const { url: outputUrl } = await step.run("remotion-render", () =>
        renderizarVideoFinal(projectId, {
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
        })
      );

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
