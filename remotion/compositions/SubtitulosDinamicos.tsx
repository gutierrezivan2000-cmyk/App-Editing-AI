/**
 * SubtitulosDinamicos.tsx
 * -----
 * Componente Remotion ESTÁTICO y parametrizable para renderizar subtítulos
 * dinámicos sobre un video. Recibe la transcripción palabra-por-palabra
 * (con flag de énfasis ya aplicado) y la configuración del cliente.
 *
 * IMPORTANTE: Este archivo NO se regenera en runtime. Claude API solo decide
 * qué animación usar, qué palabras enfatizar, y los timings. La lógica de
 * render vive aquí, versionada en git.
 *
 * Animaciones soportadas (config.animacion):
 *  - "pop-scale":  Cada palabra aparece con spring de escala (0 → 1.1 → 1)
 *  - "slide-up":   Cada palabra entra deslizándose desde abajo + fade
 *  - "typewriter": Reveal carácter por carácter
 *  - "highlight":  Palabra aparece y se rellena un fondo de color
 *  - "karaoke":    Línea completa visible, cada palabra cambia de color al hablarse
 * -----
 */

import React from "react";
import {
  interpolate,
  interpolateColors,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadBebasNeue } from "@remotion/google-fonts/BebasNeue";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadRoboto } from "@remotion/google-fonts/Roboto";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadArchivoBlack } from "@remotion/google-fonts/ArchivoBlack";

import type { ClienteProfile, WordTimestamp } from "@/types";

// ——————————————————————————————————————————————
// Carga de fuentes (a nivel de módulo — ocurre una sola vez por bundle)
// ——————————————————————————————————————————————

const FONT_MAP: Record<string, string> = {
  Montserrat: loadMontserrat().fontFamily,
  "Bebas Neue": loadBebasNeue().fontFamily,
  Inter: loadInter().fontFamily,
  Poppins: loadPoppins().fontFamily,
  Oswald: loadOswald().fontFamily,
  Roboto: loadRoboto().fontFamily,
  Anton: loadAnton().fontFamily,
  "Archivo Black": loadArchivoBlack().fontFamily,
};

function resolverFuente(nombre: string): string {
  return FONT_MAP[nombre] ?? "sans-serif";
}

// ——————————————————————————————————————————————
// Tipos locales
// ——————————————————————————————————————————————

type ConfigSubtitulos = ClienteProfile["subtitulos"];

interface SubtitulosDinamicosProps {
  transcripcion: WordTimestamp[];
  config: ConfigSubtitulos;
  frame: number;
  fps: number;
}

interface PalabraRenderProps {
  palabra: WordTimestamp;
  config: ConfigSubtitulos;
  frame: number;
  fps: number;
}

// ——————————————————————————————————————————————
// Utilidades
// ——————————————————————————————————————————————

function agruparEnLineas(
  words: WordTimestamp[],
  maxPorLinea: number
): WordTimestamp[][] {
  const lineas: WordTimestamp[][] = [];
  for (let i = 0; i < words.length; i += maxPorLinea) {
    lineas.push(words.slice(i, i + maxPorLinea));
  }
  return lineas;
}

function encontrarLineaActual(
  lineas: WordTimestamp[][],
  time: number
): number {
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const startTime = linea[0].start;
    const siguiente = lineas[i + 1];
    const endTime = siguiente
      ? siguiente[0].start
      : linea[linea.length - 1].end + 0.5;
    if (time >= startTime && time < endTime) return i;
  }
  return -1;
}

function estiloPosicion(
  posicion: ConfigSubtitulos["posicion"]
): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    padding: "0 6%",
    pointerEvents: "none",
  };
  switch (posicion) {
    case "top-center":
      return { ...base, top: "10%" };
    case "center":
      return { ...base, top: "50%", transform: "translateY(-50%)" };
    case "bottom-center":
    default:
      return { ...base, bottom: "12%" };
  }
}

const TEXT_SHADOW =
  "0 4px 12px rgba(0,0,0,0.85), 0 2px 4px rgba(0,0,0,0.95)";

function estiloBasePalabra(
  palabra: WordTimestamp,
  config: ConfigSubtitulos
): React.CSSProperties {
  return {
    fontFamily: resolverFuente(
      palabra.enfasis ? config.fuente_enfasis : config.fuente_principal
    ),
    fontSize: palabra.enfasis ? config.tamano_enfasis : config.tamano_base,
    color: palabra.enfasis ? config.color_enfasis : config.color_base,
    textShadow: config.sombra ? TEXT_SHADOW : "none",
    fontWeight: palabra.enfasis ? 900 : 700,
    lineHeight: 1.1,
    margin: "0 0.25em",
    display: "inline-block",
    whiteSpace: "pre",
  };
}

// ——————————————————————————————————————————————
// Renderers por animación
// ——————————————————————————————————————————————

