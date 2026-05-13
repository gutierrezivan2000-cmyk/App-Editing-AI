import type { SilenceSegment } from "@/types";
import { calcularKeepSegments, type KeepSegment, type VideoMetadata } from "./premiere-xml";

export type { KeepSegment };

/**
 * Convert total seconds to SMPTE timecode string: HH:MM:SS:FF
 */
function secToTimecode(secs: number, fps: number): string {
  const totalFrames = Math.round(secs * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
    String(frames).padStart(2, "0"),
  ].join(":");
}

/**
 * Generate a CMX 3600 EDL (Edit Decision List) for DaVinci Resolve.
 *
 * Each kept segment becomes one event with V+A tracks.
 * DaVinci Resolve imports EDL via File → Import Timeline → Import EDL.
 * After import, relink the media to the original footage URL.
 *
 * EDL line format:
 *   EVENT  REEL  CHANNEL  TRANSITION  SRC_IN  SRC_OUT  REC_IN  REC_OUT
 */
export function generarDaVinciEDL(opts: {
  videoUrl: string;
  videoName: string;
  metadata: VideoMetadata;
  silencios: SilenceSegment[];
  sequenceName?: string;
}): { edl: string; segments: KeepSegment[] } {
  const { videoUrl, videoName, metadata, silencios } = opts;
  const { fps, duracion } = metadata;
  const seqName = opts.sequenceName ?? `${videoName}_sin_silencios`;
  const reelName = videoName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 8).toUpperCase() || "AX";

  const segments = calcularKeepSegments(silencios, duracion);

  let recordPos = 0;
  const lines: string[] = [];

  lines.push(`TITLE: ${seqName}`);
  lines.push(`FCM: NON-DROP FRAME`);
  lines.push(`* SOURCE URL: ${videoUrl}`);
  lines.push("");

  segments.forEach((seg, idx) => {
    const eventNum = String(idx + 1).padStart(3, "0");
    const srcIn = secToTimecode(seg.start, fps);
    const srcOut = secToTimecode(seg.end, fps);
    const recIn = secToTimecode(recordPos, fps);
    const segDuration = seg.end - seg.start;
    const recOut = secToTimecode(recordPos + segDuration, fps);
    recordPos += segDuration;

    // Video track
    lines.push(`${eventNum}  ${reelName}  V  C  ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    // Audio channel 1
    lines.push(`${eventNum}  ${reelName}  A  C  ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    // Audio channel 2
    lines.push(`${eventNum}  ${reelName}  A2 C  ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`* FROM CLIP NAME: ${videoName}`);
    lines.push("");
  });

  return { edl: lines.join("\n"), segments };
}
