import type { SilenceSegment } from "@/types";

export interface VideoMetadata {
  width: number;
  height: number;
  fps: number;
  duracion: number;
}

export interface KeepSegment {
  start: number;
  end: number;
}

/**
 * Calculate "keep" segments from a list of silences and total duration.
 * Returns the inverse: portions of the video that are NOT silence.
 */
export function calcularKeepSegments(
  silencios: SilenceSegment[],
  duracionTotal: number
): KeepSegment[] {
  const segments: KeepSegment[] = [];
  const sorted = [...silencios].sort((a, b) => a.start - b.start);
  let currentStart = 0;

  for (const s of sorted) {
    if (s.start > currentStart) {
      segments.push({ start: currentStart, end: s.start });
    }
    currentStart = Math.max(currentStart, s.end);
  }

  if (currentStart < duracionTotal) {
    segments.push({ start: currentStart, end: duracionTotal });
  }

  return segments.filter((s) => s.end - s.start > 0.05);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate a Final Cut Pro 7 XML (xmeml v5) that Premiere Pro
 * can import via File → Import. The timeline contains one clipitem
 * per keep-segment, placed sequentially.
 */
export function generarPremiereXML(opts: {
  videoUrl: string;
  videoName: string;
  metadata: VideoMetadata;
  silencios: SilenceSegment[];
  sequenceName?: string;
}): { xml: string; segments: KeepSegment[] } {
  const { videoUrl, videoName, metadata, silencios } = opts;
  const { width, height, fps, duracion } = metadata;
  const seqName = opts.sequenceName ?? `${videoName}_sin_silencios`;

  const segments = calcularKeepSegments(silencios, duracion);
  const secsToFrames = (s: number) => Math.max(0, Math.round(s * fps));
  const sourceDurationFrames = secsToFrames(duracion);

  const fileName = escapeXml(videoName);
  const pathUrl = escapeXml(videoUrl);
  const sequenceNameXml = escapeXml(seqName);

  // Each segment is placed sequentially on the timeline.
  let timelinePos = 0;
  const videoClipitems: string[] = [];
  const audioLeftClipitems: string[] = [];
  const audioRightClipitems: string[] = [];

  segments.forEach((seg, idx) => {
    const inFrame = secsToFrames(seg.start);
    const outFrame = secsToFrames(seg.end);
    const segDuration = outFrame - inFrame;
    const start = timelinePos;
    const end = timelinePos + segDuration;
    timelinePos = end;

    const fileRef = idx === 0
      ? `<file id="file-source">
            <name>${fileName}</name>
            <pathurl>${pathUrl}</pathurl>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <duration>${sourceDurationFrames}</duration>
            <media>
              <video>
                <samplecharacteristics>
                  <width>${width}</width>
                  <height>${height}</height>
                </samplecharacteristics>
              </video>
              <audio>
                <samplecharacteristics>
                  <depth>16</depth>
                  <samplerate>48000</samplerate>
                </samplecharacteristics>
                <channelcount>2</channelcount>
              </audio>
            </media>
          </file>`
      : `<file id="file-source"/>`;

    videoClipitems.push(
      `<clipitem id="vclip-${idx}">
        <name>${fileName}</name>
        <enabled>TRUE</enabled>
        <duration>${sourceDurationFrames}</duration>
        <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
        <in>${inFrame}</in>
        <out>${outFrame}</out>
        <start>${start}</start>
        <end>${end}</end>
        ${fileRef}
        <sourcetrack>
          <mediatype>video</mediatype>
          <trackindex>1</trackindex>
        </sourcetrack>
      </clipitem>`
    );

    const audioFileRef = `<file id="file-source"/>`;

    audioLeftClipitems.push(
      `<clipitem id="aclip-l-${idx}">
        <name>${fileName}</name>
        <enabled>TRUE</enabled>
        <duration>${sourceDurationFrames}</duration>
        <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
        <in>${inFrame}</in>
        <out>${outFrame}</out>
        <start>${start}</start>
        <end>${end}</end>
        ${audioFileRef}
        <sourcetrack>
          <mediatype>audio</mediatype>
          <trackindex>1</trackindex>
        </sourcetrack>
      </clipitem>`
    );

    audioRightClipitems.push(
      `<clipitem id="aclip-r-${idx}">
        <name>${fileName}</name>
        <enabled>TRUE</enabled>
        <duration>${sourceDurationFrames}</duration>
        <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
        <in>${inFrame}</in>
        <out>${outFrame}</out>
        <start>${start}</start>
        <end>${end}</end>
        ${audioFileRef}
        <sourcetrack>
          <mediatype>audio</mediatype>
          <trackindex>2</trackindex>
        </sourcetrack>
      </clipitem>`
    );
  });

  const totalFrames = timelinePos;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>${sequenceNameXml}</name>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <in>-1</in>
    <out>-1</out>
    <timecode>
      <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
      <string>00:00:00:00</string>
      <frame>0</frame>
      <displayformat>NDF</displayformat>
    </timecode>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${width}</width>
            <height>${height}</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
          </samplecharacteristics>
        </format>
        <track>
          ${videoClipitems.join("\n          ")}
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
        </track>
      </video>
      <audio>
        <numOutputChannels>2</numOutputChannels>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>48000</samplerate>
          </samplecharacteristics>
        </format>
        <track>
          ${audioLeftClipitems.join("\n          ")}
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
        </track>
        <track>
          ${audioRightClipitems.join("\n          ")}
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>
`;

  return { xml, segments };
}
