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
  /** Altura del wavesurfer en px (default 56). */
  height?: number;
  /**
   * Si true, el waveform se renderiza atenuado y muestra un chip que avisa
   * que los tiempos NO coinciden con el video actual (porque el usuario
   * reordeno snippets despues de la ultima regeneracion).
   */
  stale?: boolean;
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
  color = "#818cf8",
  height = 56,
  stale = false,
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
      height,
      // Paleta dark: onda apagada + progreso indigo brillante.
      waveColor: "#3f3f46", // zinc-700
      progressColor: color,
      cursorColor: "#f43f5e", // rose-500 — match con el playhead del Timeline
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
    <div
      className={[
        "relative w-full overflow-hidden rounded-sm bg-zinc-950/60 ring-1 ring-inset ring-zinc-800/80 transition-opacity",
        stale ? "opacity-50" : "opacity-100",
      ].join(" ")}
    >
      <div ref={containerRef} className="w-full" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 text-[11px] text-zinc-500">
          <span className="animate-pulse">Decodificando audio…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-950/40 text-[11px] text-red-300">
          {error}
        </div>
      )}
      {stale && !loading && !error && (
        <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300 ring-1 ring-inset ring-amber-500/30">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            Desincronizado · regenerá
          </span>
        </div>
      )}
    </div>
  );
}