function PalabraPopScale({ palabra, config, frame, fps }: PalabraRenderProps) {
  const startFrame = palabra.start * fps;
  const local = frame - startFrame;

  const scale = spring({
    frame: local,
    fps,
    config: { damping: 12, stiffness: 220, mass: 0.6 },
    durationInFrames: 12,
  });

  const opacity = interpolate(local, [0, 3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <span
      style={{
        ...estiloBasePalabra(palabra, config),
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "center bottom",
      }}
    >
      {palabra.texto}
    </span>
  );
}

function PalabraSlideUp({ palabra, config, frame, fps }: PalabraRenderProps) {
  const startFrame = palabra.start * fps;
  const local = frame - startFrame;

  const progress = spring({
    frame: local,
    fps,
    config: { damping: 14, stiffness: 180 },
    durationInFrames: 14,
  });

  const y = interpolate(progress, [0, 1], [50, 0]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);

  return (
    <span
      style={{
        ...estiloBasePalabra(palabra, config),
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      {palabra.texto}
    </span>
  );
}

function PalabraTypewriter({
  palabra,
  config,
  frame,
  fps,
}: PalabraRenderProps) {
  const startFrame = palabra.start * fps;
  const local = Math.max(0, frame - startFrame);

  const charsPerFrame = Math.max(1, Math.round(fps / 30));
  const charsVisibles = Math.min(
    palabra.texto.length,
    Math.floor(local * charsPerFrame)
  );

  const visible = palabra.texto.slice(0, charsVisibles);
  const oculto = palabra.texto.slice(charsVisibles);

  return (
    <span style={estiloBasePalabra(palabra, config)}>
      <span>{visible}</span>
      <span style={{ opacity: 0 }}>{oculto}</span>
    </span>
  );
}

function PalabraHighlight({
  palabra,
  config,
  frame,
  fps,
}: PalabraRenderProps) {
  const startFrame = palabra.start * fps;
  const local = frame - startFrame;

  const opacity = interpolate(local, [0, 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const fillProgress = interpolate(local, [2, 10], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const colorFondo = palabra.enfasis ? config.color_enfasis : "transparent";

  return (
    <span
      style={{
        ...estiloBasePalabra(palabra, config),
        opacity,
        backgroundImage: palabra.enfasis
          ? `linear-gradient(90deg, ${colorFondo} ${fillProgress}%, transparent ${fillProgress}%)`
          : "none",
        padding: palabra.enfasis ? "0.05em 0.2em" : "0",
        borderRadius: "0.1em",
      }}
    >
      {palabra.texto}
    </span>
  );
}

function PalabraKaraoke({ palabra, config, frame, fps }: PalabraRenderProps) {
  const time = frame / fps;

  const progress = interpolate(
    time,
    [palabra.start, palabra.end],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const colorActual = interpolateColors(
    progress,
    [0, 1],
    [config.color_base, config.color_enfasis]
  );

  const scale = interpolate(progress, [0, 0.5, 1], [1, 1.08, 1]);

  return (
    <span
      style={{
        ...estiloBasePalabra(palabra, config),
        color: colorActual,
        transform: `scale(${scale})`,
        transformOrigin: "center",
      }}
    >
      {palabra.texto}
    </span>
  );
}

// ——————————————————————————————————————————————
// Selector de animación
// ——————————————————————————————————————————————

function PalabraAnimada(props: PalabraRenderProps) {
  switch (props.config.animacion) {
    case "pop-scale":
      return <PalabraPopScale {...props} />;
    case "slide-up":
      return <PalabraSlideUp {...props} />;
    case "typewriter":
      return <PalabraTypewriter {...props} />;
    case "highlight":
      return <PalabraHighlight {...props} />;
    case "karaoke":
      return <PalabraKaraoke {...props} />;
    default:
      return <PalabraPopScale {...props} />;
  }
}

// ——————————————————————————————————————————————
// Componente principal
// ——————————————————————————————————————————————

export const SubtitulosDinamicos: React.FC<SubtitulosDinamicosProps> = ({
  transcripcion,
  config,
  frame: frameProp,
  fps: fpsProp,
}) => {
  const frameLocal = useCurrentFrame();
  const { fps: fpsLocal } = useVideoConfig();
  const frame = frameProp ?? frameLocal;
  const fps = fpsProp ?? fpsLocal;

  const time = frame / fps;

  const lineas = React.useMemo(
    () => agruparEnLineas(transcripcion, config.palabras_por_linea),
    [transcripcion, config.palabras_por_linea]
  );

  const lineaActual = encontrarLineaActual(lineas, time);
  if (lineaActual < 0) return null;

  const palabras = lineas[lineaActual];

  const lineaStart = palabras[0].start * fps;
  const lineaEnd =
    (lineas[lineaActual + 1]
      ? lineas[lineaActual + 1][0].start
      : palabras[palabras.length - 1].end + 0.4) * fps;

  const lineaOpacity = interpolate(
    frame,
    [lineaStart, lineaStart + 3, lineaEnd - 4, lineaEnd],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div style={estiloPosicion(config.posicion)}>
      <div
        style={{
          opacity: lineaOpacity,
          maxWidth: "88%",
          textAlign: "center",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
        }}
      >
        {palabras.map((palabra, idx) => (
          <PalabraAnimada
            key={`${lineaActual}-${idx}-${palabra.start}`}
            palabra={palabra}
            config={config}
            frame={frame}
            fps={fps}
          />
        ))}
      </div>
    </div>
  );
};

export default SubtitulosDinamicos;
