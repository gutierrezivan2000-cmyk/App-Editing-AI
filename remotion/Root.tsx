import React from "react";
import { Composition } from "remotion";
import { VideoBase } from "./compositions/VideoBase";
import type { RenderInputProps } from "@/types";

const defaultProps: RenderInputProps = {
  videoUrl: "",
  transcripcion: [],
  clienteProfile: {
    id: "default",
    nombre: "Default",
    redes: ["instagram_reels"],
    subtitulos: {
      fuente_principal: "sans-serif",
      fuente_enfasis: "sans-serif",
      tamano_base: 48,
      tamano_enfasis: 80,
      color_base: "#FFFFFF",
      color_enfasis: "#FF6B35",
      posicion: "bottom-center",
      animacion: "pop-scale",
      palabras_por_linea: 4,
      sombra: true,
    },
    silencio: { umbral_db: -35, duracion_minima_seg: 0.4, margen_seg: 0.15 },
    exportacion: { formatos: ["9:16"], fps: 30, bitrate: "8M" },
  },
  enfasisPalabras: [],
};

type FormatoVideo = RenderInputProps["clienteProfile"]["exportacion"]["formatos"][number];

// Mapeo formato → dimensiones (9:16 vertical, 1:1 square, 16:9 landscape).
// Tomamos el primer formato declarado en el perfil del cliente.
const DIMS_BY_FORMAT: Record<FormatoVideo, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="VideoBase"
    component={VideoBase as unknown as React.ComponentType<Record<string, unknown>>}
    // Estos son SOLO defaults para el preview en Remotion Studio. El render
    // real (renderMediaOnLambda / @remotion/vercel) usa lo que devuelva
    // `calculateMetadata`, que computa fps + duración + dimensiones desde
    // las props efectivas.
    durationInFrames={900}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={defaultProps as unknown as Record<string, unknown>}
    calculateMetadata={({ props }) => {
      const p = props as unknown as RenderInputProps;
      const last = p.transcripcion[p.transcripcion.length - 1];
      const fps = p.clienteProfile?.exportacion?.fps ?? 30;
      // Si no hay transcripción no podemos calcular duración real; usamos
      // un default conservador de 10 s (era 30 s, que renderizaba 30 s de
      // negro innecesarios).
      const lastEnd = last?.end ?? 10;
      const durationInFrames = Math.max(1, Math.ceil(lastEnd * fps));
      const format = p.clienteProfile?.exportacion?.formatos?.[0] ?? "9:16";
      const dims = DIMS_BY_FORMAT[format] ?? DIMS_BY_FORMAT["9:16"];
      return { durationInFrames, fps, width: dims.width, height: dims.height };
    }}
  />
);
