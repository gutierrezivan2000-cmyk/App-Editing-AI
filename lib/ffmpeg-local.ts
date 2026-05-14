/**
 * Wrapper directo sobre ffmpeg-static usando child_process.spawn.
 *
 * Decisiones (basadas en errores anteriores):
 * - NO usar @vercel/sandbox (root, apt-get, paths, $@ wrapper bugs).
 * - NO depender de Remotion (bundle path issues).
 * - Llamar al binario de ffmpeg-static directamente desde Node.js.
 * - Trabajar siempre en /tmp (único filesystem escribible en Vercel).
 * - Re-encode en cut+concat (reliable, sin issues de keyframes).
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// ffmpeg-static exporta la ruta absoluta al binario embebido.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string | null = require("ffmpeg-static");

if (!ffmpegPath) {
  // Detectado al import; falla fuerte si el package no fue instalado.
  throw new Error(
    "ffmpeg-static no expone una ruta. Verifica `npm install ffmpeg-static`."
  );
}

export const FFMPEG_BIN = ffmpegPath;

export interface SilenceRange {
  start: number;
  end: number;
  duracion: number;
}

export interface KeepSegment {
  start: number;
  end: number;
  duracion: number;
}

export interface VideoMeta {
  duracion: number; // segundos
  width: number;
  height: number;
  fps: number;
}

export interface FFResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Ejecuta ffmpeg con los args dados, captura stdout y stderr completos.
 * Para procesos potencialmente largos (cut+concat de varios minutos), ffmpeg
 * imprime continuamente en stderr — guardamos todo en buffer de strings.
 */
export function runFFmpeg(args: string[], timeoutMs = 280_000): Promise<FFResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));

    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg timeout (>${timeoutMs}ms): ${args.slice(0, 6).join(" ")}…`));
    }, timeoutMs);

    child.on("error", (e) => {
      clearTimeout(killer);
      reject(e);
    });

    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        exitCode: code ?? -1,
      });
    });
  });
}

/**
 * Descarga un archivo remoto a un path local usando fetch + streaming a disco.
 * No usa curl ni sandbox; soporta archivos grandes sin cargar todo a memoria.
 */
export async function descargarA(url: string, destPath: string): Promise<void> {
  const dir = path.dirname(destPath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Descarga fallida ${res.status}: ${url.slice(0, 80)}`);
  }
  if (!res.body) {
    throw new Error("Respuesta sin body al descargar el video");
  }

  // res.body es ReadableStream<Uint8Array> (web API). Lo convertimos a node stream
  // para hacer pipeline a disco sin cargar el archivo entero en memoria.
  const nodeReadable = Readable.fromWeb(
    res.body as Parameters<typeof Readable.fromWeb>[0]
  );
  await pipeline(nodeReadable, createWriteStream(destPath));
}

/**
 * Extrae duración, dimensiones y fps con un solo `ffmpeg -i`.
 * ffmpeg sin output sale con código 1 pero imprime metadata por stderr.
 */
export async function extraerMetadata(inputPath: string): Promise<VideoMeta> {
  const { stderr } = await runFFmpeg(["-hide_banner", "-i", inputPath], 30_000);

  const sizeMatch = stderr.match(/(\d{2,5})x(\d{2,5})/);
  const fpsMatch = stderr.match(/(\d+(?:\.\d+)?)\s*(?:fps|tbr)/);
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);

  const width = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
  const height = sizeMatch ? parseInt(sizeMatch[2], 10) : 0;
  const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 30;

  let duracion = 0;
  if (durationMatch) {
    duracion =
      parseInt(durationMatch[1], 10) * 3600 +
      parseInt(durationMatch[2], 10) * 60 +
      parseFloat(durationMatch[3]);
  }

  if (duracion <= 0) {
    throw new Error(
      `No se pudo extraer la duración. Stderr (últimas 300 chars): ${stderr.slice(-300)}`
    );
  }

  return {
    duracion,
    width: width || 1920,
    height: height || 1080,
    fps: fps > 0 ? fps : 30,
  };
}

/**
 * Detecta silencios usando `silencedetect`. Aplica margen para evitar cortar
 * el comienzo/fin de palabras adyacentes al silencio.
 */
