import { Sandbox } from "@vercel/sandbox";
import { SilenceSegment, ClienteProfile } from "@/types";
import { runInSandbox } from "./sandbox";

export async function detectarSilencios(
  sandbox: Sandbox,
  videoPath: string,
  config: ClienteProfile["silencio"]
): Promise<SilenceSegment[]> {
  const cmd = `ffmpeg -hide_banner -i "${videoPath}" -af "silencedetect=noise=${config.umbral_db}dB:d=${config.duracion_minima_seg}" -f null - 2>&1`;
  const { stdout, exitCode } = await runInSandbox(sandbox, cmd);

  if (exitCode !== 0) {
    throw new Error(`FFmpeg silence detection failed (exit ${exitCode}): ${stdout.slice(-400)}`);
  }

  const startMatches = [...stdout.matchAll(/silence_start:\s*([\d.]+)/g)];
  const endMatches = [...stdout.matchAll(/silence_end:\s*([\d.]+)/g)];

  const silencios: SilenceSegment[] = [];
  for (let i = 0; i < startMatches.length; i++) {
    const start = parseFloat(startMatches[i][1]);
    const endMatch = endMatches[i];
    if (!endMatch) continue;
    const end = parseFloat(endMatch[1]);
    silencios.push({
      start: Math.max(0, start + config.margen_seg),
      end: Math.max(0, end - config.margen_seg),
      duracion: end - start,
    });
  }

  return silencios.filter((s) => s.end > s.start);
}

export async function ejecutarFFmpegCommands(
  sandbox: Sandbox,
  commands: string[]
): Promise<void> {
  for (const cmd of commands) {
    const { stderr, exitCode } = await runInSandbox(sandbox, cmd);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg falló (exit ${exitCode}): ${stderr.slice(-500)}`);
    }
  }
}
