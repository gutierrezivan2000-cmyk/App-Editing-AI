import { randomUUID } from "node:crypto";
import type { ClienteProfile, SilenceSegment, WordTimestamp } from "@/types";
import {
  calcularKeepSegments,
  getLocalFilename,
  type KeepSegment,
  type VideoMetadata,
} from "./premiere-xml";

type ConfigSubtitulos = ClienteProfile["subtitulos"];

interface SubtitulosCapCut {
  transcripcion: WordTimestamp[];
  config: ConfigSubtitulos;
}

/**
 * Generate a CapCut Desktop draft (v5.x compatible) plus the matching meta.
 *
 * IMPORTANT: the user should drop the original video into the same folder as
 * the two JSON files. The `path` we emit is just the bare filename — CapCut
 * scans the draft folder for matching files at open-time. Using `./filename`
 * was observed to fail relink on Windows.
 *
 * When `subtitulos` is passed, an additional `text` track is generated with
 * one text material per line (grouped by `config.palabras_por_linea`). The
 * timestamps must already be in the EDITED-timeline timeframe — pass the
 * post-cut adjusted transcription, not the original Whisper output.
 *
 * Time units: CapCut uses microseconds for all durations.
 */
export function generarCapCutDraft(opts: {
  videoUrl: string;
  videoName: string;
  metadata: VideoMetadata;
  silencios: SilenceSegment[];
  subtitulos?: SubtitulosCapCut;
}): {
  draftJson: string;
  metaJson: string;
  segments: KeepSegment[];
  localFilename: string;
} {
  const { videoUrl, videoName, metadata, silencios, subtitulos } = opts;
  const { width, height, fps, duracion } = metadata;

  const segments = calcularKeepSegments(silencios, duracion);
  const localFilename = getLocalFilename(videoName, videoUrl);

  const secToMicro = (s: number) => Math.round(s * 1_000_000);
  const sourceDurationUs = secToMicro(duracion);

  const draftId = randomUUID();
  const videoMaterialId = randomUUID();
  const videoTrackId = randomUUID();
  const audioMaterialId = randomUUID();
  const audioTrackId = randomUUID();
  const speedId = randomUUID();
  const soundChannelId = randomUUID();
  const vocalSeparationId = randomUUID();
  const canvasId = randomUUID();

  const nowUs = Date.now() * 1000;

  // Bare filename — CapCut finds it in the draft folder by name.
  const sourcePath = localFilename;

  const videoSegments: Record<string, unknown>[] = [];
  const audioSegments: Record<string, unknown>[] = [];

  let targetPos = 0;
  segments.forEach((seg, idx) => {
    const srcStart = secToMicro(seg.start);
    const srcDur = secToMicro(seg.end - seg.start);
    const targetStart = targetPos;
    targetPos += srcDur;

    const baseSegment = {
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
      // Unique render_index per segment — CapCut may collapse adjacent segments
      // sharing the same z-order, which causes the "cuts appear but the clip
      // plays continuously" symptom.
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
    };

    videoSegments.push({
      ...baseSegment,
      id: randomUUID(),
      material_id: videoMaterialId,
    });

    audioSegments.push({
      ...baseSegment,
      id: randomUUID(),
      material_id: audioMaterialId,
    });
  });

  const totalUs = targetPos;

  // ── Subtitle text materials + track (optional) ─────────────────────────
  const textMaterials: Record<string, unknown>[] = [];
  const textSegments: Record<string, unknown>[] = [];
  let textTrackId: string | null = null;

  if (subtitulos && subtitulos.transcripcion.length > 0) {
    textTrackId = randomUUID();
    const { transcripcion, config } = subtitulos;
    const perLine = Math.max(1, config.palabras_por_linea || 4);

    // Group words into lines.
    const lines: WordTimestamp[][] = [];
    for (let i = 0; i < transcripcion.length; i += perLine) {
      lines.push(transcripcion.slice(i, i + perLine));
    }

    // Vertical position. CapCut uses a normalized space where ~0 is center
    // and ±0.85 is near the edges. Bottom-third reads as ~ -0.7.
    const yByPosition: Record<ConfigSubtitulos["posicion"], number> = {
      "bottom-center": -0.7,
      "top-center": 0.7,
      center: 0.0,
    };

    lines.forEach((line, idx) => {
      const text = line.map((w) => w.texto).join(" ").trim();
      if (!text) return;
      const startSec = line[0].start;
      // Extend each line until the next line starts (or +0.4s after the last word).
      const next = lines[idx + 1];
      const endSec = next
        ? next[0].start
        : line[line.length - 1].end + 0.4;
      const startUs = secToMicro(Math.max(0, startSec));
      const durUs = Math.max(100_000, secToMicro(endSec - startSec)); // mínimo 100ms

      const textMaterialId = randomUUID();
      // Rich content tag format CapCut accepts; size/color/font_path follow.
      const richContent =
        `<font path=""><size=${config.tamano_base}>` +
        `<color=${hexToCapCutColor(config.color_base)}>${escapeContent(text)}` +
        `</color></size></font>`;

      textMaterials.push({
        id: textMaterialId,
        type: "text",
        alignment: 1,
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
        border_alpha: 1.0,
        border_color: "",
        border_width: 0.08,
        check_flag: 7,
        combo_info: { text_templates: [] },
        content: richContent,
        fixed_height: -1.0,
        fixed_width: -1.0,
        font_category_id: "",
        font_category_name: "",
        font_id: "",
        font_name: "",
        font_path: "",
        font_resource_id: "",
        font_size: 8.0,
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
        shadow_alpha: 0.8,
        shadow_angle: -45.0,
        shadow_color: "",
        shadow_distance: 8.0,
        shadow_point: { x: 0.6, y: -0.6 },
        shadow_smoothing: 1.0,
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
        text_size: config.tamano_base,
        text_to_audio_ids: [],
        tts_auto_update: false,
        typesetting: 0,
        underline: false,
        underline_offset: 0.22,
        underline_width: 0.05,
        use_effect_default_color: true,
        words: { end_time: [], start_time: [], text: [] },
      });

      textSegments.push({
        id: randomUUID(),
        material_id: textMaterialId,
        cartoon: false,
        clip: {
          alpha: 1.0,
          flip: { horizontal: false, vertical: false },
          rotation: 0.0,
          scale: { x: 1.0, y: 1.0 },
          transform: { x: 0.0, y: yByPosition[config.posicion] ?? -0.7 },
        },
        common_keyframes: [],
        enable_adjust: false,
        enable_color_curves: true,
        enable_color_wheels: true,
        enable_lut: false,
        enable_smart_color_adjust: false,
        extra_material_refs: [],
        group_id: "",
        hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
        intensifies_audio: false,
        is_placeholder: false,
        is_tone_modify: false,
        keyframe_refs: [],
        last_nonzero_volume: 1.0,
        render_index: 1000 + idx,
        reverse: false,
        source_timerange: { start: 0, duration: durUs },
        speed: 1.0,
        target_timerange: { start: startUs, duration: durUs },
        template_id: "",
        template_scene: "default",
        track_attribute: 0,
        track_render_index: 1,
        uniform_scale: { on: true, value: 1.0 },
        visible: true,
        volume: 1.0,
      });
    });
  }

  const tracks: Record<string, unknown>[] = [
    {
      attribute: 0,
      flag: 0,
      id: videoTrackId,
      is_default_name: true,
      name: "",
      segments: videoSegments,
      type: "video",
    },
    {
      attribute: 0,
      flag: 0,
      id: audioTrackId,
      is_default_name: true,
      name: "",
      segments: audioSegments,
      type: "audio",
    },
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
    canvas_config: { ratio: "original", width, height },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: "",
      lyrics_taskinfo: [],
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
    fps: fps,
    free_render_index_mode_on: false,
    group_container: null,
    id: draftId,
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [],
      audios: [],
      effects: [],
      filters: [],
      handwrites: [],
      stickers: [],
      texts: [],
      videos: [],
    },
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
      audios: [
        {
          app_id: 0,
          category_id: "",
          category_name: "local",
          check_flag: 1,
          duration: sourceDurationUs,
          effect_id: "",
          formula_id: "",
          id: audioMaterialId,
          intensifies_path: "",
          local_material_id: "",
          music_id: audioMaterialId,
          name: localFilename,
          path: sourcePath,
          query: "",
          request_id: "",
          resource_id: "",
          search_id: "",
          source_from: "",
          source_platform: 0,
          team_id: "",
          text_id: "",
          tone_category_id: "",
          tone_category_name: "",
          tone_effect_id: "",
          tone_effect_name: "",
          tone_speaker: "",
          tone_type: "",
          type: "extract_music",
          video_id: videoMaterialId,
          wave_points: [],
        },
      ],
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
      speeds: [
        { curve_speed: null, id: speedId, mode: 0, speed: 1.0, type: "speed" },
      ],
      stickers: [],
      tail_leaders: [],
      text_templates: [],
      texts: textMaterials,
      time_marks: [],
      transitions: [],
      video_effects: [],
      video_trackings: [],
      videos: [
        {
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
          duration: sourceDurationUs,
          extra_type_option: 0,
          formula_id: "",
          freeze: null,
          gameplay: null,
          has_audio: true,
          height: height,
          id: videoMaterialId,
          intensifies_audio_path: "",
          intensifies_path: "",
          is_ai_generate_content: false,
          is_unified_beauty_mode: false,
          local_id: "",
          local_material_id: "",
          material_id: "",
          material_name: localFilename,
          material_url: "",
          matting: { flag: 0, has_use_quick_brush: false, has_use_quick_eraser: false, interactiveTime: [], path: "", strokes: [] },
          media_path: "",
          object_locked: null,
          origin_material_id: "",
          path: sourcePath,
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
          width: width,
        },
      ],
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
        value: [
          {
            create_time: Math.floor(nowUs / 1000000),
            duration: sourceDurationUs,
            extra_info: localFilename,
            file_Path: sourcePath,
            height: height,
            id: videoMaterialId,
            import_time: Math.floor(nowUs / 1000000),
            import_time_ms: Math.floor(nowUs / 1000),
            item_source: 1,
            md5: "",
            metetype: "video",
            roughcut_time_range: { duration: sourceDurationUs, start: 0 },
            sub_time_range: { duration: -1, start: -1 },
            type: 0,
            width: width,
          },
        ],
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
    segments,
    localFilename,
  };
}

/** CapCut content tag accepts CSS-style hex like "#FFFFFF". Keep as-is. */
function escapeContent(text: string): string {
  return text.replace(/[<>&"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

/** Convert "#FFFFFF" → "(1.0, 1.0, 1.0, 1.0)" if some future field demands floats. */
function hexToCapCutColor(hex: string): string {
  // For the inline tag CapCut also accepts the hex string verbatim, so we pass it through.
  return hex;
}
