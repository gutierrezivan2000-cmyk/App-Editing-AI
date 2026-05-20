import type { SnippetPlan, WordTimestamp } from "@/types";

/**
 * Build an FFmpeg command that takes N input clips and produces a single
 * concatenated video composed of the snippets in the order the AI decided.
 *
 * IMPORTANTE: cuando los clips tienen distintas dimensiones / SAR / sample
 * rate, `concat` falla — o peor, ffmpeg se descontrola y el kernel lo mata
 * con SIGKILL (exit 137 = OOM). Por eso cada snippet se uniformiza al canvas
 * antes del concat: scale → pad → setsar → fps en el video; aresample →
 * aformat en el audio. El canvas por defecto es 1080×1920 (vertical, formato
 * shorts / reels).
 */
export interface MulticlipCommandOptions {
  /** Ancho del canvas final. Default 1080. */
  canvasWidth?: number;
  /** Alto del canvas final. Default 1920. */
  canvasHeight?: number;
  /** fps target del output. Default 30. */
  fps?: number;
  /** Preset libx264. `ultrafast` es lo más conservador en RAM. */
  preset?:
    | "ultrafast"
    | "superfast"
    | "veryfast"
    | "faster"
    | "fast"
    | "medium";
}

/**
 * Two-pass concat builder. Para cada snippet genera un ffmpeg individual que
 * recorta + uniformiza + re-encodifica solo ese snippet a un segment_N.mp4.
 * Luego un último ffmpeg con concat demuxer (sin re-encode) une los segments.
 *
 * Comparado con el filter_complex monolítico, este enfoque:
 *  - Usa solo 1 input por proceso → memoria predecible y baja
 *  - Es robusto a OOM aunque haya 20 clips
 *  - El concat final es trivial (~1s, sin re-encode)
 *
 * El listado devuelto debe ejecutarse en orden con `ejecutarFFmpegCommands`.
 */
export function buildFFmpegMulticlipCommands(
  inputPaths: string[],
  outputPath: string,
  snippets: SnippetPlan[],
  segmentDir: string,
  listFilePath: string,
  options: MulticlipCommandOptions = {}
): string[] {
  if (snippets.length === 0) {
    throw new Error("No hay snippets para concatenar");
  }
  if (inputPaths.length === 0) {
    throw new Error("No hay inputs para ffmpeg");
  }

  const W = options.canvasWidth ?? 1080;
  const H = options.canvasHeight ?? 1920;
  const fps = options.fps ?? 30;
  const preset = options.preset ?? "ultrafast";

  const commands: string[] = [];

  // Pass 1: recortar + uniformizar cada snippet a un segment individual.
  // Aplicamos un micro-fade de audio (in + out) de 30ms en cada segmento
  // para evitar el "click" caracteristico que aparece cuando concatenamos
  // dos clips audio con cortes secos. Es imperceptible auditivamente pero
  // limpia los artefactos. NO aplicamos fade de video (generaria fade-to-
  // black antiestetico, queremos hard cuts visuales).
  snippets.forEach((s, i) => {
    const src = s.clipIndex;
    if (src < 0 || src >= inputPaths.length) {
      throw new Error(`Snippet ${i} apunta a clipIndex ${src} fuera de rango`);
    }
    const input = inputPaths[src];
    const seg = `${segmentDir}/seg_${String(i).padStart(3, "0")}.mp4`;
    const dur = s.end - s.start;
    const durStr = dur.toFixed(3);
    // Fades de 30ms — la salida del fade-out empieza en (dur - 0.03).
    const fadeOutStart = Math.max(0, dur - 0.03).toFixed(3);
    commands.push(
      `ffmpeg -y -ss ${s.start.toFixed(3)} -t ${durStr} -i "${input}" ` +
        `-vf "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}" ` +
        `-af "afade=t=in:st=0:d=0.03,afade=t=out:st=${fadeOutStart}:d=0.03,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo" ` +
        `-c:v libx264 -preset ${preset} -crf 23 -pix_fmt yuv420p ` +
        `-c:a aac -b:a 128k -ar 48000 -ac 2 ` +
        `-threads 2 -movflags +faststart "${seg}"`
    );
  });

  // Generar el archivo lista del concat demuxer con `printf "%s\n"` que
  // repite el format por cada argumento. Evita problemas de quoting con
  // comillas anidadas que rompen `printf '...'`.
  const listArgs = snippets
    .map(
      (_, i) =>
        `"file '${segmentDir}/seg_${String(i).padStart(3, "0")}.mp4'"`
    )
    .join(" ");
  commands.push(`printf "%s\\n" ${listArgs} > "${listFilePath}"`);

  // Pass 2: concat sin re-encode (rapidísimo, RAM mínima).
  commands.push(
    `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy -movflags +faststart "${outputPath}"`
  );

  return commands;
}

