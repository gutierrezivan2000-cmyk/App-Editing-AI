import { randomUUID } from "node:crypto";
import type {
  ClienteProfile,
  ClipMultiSource,
  SnippetPlan,
  WordTimestamp,
} from "@/types";
import type { VideoMetadata } from "./premiere-xml";

type ConfigSubtitulos = ClienteProfile["subtitulos"];

interface SubtitulosCapCut {
  transcripcion: WordTimestamp[];
  config: ConfigSubtitulos;
}

export interface ClipForExport {
  /** original 0-based index — what snippets reference. */
  index: number;
  /** display name (filename) */
  name: string;
  /** URL en Blob (no se mete en project files, pero útil para tooling) */
  url: string;
  metadata: VideoMetadata;
  /** local filename to emit in pathurl / path fields */
  localFilename: string;
}

// ───────────────────────────────────────────────────────────────
// Validación común — todos los exports requieren que cada snippet apunte a
// un clip presente en `clips[]`. Si el plan referencia un clipIndex que ya
// no existe (clip removido pero plan no regenerado), tiene que romper rápido
// con un mensaje claro — no caer adentro de CapCut/Premiere como "material
// not found" hace una hora después.
// ───────────────────────────────────────────────────────────────

function validateSnippetClipRefs(
  clips: ClipForExport[],
  snippets: SnippetPlan[]
): void {
  if (clips.length === 0) {
    throw new Error("generar*Multiclip: clips[] vacío");
  }
  if (snippets.length === 0) {
    throw new Error("generar*Multiclip: snippets[] vacío");
  }
  const indices = new Set(clips.map((c) => c.index));
  snippets.forEach((s, i) => {
    if (!indices.has(s.clipIndex)) {
      throw new Error(
        `Snippet ${i} apunta a clipIndex ${s.clipIndex} que no existe en ` +
          `clips[]. Indices disponibles: [${[...indices].join(", ")}]. ` +
          `Probable causa: un clip fue removido pero el plan no se regeneró.`
      );
    }
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) {
      throw new Error(
        `Snippet ${i}: start/end no son numéricos (start=${s.start}, end=${s.end})`
      );
    }
    if (s.end <= s.start) {
      throw new Error(
        `Snippet ${i}: end (${s.end}) debe ser > start (${s.start})`
      );
    }
  });
}

