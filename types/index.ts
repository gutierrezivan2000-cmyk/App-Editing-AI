export interface WordTimestamp {
  texto: string;
  start: number;
  end: number;
  enfasis: boolean;
}

export interface SilenceSegment {
  start: number;
  end: number;
  duracion: number;
}

export interface ClienteProfile {
  id: string;
  nombre: string;
  redes: ("instagram_reels" | "tiktok" | "youtube_shorts" | "instagram_stories")[];
  subtitulos: {
    fuente_principal: string;
    fuente_enfasis: string;
    tamano_base: number;
    tamano_enfasis: number;
    color_base: string;
    color_enfasis: string;
    posicion: "bottom-center" | "top-center" | "center";
    animacion: "pop-scale" | "slide-up" | "typewriter" | "highlight" | "karaoke";
    palabras_por_linea: number;
    sombra: boolean;
  };
  silencio: {
    umbral_db: number;
    duracion_minima_seg: number;
    margen_seg: number;
  };
  exportacion: {
    formatos: ("9:16" | "1:1" | "16:9")[];
    fps: 24 | 30 | 60;
    bitrate: string;
  };
}

export type SubtitulosOverride = Partial<ClienteProfile["subtitulos"]>;

export interface ClipMultiSource {
  url: string;
  name: string;
  // Opcionales — se llenan durante el análisis del pipeline para guardar en DB.
  duracion?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface SnippetPlan {
  clipIndex: number;     // índice dentro del array clips
  start: number;         // segundos en el clip de origen
  end: number;
  // Mapeo al guión (si Claude lo decidió usando match exacto): índice de la
  // línea del guión que este snippet representa. -1 si no hay match.
  guionLineIndex?: number;
  razon?: string;        // explicación breve para la UI
}

export interface PlanMulticlip {
  snippets: SnippetPlan[];
  enfasisPalabras: string[];
  animacionOverride: ClienteProfile["subtitulos"]["animacion"] | null;
  observaciones: string;
}

export interface PipelineProgress {
  /** Step 0-based segun el modo de pipeline. */
  step: number;
  /** Label corto del step. */
  label: string;
  /** Sub-paso opcional ("Procesando clip 3 de 6"). */
  detail?: string;
  /** ISO timestamp del momento que arranco el step. */
  startedAt: string;
  /** Porcentaje 0-100 si el step puede estimarse. */
  percent?: number;
}

export interface Proyecto {
  id: string;
  clienteId: string;
  nombre: string;
  brief: string;
  footageUrl: string;
  outputUrl?: string;
  status: "pending" | "processing" | "completed" | "error";
  renderMethod: "original" | "mirage" | "cortes" | "multiclip";
  clickupTaskId?: string;
  errorMessage?: string;
  /** Avance reportado por el pipeline en vivo. Null si nunca corrio. */
  progress?: PipelineProgress;
  // Campos del pipeline 'cortes' (IA decide qué cortar, exporta project files)
  xmlUrl?: string;
  edlUrl?: string;
  capcutUrl?: string;
  /** Archivo .srt con subtítulos, importable en Premiere/DaVinci/CapCut. */
  srtUrl?: string;
  cortesAnalysis?: unknown;
  keepSegmentsCount?: number;
  duracionSeg?: number;
  // Campos del pipeline 'multiclip'
  clips?: ClipMultiSource[];
  guion?: string;
  subtitulosOverride?: SubtitulosOverride;
  planMulticlip?: PlanMulticlip;
  /**
   * Si true, al final del pipeline multiclip se ejecuta el render Remotion
   * para producir un MP4 con subtítulos QUEMADOS. Toma 10-15 min adicionales.
   * Si false (default), el outputUrl es el video_unido.mp4 sin subs quemados
   * y los subtítulos viven en los archivos editables (CapCut/Premiere/SRT).
   */
  renderSubtitulos?: boolean;
  /**
   * Si true, el ZIP CapCut embebe los clips originales adentro — pesado,
   * suma 10-15 min al pipeline en proyectos con varios clips. Default false:
   * el ZIP queda en KB con solo draft + un README listando las URLs
   * publicas para descarga manual.
   */
  incluirClipsEnZip?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Output estructurado de Claude. NO contiene código TSX.
 * Solo configuración que parametriza el componente Remotion estático.
 */
export interface InstruccionesEdicion {
  enfasisPalabras: string[];
  silenciosFinales: SilenceSegment[];
  ffmpegCommands: string[];
  observaciones: string;
  animacionOverride?: ClienteProfile["subtitulos"]["animacion"];
}

export interface RenderInputProps {
  videoUrl: string;
  transcripcion: WordTimestamp[];
  clienteProfile: ClienteProfile;
  enfasisPalabras: string[];
}