/**
 * @deprecated — la versión monolítica con filter_complex se descontrola en
 * sandbox cuando hay muchos clips o dimensiones mixtas. Usa
 * buildFFmpegMulticlipCommands (two-pass) en su lugar.
 */
export function buildFFmpegMulticlipCommand(
  inputPaths: string[],
  outputPath: string,
  snippets: SnippetPlan[],
  options: MulticlipCommandOptions = {}
): string {
  if (snippets.length === 0) {
    throw new Error("No hay snippets para concatenar");
  }
  if (inputPaths.length === 0) {
    throw new Error("No hay inputs para ffmpeg");
  }

  const W = options.canvasWidth ?? 1080;
  const H = options.canvasHeight ?? 1920;
  const fps = options.fps ?? 30;
  const preset = options.preset ?? "ultrafast";

  const inputs = inputPaths.map((p) => `-i "${p}"`).join(" ");

  const filters: string[] = [];
  const concatRefs: string[] = [];

  snippets.forEach((s, i) => {
    const src = s.clipIndex;
    if (src < 0 || src >= inputPaths.length) {
      throw new Error(`Snippet ${i} apunta a clipIndex ${src} fuera de rango`);
    }
    // Video: trim → reset PTS → scale conservando aspect ratio → pad al canvas
    // → forzar SAR=1 → fps target. Sin esto, mixed orientation (1920x1080 +
    // 1080x1920) explota con OOM.
    filters.push(
      `[${src}:v]trim=${s.start.toFixed(3)}:${s.end.toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}[v${i}]`
    );
    // Audio: trim → reset PTS → resamplear a 48 kHz → forzar stereo s16.
    filters.push(
      `[${src}:a]atrim=${s.start.toFixed(3)}:${s.end.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo[a${i}]`
    );
    concatRefs.push(`[v${i}][a${i}]`);
  });

  filters.push(
    `${concatRefs.join("")}concat=n=${snippets.length}:v=1:a=1[outv][outa]`
  );

  // `-threads 2` limita el paralelismo a 2 hilos por encoder para reducir el
  // pico de RAM. Con `vcpus: 4` del sandbox tenemos margen suficiente.
  return `ffmpeg -y ${inputs} -filter_complex "${filters.join(";")}" -map "[outv]" -map "[outa]" -c:v libx264 -preset ${preset} -crf 23 -threads 2 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;
}

/**
 * Given the per-clip transcriptions and the snippet plan, return a single
 * unified transcription whose timestamps refer to the FINAL concatenated
 * video (snippet order). For each snippet:
 *   - take the words inside [s.start, s.end] of its clip
 *   - shift them so they land at the timeline position the snippet occupies
 *
 * `clipTranscriptions[i]` corresponds to the clip at original index `i`.
 */
export function unirTranscripcionesMulticlip(
  clipTranscriptions: WordTimestamp[][],
  snippets: SnippetPlan[]
): WordTimestamp[] {
  const out: WordTimestamp[] = [];
  let timelinePos = 0;

  for (const s of snippets) {
    const words = clipTranscriptions[s.clipIndex] ?? [];
    const snippetDur = s.end - s.start;
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      // Mid-point inside the snippet range → include this word.
      if (mid < s.start || mid > s.end) continue;
      const localStart = Math.max(0, w.start - s.start);
      const localEnd = Math.min(snippetDur, w.end - s.start);
      if (localEnd <= localStart) continue;
      out.push({
        ...w,
        start: timelinePos + localStart,
        end: timelinePos + localEnd,
      });
    }
    timelinePos += snippetDur;
  }

  return out;
}

/**
 * Compute the total duration (in seconds) of the final video given the snippet
 * plan. Equivalent to the sum of (end - start) across all snippets.
 */
export function calcularDuracionFinal(snippets: SnippetPlan[]): number {
  return snippets.reduce((acc, s) => acc + (s.end - s.start), 0);
}

/**
 * Sanitize a filename so it's safe to put inside a ZIP (CapCut + cross-OS).
 * Lowercases nothing — preserves case for the user's original naming intent.
 */
export function sanitizeClipFilename(name: string, idx: number): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
  const prefix = String(idx + 1).padStart(2, "0");
  return `${prefix}_${cleaned || `clip_${idx + 1}`}`;
}
