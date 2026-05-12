import { inngest } from "../client";
import { getProject, updateProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import { createPreprocessSandbox, runInSandbox } from "@/lib/sandbox";
import { detectarSilencios, ejecutarFFmpegCommands } from "@/lib/ffmpeg";
import { transcribirConWhisperDesdeUrl } from "@/lib/openai";
import { buildOrchestrationPrompt, callClaude } from "@/lib/anthropic";
import { renderizarVideoFinal } from "@/lib/render";
import { renderizarConMirage } from "@/lib/mirage";
import { uploadFromSandboxToBlob, uploadToBlob, downloadFromBlob } from "@/lib/blob";

export const procesarVideo = inngest.createFunction(
  {
    id: "procesar-video",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "pipeline/run" },
  async ({ event, step }) => {
    const { projectId, renderMethod = "original" } = event.data as {
      projectId: string;
      renderMethod?: "original" | "mirage";
    };
    const useMirage = renderMethod === "mirage";

    try {
      const project = await step.run("get-project", () => getProject(projectId));
      const cliente = await step.run("get-cliente", () =>
        getClienteProfile(project.clienteId)
      );

      await step.run("mark-processing", () =>
        updateProject(projectId, { status: "processing" })
      );

      // Combined step: download once, detect silences AND extract audio in the same sandbox.
      // When Mirage is enabled we skip audio extraction (Mirage transcribes internally).
      const { silencios, audioUrl } = await step.run("analyze-footage", async () => {
        const sandbox = await createPreprocessSandbox();
        try {
          const dl = await runInSandbox(
            sandbox,
            `curl -fsSL "${project.footageUrl}" -o /tmp/input.mp4`
          );
          if (dl.exitCode !== 0) {
            throw new Error(`Download failed (curl exit ${dl.exitCode}): ${dl.stderr.slice(-300)}`);
          }

          const silencios = await detectarSilencios(sandbox, "/tmp/input.mp4", cliente.silencio);

          if (useMirage) {
            return { silencios, audioUrl: null as unknown as string };
          }

          const fx = await runInSandbox(
            sandbox,
            `ffmpeg -y -i /tmp/input.mp4 -vn -ac 1 -ar 16000 -b:a 64k /tmp/audio.mp3`
          );
          if (fx.exitCode !== 0) {
            throw new Error(`Audio extraction failed (exit ${fx.exitCode}): ${fx.stderr.slice(-500)}`);
          }

          const audioUrl = await uploadFromSandboxToBlob(
            sandbox,
            "/tmp/audio.mp3",
            `audios/${projectId}.mp3`
          );
          return { silencios, audioUrl };
        } finally {
          await sandbox.stop();
        }
      });

      // Transcription + Claude orchestration.
      // Mirage path: Claude only decides silence cuts (no Whisper transcription needed).
      // Remotion path: Whisper → Claude with full transcript → emphasis words + animation.
      let transcripcionUrl: string | null = null;

      const instrucciones = await (async () => {
        if (useMirage) {
          return step.run("claude-orchestrate-silencios", () =>
            callClaude(buildSilenciosOnlyPrompt(silencios, project.brief))
          );
        }

        transcripcionUrl = await step.run("transcribe", async () => {
          const words = await transcribirConWhisperDesdeUrl(audioUrl);
          return uploadToBlob(
            `transcripciones/${projectId}.json`,
            Buffer.from(JSON.stringify(words)),
            "application/json"
          );
        });

        return step.run("claude-orchestrate", async () => {
          const buf = await downloadFromBlob(transcripcionUrl!);
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
      })();

      // If Claude found no cuts to make, skip FFmpeg entirely and use original footage.
      const videoLimpioUrl = await step.run("ffmpeg-cuts", async () => {
        if (instrucciones.ffmpegCommands.length === 0) {
          return project.footageUrl;
        }

        const sandbox = await createPreprocessSandbox();
        try {
          const dl = await runInSandbox(
            sandbox,
            `curl -fsSL "${project.footageUrl}" -o /tmp/input.mp4`
          );
          if (dl.exitCode !== 0) {
            throw new Error(`Download failed (curl exit ${dl.exitCode}): ${dl.stderr.slice(-300)}`);
          }
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

      const { url: outputUrl } = await step.run("final-render", async () => {
        if (useMirage) {
          return renderizarConMirage(videoLimpioUrl);
        }

        const buf = await downloadFromBlob(transcripcionUrl!);
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

function buildSilenciosOnlyPrompt(
  silencios: import("@/types").SilenceSegment[],
  brief: string
): string {
  return `Eres un editor de video. Analiza los silencios detectados y el brief, y devuelve
qué silencios cortar con FFmpeg.

BRIEF:
${brief}

SILENCIOS DETECTADOS (${silencios.length}):
${JSON.stringify(silencios.slice(0, 200))}

RUTAS FFMPEG:
- Input: /tmp/input.mp4
- Output: /tmp/video_limpio.mp4

RESPONDE ÚNICAMENTE CON JSON VÁLIDO:
{
  "enfasisPalabras": [],
  "silenciosFinales": [{"start": 0.0, "end": 0.5, "duracion": 0.5}],
  "ffmpegCommands": [],
  "observaciones": "string",
  "animacionOverride": null
}`;
}
