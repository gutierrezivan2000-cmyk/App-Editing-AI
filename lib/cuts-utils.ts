import type { WordTimestamp } from "@/types";
import type { KeepSegment } from "@/lib/premiere-xml";

/**
 * Build an FFmpeg `filter_complex` command that takes the original video and
 * concatenates only the keep-segments (the inverse of Claude's cut list).
 * Result lands in `outputPath`. Uses libx264/aac for browser compatibility
 * with the Remotion render step that follows.
 */
export function buildFFmpegConcatCommand(
  inputPath: string,
  outputPath: string,
  keepSegments: KeepSegment[]
): string {
  if (keepSegments.length === 0) {
    throw new Error("No hay keep-segments para concatenar");
  }

  const filters: string[] = [];
  const concatInputs: string[] = [];

  keepSegments.forEach((seg, i) => {
    filters.push(
      `[0:v]trim=${seg.start.toFixed(3)}:${seg.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
    );
    filters.push(
      `[0:a]atrim=${seg.start.toFixed(3)}:${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
    );
    concatInputs.push(`[v${i}][a${i}]`);
  });

  filters.push(
    `${concatInputs.join("")}concat=n=${keepSegments.length}:v=1:a=1[outv][outa]`
  );

  const filterComplex = filters.join(";");

  return `ffmpeg -y -i "${inputPath}" -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k "${outputPath}"`;
}

/**
 * Given the original transcription and the list of cuts the AI decided to
 * remove, return a new transcription whose timestamps refer to the EDITED
 * video. Words that fell inside a cut are dropped; surviving words are
 * shifted back by the total duration of cuts that happened before them.
 */
export function ajustarTranscripcionTrasCortes(
  words: WordTimestamp[],
  cortes: Array<{ start: number; end: number }>
): WordTimestamp[] {
  if (cortes.length === 0) return words;

  const sorted = [...cortes].sort((a, b) => a.start - b.start);

  return words
    .filter((w) => {
      // Drop the word if its midpoint falls inside any cut. Mid-point avoids
      // edge flicker when a word starts within the silence buffer.
      const mid = (w.start + w.end) / 2;
      return !sorted.some((c) => mid >= c.start && mid <= c.end);
    })
    .map((w) => {
      const delay = sorted
        .filter((c) => c.end <= w.start)
        .reduce((acc, c) => acc + (c.end - c.start), 0);
      return {
        ...w,
        start: Math.max(0, w.start - delay),
        end: Math.max(0, w.end - delay),
      };
    });
}