export async function detectarSilencios(
  inputPath: string,
  opts: { umbralDb: number; duracionMinima: number; margenSeg: number }
): Promise<SilenceRange[]> {
  const { stderr } = await runFFmpeg(
    [
      "-hide_banner",
      "-nostats",
      "-i",
      inputPath,
      "-af",
      `silencedetect=noise=${opts.umbralDb}dB:d=${opts.duracionMinima}`,
      "-f",
      "null",
      "-",
    ],
    180_000
  );

  const startMatches = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)];
  const endMatches = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)];

  const ranges: SilenceRange[] = [];
  for (let i = 0; i < startMatches.length; i++) {
    const startRaw = parseFloat(startMatches[i][1]);
    const endMatch = endMatches[i];
    if (!endMatch) continue;
    const endRaw = parseFloat(endMatch[1]);

    // Aplica margen: encogemos el rango de silencio para conservar un colchón
    // antes/después y evitar cortar consonantes adyacentes.
    const start = startRaw + opts.margenSeg;
    const end = endRaw - opts.margenSeg;
    if (end > start) ranges.push({ start, end, duracion: end - start });
  }

  return ranges;
}

/**
 * Convierte silencios → segmentos a conservar (complemento sobre [0, total]).
 */
export function calcularKeepSegments(
  silencios: SilenceRange[],
  total: number,
  minSegLen = 0.05
): KeepSegment[] {
  const ordered = [...silencios].sort((a, b) => a.start - b.start);
  const keeps: KeepSegment[] = [];
  let cursor = 0;

  for (const s of ordered) {
    if (s.start > cursor + minSegLen) {
      keeps.push({
        start: cursor,
        end: s.start,
        duracion: s.start - cursor,
      });
    }
    cursor = Math.max(cursor, s.end);
  }
  if (total > cursor + minSegLen) {
    keeps.push({ start: cursor, end: total, duracion: total - cursor });
  }
  return keeps;
}

/**
 * Corta y concatena en un solo paso usando filter_complex con concat filter.
 *
 * Estrategia: para cada keep-segment generamos pares trim/atrim, luego un
 * filtro concat los une en un único stream a/v. Re-encodea (libx264 + aac)
 * para garantizar un MP4 válido sin importar el codec del input.
 *
 * Esto es más lento que stream-copy pero infinitamente más confiable —
 * stream-copy depende de keyframes alineados y suele dar artefactos.
 */
export async function cortarYMontar(
  inputPath: string,
  outputPath: string,
  keeps: KeepSegment[]
): Promise<void> {
  if (keeps.length === 0) {
    throw new Error("No hay segmentos a conservar (todo el audio es silencio?).");
  }

  // Construye el filter_complex string. Para cada segmento N:
  //   [0:v]trim=start=S:end=E,setpts=PTS-STARTPTS[vN];
  //   [0:a]atrim=start=S:end=E,asetpts=PTS-STARTPTS[aN];
  // Final: [v0][a0][v1][a1]...concat=n=N:v=1:a=1[outv][outa]
  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < keeps.length; i++) {
    const { start, end } = keeps[i];
    filterParts.push(
      `[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
    );
    filterParts.push(
      `[0:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
    );
    concatInputs.push(`[v${i}][a${i}]`);
  }
  filterParts.push(
    `${concatInputs.join("")}concat=n=${keeps.length}:v=1:a=1[outv][outa]`
  );

  const filterComplex = filterParts.join(";");

  const args = [
    "-hide_banner",
    "-nostats",
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  const { exitCode, stderr } = await runFFmpeg(args, 280_000);
  if (exitCode !== 0) {
    throw new Error(
      `ffmpeg cut+concat falló (exit ${exitCode}). Stderr: ${stderr.slice(-500)}`
    );
  }

  if (!existsSync(outputPath)) {
    throw new Error("ffmpeg terminó OK pero el output no existe");
  }
}

/**
 * Limpia archivos temporales. Silencioso si no existen.
 */
export async function limpiarTemp(...paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      if (existsSync(p)) await rm(p, { force: true });
    } catch {
      // Ignorar — best-effort cleanup.
    }
  }
}