// ───────────────────────────────────────────────────────────────
// XML Premiere multiclip — N <file id="file-source-K"> y N clipitems
// ───────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generarPremiereXMLMulticlip(opts: {
  videoName: string;
  clips: ClipForExport[];
  snippets: SnippetPlan[];
  sequenceName?: string;
  /** Subtitulos a embeber como title clips en V2. Opcional. */
  subtitulos?: {
    transcripcion: WordTimestamp[];
    config: ConfigSubtitulos;
  };
}): { xml: string } {
  const { videoName, clips, snippets, subtitulos } = opts;
  validateSnippetClipRefs(clips, snippets);
  const seqName = opts.sequenceName ?? `${videoName}_unido`;

  // Pick the canonical fps/dimensions from the first clip — the user is
  // expected to be working with consistent specs across clips. fps a entero
  // porque `<timebase>` no acepta floats; NTSC (29.97) se redondea a 30.
  const baseFps = Math.max(1, Math.round(clips[0]?.metadata.fps ?? 30));
  const baseWidth = clips[0]?.metadata.width ?? 1920;
  const baseHeight = clips[0]?.metadata.height ?? 1080;
  const secsToFrames = (s: number) => Math.max(0, Math.round(s * baseFps));

  // Emit one <file> per clip with full metadata; later references can be by id.
  const filesAlreadyEmitted = new Set<number>();
  const fileXmlFor = (clipIdx: number, idx: number): string => {
    const c = clips[clipIdx];
    if (!c) return `<file id="file-source-${clipIdx}"/>`;
    if (filesAlreadyEmitted.has(clipIdx)) {
      return `<file id="file-source-${clipIdx}"/>`;
    }
    filesAlreadyEmitted.add(clipIdx);
    const pathUrl = escapeXml(`file://localhost/${encodeURI(c.localFilename)}`);
    const fileName = escapeXml(c.name);
    const durFrames = Math.round(c.metadata.duracion * baseFps);
    return `<file id="file-source-${clipIdx}">
            <name>${fileName}</name>
            <pathurl>${pathUrl}</pathurl>
            <rate><timebase>${baseFps}</timebase><ntsc>FALSE</ntsc></rate>
            <duration>${durFrames}</duration>
            <media>
              <video>
                <samplecharacteristics>
                  <width>${c.metadata.width}</width>
                  <height>${c.metadata.height}</height>
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
          </file>`;
    void idx;
  };

  let timelinePos = 0;
  const videoClipitems: string[] = [];
  const audioLeftClipitems: string[] = [];
  const audioRightClipitems: string[] = [];

  snippets.forEach((s, idx) => {
    const inFrame = secsToFrames(s.start);
    const outFrame = secsToFrames(s.end);
    const segDur = outFrame - inFrame;
    const start = timelinePos;
    const end = timelinePos + segDur;
    timelinePos = end;

    const fileXml = fileXmlFor(s.clipIndex, idx);
    const fileBare = `<file id="file-source-${s.clipIndex}"/>`;
    const clipName = escapeXml(clips[s.clipIndex]?.name ?? `clip_${s.clipIndex}`);

    videoClipitems.push(
      `<clipitem id="vclip-${idx}">
        <name>${clipName}</name>
        <enabled>TRUE</enabled>
        <duration>${segDur}</duration>
        <rate><timebase>${baseFps}</timebase><ntsc>FALSE</ntsc></rate>
        <in>${inFrame}</in>
        <out>${outFrame}</out>
        <start>${start}</start>
        <end>${end}</end>
        ${fileXml}
        <sourcetrack>
          <mediatype>video</mediatype>
          <trackindex>1</trackindex>
        </sourcetrack>
      </clipitem>`
    );

    audioLeftClipitems.push(
      `<clipitem id="aclip-l-${idx}">
        <name>${clipName}</name>
        <enabled>TRUE</enabled>
        <duration>${segDur}</duration>
        <rate><timebase>${baseFps}</timebase><ntsc>FALSE</ntsc></rate>
        <in>${inFrame}</in>
        <out>${outFrame}</out>
        <start>${start}</start>
        <end>${end}</end>
        ${fileBare}
        <sourcetrack>
          <mediatype>audio</mediatype>
          <trackindex>1</trackindex>
        </sourcetrack>
      </clipitem>`
    );

    audioRightClipitems.push(
      `<clipitem id="aclip-r-${idx}">
        <name>${clipName}</name>
        <enabled>TRUE</enabled>
        <duration>${segDur}</duration>
        <rate><timebase>${baseFps}</timebase><ntsc>FALSE</ntsc></rate>
        <in>${inFrame}</in>
        <out>${outFrame}</out>
        <start>${start}</start>
        <end>${end}</end>
        ${fileBare}
        <sourcetrack>
          <mediatype>audio</mediatype>
          <trackindex>2</trackindex>
        </sourcetrack>
      </clipitem>`
    );
  });

  const totalFrames = timelinePos;
  const sequenceNameXml = escapeXml(seqName);

  // ─── Title clips de subtítulos (V2, encima del video principal) ───
  // Premiere Pro entiende `<generatoritem>` con effect "Basic Title".
  // Agregamos uno por linea de subtitulo. Premiere los importa como
  // titles editables — el editor puede cambiar tipografia, color,
  // posicion desde el panel Essential Graphics.
  const subtitleClipitems: string[] = [];
  if (subtitulos && subtitulos.transcripcion.length > 0) {
    const { transcripcion, config } = subtitulos;
    const perLine = Math.max(1, config.palabras_por_linea || 4);
    const lines: WordTimestamp[][] = [];
    for (let i = 0; i < transcripcion.length; i += perLine) {
      lines.push(transcripcion.slice(i, i + perLine));
    }
    // Mapear posicion del cliente a Y en pixels (relativo al canvas).
    // bottom-center → cerca del bottom; top-center → cerca del top.
    const yByPosition: Record<ConfigSubtitulos["posicion"], number> = {
      "bottom-center": Math.round(baseHeight * 0.85),
      "top-center": Math.round(baseHeight * 0.15),
      center: Math.round(baseHeight * 0.5),
    };
    const yPos = yByPosition[config.posicion] ?? Math.round(baseHeight * 0.85);
    lines.forEach((line, idx) => {
      const text = escapeXml(line.map((w) => w.texto).join(" ").trim());
      if (!text) return;
      const startSec = line[0].start;
      const endSec = line[line.length - 1].end + 0.1;
      const inFrame = secsToFrames(startSec);
      const outFrame = secsToFrames(endSec);
      const durSub = outFrame - inFrame;
      if (durSub <= 0) return;
      const fontName = escapeXml(config.fuente_principal || "Arial");
      const fontSize = Math.max(24, Math.min(120, config.tamano_base));
      // Premiere usa "Basic Title" generator effect. Los parametros viven
      // dentro de un <effect> hijo con id "basic title" y parameters por
      // nombre (str, fontsize, alignment, etc). No todos los Premiere
      // respetan TODOS los params — pero el texto y el timing si llegan.
      subtitleClipitems.push(
        `<clipitem id="sub-${idx}">
          <name>${text.slice(0, 32)}</name>
          <enabled>TRUE</enabled>
          <duration>${durSub}</duration>
          <rate><timebase>${baseFps}</timebase><ntsc>FALSE</ntsc></rate>
          <in>0</in>
          <out>${durSub}</out>
          <start>${inFrame}</start>
          <end>${outFrame}</end>
          <generatoritem>
            <name>Basic Title</name>
            <rate><timebase>${baseFps}</timebase><ntsc>FALSE</ntsc></rate>
            <effect>
              <name>Basic Title</name>
              <effectid>Text</effectid>
              <effectcategory>Text</effectcategory>
              <effecttype>generator</effecttype>
              <mediatype>video</mediatype>
              <parameter authoringApp="PremierePro">
                <parameterid>str</parameterid>
                <name>Text</name>
                <value>${text}</value>
              </parameter>
              <parameter>
                <parameterid>fontname</parameterid>
                <name>Font</name>
                <value>${fontName}</value>
              </parameter>
              <parameter>
                <parameterid>fontsize</parameterid>
                <name>Font Size</name>
                <value>${fontSize}</value>
              </parameter>
              <parameter>
                <parameterid>fontstyle</parameterid>
                <name>Font Style</name>
                <value>1</value>
              </parameter>
              <parameter>
                <parameterid>alignment</parameterid>
                <name>Alignment</name>
                <value>1</value>
              </parameter>
              <parameter>
                <parameterid>origin</parameterid>
                <name>Origin</name>
                <value>
                  <horiz>0</horiz>
                  <vert>${yPos - Math.round(baseHeight / 2)}</vert>
                </value>
              </parameter>
            </effect>
          </generatoritem>
        </clipitem>`,
      );
    });
  }

  // Si hay subtitulos, agregamos una segunda track de video (V2) encima.
  const subtitleTrackXml =
    subtitleClipitems.length > 0
      ? `
        <track>
          ${subtitleClipitems.join("\n          ")}
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
        </track>`
      : "";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>${sequenceNameXml}</name>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${baseFps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <in>-1</in>
    <out>-1</out>
    <timecode>
      <rate><timebase>${baseFps}</timebase><ntsc>FALSE</ntsc></rate>
      <string>00:00:00:00</string>
      <frame>0</frame>
      <displayformat>NDF</displayformat>
    </timecode>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${baseWidth}</width>
            <height>${baseHeight}</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
            <rate><timebase>${baseFps}</timebase><ntsc>FALSE</ntsc></rate>
          </samplecharacteristics>
        </format>
        <track>
          ${videoClipitems.join("\n          ")}
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
        </track>${subtitleTrackXml}
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

  return { xml };
}

// ───────────────────────────────────────────────────────────────
// EDL DaVinci multiclip — un reel por clip
// ───────────────────────────────────────────────────────────────

/**
 * SMPTE timecode HH:MM:SS:FF. fps debe redondearse a entero — NTSC (29.97,
 * 59.94, 23.976) produce floats en el modulo que rompen el padStart. Ver
 * comentario en `lib/davinci-edl.ts` para la justificación completa.
 */
function secToTimecode(secs: number, fps: number): string {
  const intFps = Math.max(1, Math.round(fps));
  const totalFrames = Math.round(secs * intFps);
  const frames = totalFrames % intFps;
  const totalSeconds = Math.floor(totalFrames / intFps);
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

function buildReelName(name: string, idx: number): string {
  const clean = name.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  if (clean.length >= 4) return clean.slice(0, 8);
  return `CLIP${String(idx + 1).padStart(2, "0")}`;
}

export function generarDaVinciEDLMulticlip(opts: {
  videoName: string;
  clips: ClipForExport[];
  snippets: SnippetPlan[];
  sequenceName?: string;
}): { edl: string } {
  const { videoName, clips, snippets } = opts;
  validateSnippetClipRefs(clips, snippets);
  const seqName = opts.sequenceName ?? `${videoName}_unido`;
  // EDL CMX 3600 requiere fps entero; NTSC (29.97) -> 30.
  const baseFps = Math.max(1, Math.round(clips[0]?.metadata.fps ?? 30));

  const reelByClip = new Map<number, string>();
  clips.forEach((c) => {
    reelByClip.set(c.index, buildReelName(c.name, c.index));
  });

  const lines: string[] = [];
  lines.push(`TITLE: ${seqName}`);
  lines.push(`FCM: NON-DROP FRAME`);
  for (const c of clips) {
    lines.push(`* CLIP ${reelByClip.get(c.index)}: ${c.name}`);
  }
  lines.push("");

  let recordPos = 0;
  snippets.forEach((s, i) => {
    const eventNum = String(i + 1).padStart(3, "0");
    const reel = reelByClip.get(s.clipIndex) ?? "AX";
    const srcIn = secToTimecode(s.start, baseFps);
    const srcOut = secToTimecode(s.end, baseFps);
    const recIn = secToTimecode(recordPos, baseFps);
    const segDur = s.end - s.start;
    const recOut = secToTimecode(recordPos + segDur, baseFps);
    recordPos += segDur;

    lines.push(`${eventNum}  ${reel}  V  C  ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`${eventNum}  ${reel}  A  C  ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`${eventNum}  ${reel}  A2 C  ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    const clipName = clips[s.clipIndex]?.name ?? `clip_${s.clipIndex}`;
    lines.push(`* FROM CLIP NAME: ${clipName}`);
    if (s.razon) lines.push(`* REASON: ${s.razon}`);
    lines.push("");
  });

  return { edl: lines.join("\n") };
}

// ───────────────────────────────────────────────────────────────
// CapCut multiclip — N entries en materials.videos / .audios y un track con segments
// ───────────────────────────────────────────────────────────────

function hexToRgbFloat(hex: string): number[] {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [1.0, 1.0, 1.0];
  return [
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255,
  ];
}

export function generarCapCutDraftMulticlip(opts: {
  videoName: string;
  clips: ClipForExport[];
  snippets: SnippetPlan[];
  subtitulos?: SubtitulosCapCut;
}): { draftJson: string; metaJson: string } {
  const { videoName, clips, snippets, subtitulos } = opts;
  validateSnippetClipRefs(clips, snippets);
  // CapCut espera fps entero; NTSC (29.97) -> 30.
  const baseFps = Math.max(1, Math.round(clips[0]?.metadata.fps ?? 30));
  const baseWidth = clips[0]?.metadata.width ?? 1920;
  const baseHeight = clips[0]?.metadata.height ?? 1080;

  const secToMicro = (s: number) => Math.round(s * 1_000_000);

  const draftId = randomUUID();
  const videoTrackId = randomUUID();
  const speedId = randomUUID();
  const soundChannelId = randomUUID();
  const vocalSeparationId = randomUUID();
  const canvasId = randomUUID();

  const nowUs = Date.now() * 1000;

  // Per-clip material id — UN solo material por clip (type "video" con
  // has_audio: true). Antes generabamos un material "extract_music"
  // adicional + un track de audio separado por snippet, lo que hacia
  // que CapCut reproduzca el audio DOS veces (una desde el video y
  // otra desde el extract_music del MISMO archivo). Eliminamos el
  // track de audio separado para evitar el doble audio; si el usuario
  // necesita editar el audio independientemente, puede usar "Separate
  // audio" dentro de CapCut.
  const videoMatIdByClip = new Map<number, string>();
  clips.forEach((c) => {
    videoMatIdByClip.set(c.index, randomUUID());
  });

  const videoSegments: Record<string, unknown>[] = [];

  let targetPos = 0;
  snippets.forEach((s, idx) => {
    const srcStart = secToMicro(s.start);
    const srcDur = secToMicro(s.end - s.start);
    const targetStart = targetPos;
    targetPos += srcDur;

    videoSegments.push({
      cartoon: false,
      clip: {
        alpha: 1.0,
        flip: { horizontal: false, vertical: false },
        rotation: 0.0,
        scale: { x: 1.0, y: 1.0 },
        transform: { x: 0.0, y: 0.0 },
      },
      common_keyframes: [],
      enable_adjust: true,
      enable_color_curves: true,
      enable_color_wheels: true,
      enable_lut: true,
      enable_smart_color_adjust: false,
      extra_material_refs: [speedId, canvasId, soundChannelId, vocalSeparationId],
      group_id: "",
      hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
      intensifies_audio: false,
      is_placeholder: false,
      is_tone_modify: false,
      keyframe_refs: [],
      last_nonzero_volume: 1.0,
      render_index: idx,
      reverse: false,
      source_timerange: { start: srcStart, duration: srcDur },
      speed: 1.0,
      target_timerange: { start: targetStart, duration: srcDur },
      template_id: "",
      template_scene: "default",
      track_attribute: 0,
      track_render_index: 0,
      uniform_scale: { on: true, value: 1.0 },
      visible: true,
      volume: 1.0,
      id: randomUUID(),
      material_id: videoMatIdByClip.get(s.clipIndex),
    });
  });

  const totalUs = targetPos;

  // Subtitle text track on top
  const textMaterials: Record<string, unknown>[] = [];
  const textSegments: Record<string, unknown>[] = [];
  let textTrackId: string | null = null;

  if (subtitulos && subtitulos.transcripcion.length > 0) {
    textTrackId = randomUUID();
    const { transcripcion, config } = subtitulos;
    const perLine = Math.max(1, config.palabras_por_linea || 4);
    const lines: WordTimestamp[][] = [];
    for (let i = 0; i < transcripcion.length; i += perLine) {
      lines.push(transcripcion.slice(i, i + perLine));
    }
    const yByPosition: Record<ConfigSubtitulos["posicion"], number> = {
      "bottom-center": -0.7,
      "top-center": 0.7,
      center: 0.0,
    };
    // Outline (border) negro siempre para legibilidad — es el estandar
    // de los Reels/TikToks profesionales. Aunque el cliente no lo pida
    // explicitamente, sin outline el texto se pierde en fondos claros.
    const outlineColor = "#000000";
    // Sombra: si el cliente la pidio, color por defecto negro semi-trans.
    const shadowColor = "#000000";
    // text_size en CapCut: 15-30 = chico, 30-50 = medio, 50-80 = grande.
    // El cliente trae tamano_base en "pixels remotion" (24-80). Mapeo
    // proporcional pero con piso de 30 para que se lea siempre.
    const capCutTextSize = Math.max(30, Math.min(80, config.tamano_base));
    // Nombre de fuente sin extension — CapCut hace best-effort match
    // contra sus fuentes built-in. Si no la encuentra usa la default.
    const fontName = config.fuente_principal || "";

    lines.forEach((line, idx) => {
      const text = line.map((w) => w.texto).join(" ").trim();
      if (!text) return;
      const startSec = line[0].start;
      const next = lines[idx + 1];
      const endSec = next ? next[0].start : line[line.length - 1].end + 0.4;
      const startUs = secToMicro(Math.max(0, startSec));
      const durUs = Math.max(100_000, secToMicro(endSec - startSec));
      const textMaterialId = randomUUID();
      textMaterials.push({
        id: textMaterialId,
        type: "text",
        alignment: 1, // centrado horizontal
        background_alpha: 1.0,
        background_color: "",
        background_height: 0.14,
        background_horizontal_offset: 0.0,
        background_round_radius: 0.0,
        background_style: 0,
        background_vertical_offset: 0.0,
        background_width: 0.14,
        base_content: "",
        bold_width: 0.0,
        // Outline negro siempre (legibilidad sobre cualquier fondo).
        border_alpha: 1.0,
        border_color: outlineColor,
        border_width: 0.08,
        check_flag: 7,
        combo_info: { text_templates: [] },
        content: text,
        fixed_height: -1.0,
        fixed_width: -1.0,
        font_category_id: "",
        font_category_name: "",
        font_id: "",
        // Mejor pasar el nombre — CapCut intenta match. Si no encuentra,
        // usa default sin romper.
        font_name: fontName,
        font_path: "",
        font_resource_id: "",
        font_size: 15.0,
        font_source_platform: 0,
        font_team_id: "",
        font_title: "",
        font_url: "",
        fonts: [],
        force_apply_line_max_number: false,
        global_alpha: 1.0,
        group_id: "",
        has_shadow: config.sombra ?? true,
        initial_scale: 1.0,
        inner_padding: -1.0,
        is_rich_text: false,
        italic_degree: 0,
        ktv_color: "",
        language: "",
        layer_weight: 1,
        letter_spacing: 0.0,
        line_feed: 1,
        line_max_width: 0.82,
        line_spacing: 0.02,
        name: "",
        original_size: [],
        preset_category: "",
        preset_category_id: "",
        preset_has_set_alignment: false,
        preset_id: "",
        preset_index: 0,
        preset_name: "",
        recognize_task_id: "",
        recognize_type: 0,
        relevance_segment: [],
        shadow_alpha: 0.6,
        shadow_angle: -45.0,
        shadow_color: shadowColor,
        shadow_distance: 6.0,
        shadow_point: { x: 0.6, y: -0.6 },
        shadow_smoothing: 0.45,
        shape_clip_x: false,
        shape_clip_y: false,
        source_from: "",
        style_name: "",
        sub_type: 0,
        subtitle_keywords: null,
        subtitle_template_original_fontsize: 0.0,
        text_alpha: 1.0,
        text_color: config.color_base,
        text_curve: null,
        text_preset_resource_id: "",
        text_size: capCutTextSize,
        text_to_audio_ids: [],
        tts_auto_update: false,
        typesetting: 0,
        underline: false,
        underline_offset: 0.22,
        underline_width: 0.05,
        use_effect_default_color: false, // forzar uso de text_color
        words: { end_time: [], start_time: [], text: [] },
      });
      textSegments.push({
        id: randomUUID(),
        material_id: textMaterialId,
        clip: {
          alpha: 1.0,
          flip: { horizontal: false, vertical: false },
          rotation: 0.0,
          scale: { x: 1.0, y: 1.0 },
          transform: { x: 0.0, y: yByPosition[config.posicion] ?? -0.7 },
        },
        common_keyframes: [],
        extra_material_refs: [],
        render_index: 1000 + idx,
        source_timerange: { start: 0, duration: durUs },
        target_timerange: { start: startUs, duration: durUs },
        speed: 1.0,
        track_render_index: 1,
        visible: true,
        volume: 1.0,
      });
    });
  }

  // Build materials arrays — la estructura debe matchear lo que CapCut
  // espera para que el relink manual funcione. Cuando faltan campos, CapCut
  // muestra "No se pudo vincular" al seleccionar el archivo a vincular.
  const videoMaterials = clips.map((c) => ({
    aigc_type: "none",
    audio_fade: null,
    cartoon_path: "",
    category_id: "",
    category_name: "local",
    check_flag: 62978047,
    crop: {
      lower_left_x: 0.0,
      lower_left_y: 1.0,
      lower_right_x: 1.0,
      lower_right_y: 1.0,
      upper_left_x: 0.0,
      upper_left_y: 0.0,
      upper_right_x: 1.0,
      upper_right_y: 0.0,
    },
    crop_ratio: "free",
    crop_scale: 1.0,
    duration: secToMicro(c.metadata.duracion),
    extra_type_option: 0,
    formula_id: "",
    freeze: null,
    gameplay: null,
    has_audio: true,
    height: c.metadata.height,
    id: videoMatIdByClip.get(c.index),
    intensifies_audio_path: "",
    intensifies_path: "",
    is_ai_generate_content: false,
    is_unified_beauty_mode: false,
    // local_id / local_material_id / material_id deben tener el MISMO
    // valor para que CapCut pueda resolver el path local del archivo.
    // Antes estaban vacios y CapCut fallaba el relink (no podia
    // identificar el material).
    local_id: videoMatIdByClip.get(c.index),
    local_material_id: videoMatIdByClip.get(c.index),
    material_id: videoMatIdByClip.get(c.index),
    material_name: c.localFilename,
    material_url: "",
    matting: { flag: 0, has_use_quick_brush: false, has_use_quick_eraser: false, interactiveTime: [], path: "", strokes: [] },
    // media_path debe coincidir con `path`. CapCut usa AMBOS en distintos
    // momentos del proceso de carga (uno en el editor, otro en el render).
    media_path: c.localFilename,
    object_locked: null,
    origin_material_id: videoMatIdByClip.get(c.index),
    path: c.localFilename,
    picture_from: "none",
    picture_set_category_id: "",
    picture_set_category_name: "",
    request_id: "",
    reverse_intensifies_path: "",
    reverse_path: "",
    smart_motion: null,
    source: 0,
    source_platform: 0,
    stable: { matrix_path: "", stable_level: 0, time_range: { duration: 0, start: 0 } },
    team_id: "",
    type: "video",
    video_algorithm: { algorithms: [], deflicker: null, motion_blur_config: null, noise_reduction: null, path: "", quality_enhance: null, time_range: null },
    width: c.metadata.width,
  }));

  // audioMaterials eliminado a proposito — ver comentario arriba sobre
  // el doble audio.

  const tracks: Record<string, unknown>[] = [
    { attribute: 0, flag: 0, id: videoTrackId, is_default_name: true, name: "", segments: videoSegments, type: "video" },
  ];
  if (textTrackId && textSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: textTrackId,
      is_default_name: true,
      name: "",
      segments: textSegments,
      type: "text",
    });
  }

  const draft = {
    canvas_config: { ratio: "original", width: baseWidth, height: baseHeight },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      maintrack_adsorb: true,
      material_save_mode: 0,
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_recognition_id: "",
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null,
    },
    cover: null,
    create_time: nowUs,
    duration: totalUs,
    extra_info: null,
    fps: baseFps,
    free_render_index_mode_on: false,
    group_container: null,
    id: draftId,
    keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: {
      app_id: 359289,
      app_source: "lv",
      app_version: "9.0.0",
      device_id: randomUUID(),
      hard_disk_id: randomUUID(),
      mac_address: randomUUID(),
      os: "windows",
      os_version: "10.0",
    },
    materials: {
      ai_translates: [],
      audio_balances: [],
      audio_effects: [],
      audio_fades: [],
      audio_track_indexes: [],
      audios: [],
      beats: [],
      canvases: [
        {
          album_image: "",
          blur: 0.0,
          color: "",
          id: canvasId,
          image: "",
          image_id: "",
          image_name: "",
          source_platform: 0,
          team_id: "",
          type: "canvas_color",
        },
      ],
      chromas: [],
      color_curves: [],
      digital_humans: [],
      drafts: [],
      effects: [],
      filters: [],
      handwrites: [],
      hsl: [],
      images: [],
      log_color_wheels: [],
      loudnesses: [],
      manual_deformations: [],
      masks: [],
      material_animations: [],
      material_colors: [],
      placeholders: [],
      plugin_effects: [],
      primary_color_wheels: [],
      realtime_denoises: [],
      shapes: [],
      smart_crops: [],
      smart_relights: [],
      sound_channel_mappings: [
        { audio_channel_mapping: 0, id: soundChannelId, is_config_open: false, type: "" },
      ],
      speeds: [{ curve_speed: null, id: speedId, mode: 0, speed: 1.0, type: "speed" }],
      stickers: [],
      tail_leaders: [],
      text_templates: [],
      texts: textMaterials,
      time_marks: [],
      transitions: [],
      video_effects: [],
      video_trackings: [],
      videos: videoMaterials,
      vocal_beautifys: [],
      vocal_separations: [
        { choice: 0, id: vocalSeparationId, production_path: "", time_range: null, type: "vocal_separation" },
      ],
    },
    mutable_config: null,
    name: "",
    new_version: "70.0.0",
    platform: {
      app_id: 359289,
      app_source: "lv",
      app_version: "9.0.0",
      device_id: randomUUID(),
      hard_disk_id: randomUUID(),
      mac_address: randomUUID(),
      os: "windows",
      os_version: "10.0",
    },
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: "default",
    static_cover_image_path: "",
    time_marks: null,
    tracks,
    update_time: 0,
    version: 470000,
  };

  const meta = {
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "draft_cover.jpg",
    draft_deeplink_url: "",
    draft_enterprise_info: { draft_enterprise_extra: "", draft_enterprise_id: "", draft_enterprise_name: "", enterprise_material: [] },
    draft_fold_path: "",
    draft_id: draftId,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_materials: [
      {
        type: 0,
        value: clips.map((c) => ({
          create_time: Math.floor(nowUs / 1000000),
          duration: secToMicro(c.metadata.duracion),
          extra_info: c.localFilename,
          file_Path: c.localFilename,
          height: c.metadata.height,
          id: videoMatIdByClip.get(c.index),
          import_time: Math.floor(nowUs / 1000000),
          import_time_ms: Math.floor(nowUs / 1000),
          item_source: 1,
          md5: "",
          metetype: "video",
          roughcut_time_range: { duration: secToMicro(c.metadata.duracion), start: 0 },
          sub_time_range: { duration: -1, start: -1 },
          type: 0,
          width: c.metadata.width,
        })),
      },
    ],
    draft_materials_copied_info: [],
    draft_name: videoName,
    draft_new_version: "",
    draft_removable_storage_device: "",
    draft_root_path: "",
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: 0,
    draft_type: "",
    tm_draft_cloud_completed: "",
    tm_draft_cloud_modified: 0,
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_draft_removed: 0,
    tm_duration: totalUs,
  };

  return {
    draftJson: JSON.stringify(draft),
    metaJson: JSON.stringify(meta),
  };
}

export type { ClipMultiSource };
