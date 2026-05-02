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

export const RemotionRoot: React.FC = () => (
  <Composition
    id="VideoBase"
    component={VideoBase as unknown as React.ComponentType<Record<string, unknown>>}
    durationInFrames={900}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={defaultProps as unknown as Record<string, unknown>}
    calculateMetadata={({ props }) => {
      const p = props as unknown as RenderInputProps;
      const last = p.transcripcion[p.transcripcion.length - 1];
      const fps = p.clienteProfile?.exportacion?.fps ?? 30;
      const durationInFrames = Math.max(1, Math.ceil((last?.end ?? 30) * fps));
      return { durationInFrames, fps };
    }}
  />
);
