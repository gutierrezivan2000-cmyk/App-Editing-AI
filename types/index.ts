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

export interface Proyecto {
  id: string;
  clienteId: string;
  nombre: string;
  brief: string;
  footageUrl: string;
  outputUrl?: string;
  status: "pending" | "processing" | "completed" | "error";
  renderMethod: "original" | "mirage" | "cortes";
  clickupTaskId?: string;
  errorMessage?: string;
  // Campos del pipeline 'cortes' (IA decide qué cortar, exporta project files)
  xmlUrl?: string;
  edlUrl?: string;
  capcutUrl?: string;
  cortesAnalysis?: unknown;
  keepSegmentsCount?: number;
  duracionSeg?: number;
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
