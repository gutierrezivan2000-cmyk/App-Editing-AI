import { Sandbox } from "@vercel/sandbox";
import { SilenceSegment, ClienteProfile } from "@/types";
import { runInSandbox } from "./sandbox";
import type { VideoMetadata } from "./premiere-xml";

export async function detectarSilencios(
  sandbox: Sandbox,
  videoPath: string,
  config: ClienteProfile["silencio"]
): Promise<SilenceSegment[]> {
  const cmd = `ffmpeg -hide_banner -i "${videoPath}" -af "silencedetect=noise=${config.umbral_db}dB:d=${config.duracion_minima_seg}" -f null - 2>&1`;
  const { stdout } = await runInSandbox(sandbox, cmd);

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

/**
 * Extract width, height, fps and duration via `ffmpeg -i`. Sin output ffmpeg
 * imprime la info por stderr (que `2>&1` redirige a stdout) y sale con 1, así
 * que mandamos `|| true` para no propagar el exit code.
 */
export async function extraerMetadata(
  sandbox: Sandbox,
  videoPath: string
): Promise<VideoMetadata> {
  const { stdout } = await runInSandbox(
    sandbox,
    `ffmpeg -hide_banner -i "${videoPath}" 2>&1 || true`
  );

  const sizeMatch = stdout.match(/(\d{2,5})x(\d{2,5})/);
  const fpsMatch = stdout.match(/(\d+(?:\.\d+)?)\s*(?:fps|tbr)/);
  const durationMatch = stdout.match(
    /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/
  );

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
