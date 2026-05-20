"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type { PlayerRef } from "@remotion/player";

interface WaveformBarProps {
  /** URL del video unido (de donde se decodifica el audio). */
  videoUrl: string;
  /** Ref al Remotion Player para sincronizar cursor + seek. */
  playerRef: React.RefObject<PlayerRef | null>;
  /** fps del proyecto para convertir frames<->segundos. */
  fps: number;
  /** Color de la onda — usamos el indigo de la marca. */
  color?: string;
}

/**
 * Waveform del audio del video sincronizada al Remotion Player.
 *
 *  - Carga el videoUrl en wavesurfer y dibuja la onda completa.
 *  - El cursor de wavesurfer se mueve siguiendo el currentFrame del Remotion
 *    Player (escuchando el evento `frameupdate`).
 *  - Si el usuario clickea/arrastra en la waveform, hace seek en el Player.
 *
 * Tradeoff: wavesurfer descarga el video completo al browser para decodificar
 * el audio. Para un video de 60-90s (caso normal en multiclip) eso son
 * 5-20 MB, OK sobre wifi. Cache del browser ayuda cuando el Player ya lo
 * tenia descargado.
 */
export function WaveformBar({
  videoUrl,
  playerRef,
  fps,
  color = "#6366f1",
}: WaveformBarProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Flag para evitar bucles infinitos cuando wavesurfer cambia el cursor
  // por un click del usuario y eso dispara `interaction` -> seek del Player
  // -> frameupdate -> wavesurfer.setTime -> loop.
  const internalSeekRef = useRef(false);

  // Mount: crear wavesurfer + cargar audio.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 56,
      waveColor: "#c7d2fe", // indigo-200 (fondo)
      progressColor: color,
      cursorColor: color,
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      interact: true,
      url: videoUrl,
    });
    wavesurferRef.current = ws;

    ws.on("ready", () => {
      if (cancelled) return;
      setLoading(false);
    });
    ws.on("error", (e) => {
      if (cancelled) return;
      setError(typeof e === "string" ? e : "No se pudo cargar la waveform");
      setLoading(false);
    });
    // Click/drag en la waveform -> seek en el Remotion Player.
    ws.on("interaction", (newTimeSec) => {
      if (cancelled) return;
      const player = playerRef.current;
      if (!player) return;
      internalSeekRef.current = true;
      player.seekTo(Math.max(0, Math.round(newTimeSec * fps)));
      // Liberamos el flag despues de un tick — el frameupdate del player
      // ya viene en flight y queremos ignorar SOLO ese.
      setTimeout(() => {
        internalSeekRef.current = false;
      }, 50);
    });

    return () => {
      cancelled = true;
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [videoUrl, color, fps, playerRef]);

  // Sincronizar cursor de wavesurfer con frameupdate del Player.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handler: Parameters<PlayerRef["addEventListener"]>[1] = (e) => {
      if (internalSeekRef.current) return;
      const ws = wavesurferRef.current;
      if (!ws) return;
      // `frameupdate` trae `detail.frame`. El typing puede ser laxo,
      // hacemos cast defensivo.
      const detail = (e as CustomEvent<{ frame: number }>).detail;
      if (!detail || typeof detail.frame !== "number") return;
      const sec = detail.frame / fps;
      ws.setTime(sec);
    };
    player.addEventListener("frameupdate", handler);
    return () => {
      player.removeEventListener("frameupdate", handler);
    };
  }, [playerRef, fps]);

  return (
    <div className="relative w-full rounded-lg bg-gray-100 p-2">
      <div ref={containerRef} className="w-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 text-xs text-gray-500">
          <span className="animate-pulse">Decodificando audio…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
