"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PlayerRef } from "@remotion/player";
import { WaveformBar } from "./WaveformBar";
import type {
  ClipMultiSource,
  SnippetPlan,
  WordTimestamp,
} from "@/types";

interface TimelineProps {
  playerRef: React.RefObject<PlayerRef | null>;
  fps: number;
  /** Snippets en orden (corresponde a los segmentos del video unido). */
  snippets: SnippetPlan[];
  onSnippetsChange: (next: (prev: SnippetPlan[]) => SnippetPlan[]) => void;
  clips: ClipMultiSource[];
  /** Transcripción AJUSTADA al timeline final (no la per-clip). */
  transcripcion: WordTimestamp[];
  /** Click en una palabra del track Subs. */
  onWordClick?: (idx: number) => void;
  /** Índice de la palabra actualmente seleccionada para edición. */
  selectedWordIdx?: number;
  /**
   * URL del video unido — del que sale el waveform de audio del track
   * "Audio". Si es undefined, el track no se renderiza.
   */
  audioUrl?: string;
  /**
   * Indica que el waveform corresponde al video unido ANTES de las
   * ediciones actuales (snippets reordenados/recortados). El track
   * se atenua y muestra un chip de aviso.
   */
  audioStale?: boolean;
}

const TRACK_HEIGHT = 56;
const AUDIO_TRACK_HEIGHT = 48;
const RULER_HEIGHT = 26;
const TRACK_GAP = 6;
const LABEL_GUTTER = 64;
const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 400;
const DEFAULT_PX_PER_SEC = 60;

/**
 * Timeline horizontal estilo NLE (CapCut, Premiere). Dos tracks:
 *   - Video: bloques rectangulares por snippet, lado a lado en orden
 *   - Subtítulos: bloques pequeños por palabra
 *
 * Cursor vertical sincronizado al `frameupdate` del Remotion Player.
 * Click en el ruler/track salta al tiempo. Drag de bloques de video
 * reordena. Handles a los costados de cada snippet recortan.
 *
 * Pan horizontal con scroll del navegador (overflow-x: auto en el wrap).
 * Zoom con botones +/− que cambian pxPerSec entre MIN y MAX.
 */
export function Timeline({
  playerRef,
  fps,
  snippets,
  onSnippetsChange,
  clips,
  transcripcion,
  onWordClick,
  selectedWordIdx,
  audioUrl,
  audioStale = false,
}: TimelineProps) {
  const showAudio = Boolean(audioUrl);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);

  // Tiempo total = suma de duraciones de snippets (= duración del video unido).
  const totalDur =
    snippets.length > 0
      ? snippets.reduce((acc, s) => acc + (s.end - s.start), 0)
      : transcripcion[transcripcion.length - 1]?.end ?? 10;
  const totalWidth = Math.max(800, totalDur * pxPerSec);

  // Posición acumulada de cada snippet en el video final.
  const cumulativeStarts: number[] = [];
  {
    let acc = 0;
    for (const s of snippets) {
      cumulativeStarts.push(acc);
      acc += s.end - s.start;
    }
  }

  // ─── Cursor sincronizado al player (frameupdate cada frame) ───
  // Updateamos la posicion left del cursor directamente con ref (no
  // setState) para evitar re-render del timeline en cada frame — solo
  // moveriamos un pixel y eso bloqueado un re-render seria carisimo.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handler: Parameters<PlayerRef["addEventListener"]>[1] = (e) => {
      const detail = (e as CustomEvent<{ frame: number }>).detail;
      if (!detail || typeof detail.frame !== "number") return;
      const sec = detail.frame / fps;
      const cursor = cursorRef.current;
      if (!cursor) return;
      cursor.style.left = `${sec * pxPerSec}px`;
    };
    player.addEventListener("frameupdate", handler);
    return () => {
      player.removeEventListener("frameupdate", handler);
    };
  }, [playerRef, fps, pxPerSec]);

  // Posicion inicial del cursor al montar / cambiar zoom.
  useLayoutEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    cursor.style.left = "0px";
  }, [pxPerSec]);

  const seek = useCallback(
    (sec: number) => {
      const player = playerRef.current;
      if (!player) return;
      player.seekTo(Math.max(0, Math.round(sec * fps)));
    },
    [playerRef, fps],
  );

  // ─── Click en ruler/track vacio: seek ───
  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const content = contentRef.current;
    if (!content) return;
    const rect = content.getBoundingClientRect();
    const x = e.clientX - rect.left + content.scrollLeft;
    const sec = x / pxPerSec;
    seek(Math.max(0, Math.min(sec, totalDur)));
  };

  // ─── Drag de snippets: reordenar arrastrando bloques horizontalmente ───
  const [dragSnipIdx, setDragSnipIdx] = useState<number | null>(null);
  const [dragOverSnipIdx, setDragOverSnipIdx] = useState<number | null>(null);
  const moveSnippet = (from: number, to: number) => {
    if (from === to) return;
    onSnippetsChange((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(from, 1);
      const insertAt = to > from ? to - 1 : to;
      copy.splice(insertAt, 0, moved);
      return copy;
    });
  };

  // ─── Trim handles: ajustar start/end con mouse ───
  const [trimDrag, setTrimDrag] = useState<{
    snipIdx: number;
    side: "start" | "end";
  } | null>(null);
  // Throttle de emisiones a 80ms (~12/seg) — mismo patron que TrimBar del
  // SnippetEditor. Evita saturar React con setState en cada mousemove
  // (~120Hz en monitores modernos) sin perder fluidez perceptible en el
  // preview Remotion + waveform.
  const lastEmitRef = useRef(0);
  const pendingEmitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestUpdateRef = useRef<{ snipIdx: number; start?: number; end?: number } | null>(null);

  useEffect(() => {
    if (!trimDrag) return;
    const THROTTLE_MS = 80;

    const flush = () => {
      const u = latestUpdateRef.current;
      if (!u) return;
      onSnippetsChange((prev) =>
        prev.map((s, i) => {
          if (i !== u.snipIdx) return s;
          return {
            ...s,
            ...(u.start !== undefined ? { start: u.start } : {}),
            ...(u.end !== undefined ? { end: u.end } : {}),
          };
        }),
      );
      lastEmitRef.current = Date.now();
    };

    const move = (e: MouseEvent) => {
      const content = contentRef.current;
      if (!content) return;
      const rect = content.getBoundingClientRect();
      const x = e.clientX - rect.left + content.scrollLeft;
      const targetTime = Math.max(0, x / pxPerSec);
      const finalStart = cumulativeStarts[trimDrag.snipIdx];
      const snip = snippets[trimDrag.snipIdx];
      if (!snip) return;
      // `delta` = cuanto desplazaste respecto a la posicion donde EMPEZABA
      // el snippet en el timeline final. Tiene signo: negativo si lo arrastraste
      // hacia la izquierda, positivo hacia la derecha.
      const delta = targetTime - finalStart;
      const clipDur = clips[snip.clipIndex]?.duracion ?? snip.end;

      if (trimDrag.side === "start") {
        // Mover el handle izquierdo: el nuevo start dentro del clip de
        // origen es el viejo start + delta. Clampeo: no menos que 0, no
        // mas que end-0.1 para mantener duracion minima.
        const newStart = Math.max(0, Math.min(snip.start + delta, snip.end - 0.1));
        latestUpdateRef.current = { snipIdx: trimDrag.snipIdx, start: newStart };
      } else {
        // Mover el handle derecho: la nueva DURACION del snippet es `delta`
        // (porque finalStart no se mueve). Entonces newEnd = start + delta.
        // Clampeo: no menos que start+0.1, no mas que la duracion del clip.
        const newEnd = Math.max(
          snip.start + 0.1,
          Math.min(snip.start + delta, clipDur),
        );
        latestUpdateRef.current = { snipIdx: trimDrag.snipIdx, end: newEnd };
      }

      // Throttle de la emision: si ya pasaron >= THROTTLE_MS desde el ultimo
      // emit, emit ahora; si no, schedula un emit al final del intervalo.
      const now = Date.now();
      if (now - lastEmitRef.current >= THROTTLE_MS) {
        if (pendingEmitRef.current) {
          clearTimeout(pendingEmitRef.current);
          pendingEmitRef.current = null;
        }
        flush();
      } else if (!pendingEmitRef.current) {
        const wait = THROTTLE_MS - (now - lastEmitRef.current);
        pendingEmitRef.current = setTimeout(() => {
          pendingEmitRef.current = null;
          flush();
        }, wait);
      }
    };
    const up = () => {
      if (pendingEmitRef.current) {
        clearTimeout(pendingEmitRef.current);
        pendingEmitRef.current = null;
      }
      // Flush final sin throttle para alinear el state al ultimo pixel.
      flush();
      latestUpdateRef.current = null;
      setTrimDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (pendingEmitRef.current) {
        clearTimeout(pendingEmitRef.current);
        pendingEmitRef.current = null;
      }
    };
  }, [trimDrag, pxPerSec, cumulativeStarts, snippets, clips, onSnippetsChange]);

  // ─── Ticks del ruler ───
  // Mostramos ticks cada X segundos segun el zoom.
  const tickEvery =
    pxPerSec >= 200 ? 0.5 : pxPerSec >= 100 ? 1 : pxPerSec >= 40 ? 2 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= totalDur; t += tickEvery) {
    ticks.push(t);
  }

  return (
    <div className="flex h-full flex-col bg-zinc-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/60 px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <ClockIcon className="h-3 w-3 text-zinc-600" />
          <span className="font-mono tabular-nums text-zinc-300">
            {formatTime(totalDur)}
          </span>
          <span className="text-zinc-700">·</span>
          <span>
            <span className="tabular-nums text-zinc-300">{snippets.length}</span>{" "}
            snippets
          </span>
          <span className="text-zinc-700">·</span>
          <span>
            <span className="tabular-nums text-zinc-300">
              {transcripcion.length}
            </span>{" "}
            palabras
          </span>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          <ZoomButton
            label="−"
            onClick={() =>
              setPxPerSec((v) => Math.max(MIN_PX_PER_SEC, v / 1.5))
            }
            disabled={pxPerSec <= MIN_PX_PER_SEC}
          />
          <button
            onClick={() => setPxPerSec(DEFAULT_PX_PER_SEC)}
            className="rounded px-2 py-0.5 font-mono text-[10px] tabular-nums text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="Zoom default"
          >
            {Math.round(pxPerSec)}px/s
          </button>
          <ZoomButton
            label="+"
            onClick={() =>
              setPxPerSec((v) => Math.min(MAX_PX_PER_SEC, v * 1.5))
            }
            disabled={pxPerSec >= MAX_PX_PER_SEC}
          />
        </div>
      </div>

      {/* Stage del timeline: gutter de labels + área scrollable */}
      <div className="flex min-h-0 flex-1">
        {/* Gutter izquierdo con los nombres de tracks */}
        <div
          className="flex-shrink-0 border-r border-zinc-800 bg-zinc-950/40"
          style={{ width: LABEL_GUTTER }}
        >
          <div
            style={{ height: RULER_HEIGHT }}
            className="border-b border-zinc-800"
          />
          <div
            style={{ height: TRACK_HEIGHT, marginTop: TRACK_GAP }}
            className="flex items-center gap-1.5 px-2"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.6)]" />
            <span className="select-none text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
              Video
            </span>
          </div>
          <div
            style={{ height: TRACK_HEIGHT, marginTop: TRACK_GAP }}
            className="flex items-center gap-1.5 px-2"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
            <span className="select-none text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
              Subs
            </span>
          </div>
          {showAudio && (
            <div
              style={{ height: AUDIO_TRACK_HEIGHT, marginTop: TRACK_GAP }}
              className="flex items-center gap-1.5 px-2"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.6)]" />
              <span className="select-none text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                Audio
              </span>
            </div>
          )}
        </div>

        {/* Área scrollable con el contenido del timeline */}
        <div
          ref={wrapRef}
          className="scrollbar-dark flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div
            ref={contentRef}
            className="relative"
            style={{
              width: totalWidth,
              height:
                RULER_HEIGHT +
                TRACK_HEIGHT * 2 +
                TRACK_GAP * 3 +
                (showAudio ? AUDIO_TRACK_HEIGHT + TRACK_GAP : 0),
            }}
          >
            {/* Ruler */}
            <div
              onClick={handleTrackClick}
              className="absolute left-0 right-0 cursor-pointer border-b border-zinc-800 bg-zinc-950"
              style={{ top: 0, height: RULER_HEIGHT, width: totalWidth }}
            >
              {ticks.map((t) => {
                const isMajor =
                  pxPerSec >= 200
                    ? t % 1 === 0
                    : pxPerSec >= 100
                      ? t % 5 === 0
                      : t % 10 === 0;
                return (
                  <div
                    key={t}
                    className={`absolute top-0 bottom-0 ${isMajor ? "border-l border-zinc-700" : "border-l border-zinc-800/60"}`}
                    style={{ left: t * pxPerSec }}
                  >
                    <span
                      className={`absolute left-1 top-0.5 select-none font-mono text-[9px] tabular-nums ${isMajor ? "text-zinc-400" : "text-zinc-600"}`}
                    >
                      {formatTime(t)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Track Video */}
            <div
              onClick={(e) => {
                // Solo seek si el click no fue sobre un snippet (los snippets
                // hacen stopPropagation).
                handleTrackClick(e);
              }}
              className="group/track absolute left-0 right-0 cursor-pointer"
              style={{
                top: RULER_HEIGHT + TRACK_GAP,
                height: TRACK_HEIGHT,
                width: totalWidth,
              }}
            >
              <div className="absolute inset-0 rounded-sm bg-zinc-950/60 ring-1 ring-inset ring-zinc-800/80" />
              {snippets.map((s, idx) => {
                const start = cumulativeStarts[idx];
                const dur = s.end - s.start;
                const clip = clips[s.clipIndex];
                const isDragging = dragSnipIdx === idx;
                const isDropTarget =
                  dragOverSnipIdx === idx && dragSnipIdx !== idx;
                return (
                  <div
                    key={idx}
                    draggable
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragSnipIdx(idx);
                    }}
                    onDragEnd={() => {
                      setDragSnipIdx(null);
                      setDragOverSnipIdx(null);
                    }}
                    onDragOver={(e) => {
                      if (dragSnipIdx === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverSnipIdx(idx);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragSnipIdx === null) return;
                      moveSnippet(dragSnipIdx, idx);
                    }}
                    onDoubleClick={() => seek(start)}
                    className={[
                      "group absolute top-1 cursor-move overflow-hidden rounded-md border bg-gradient-to-b from-indigo-500/95 to-indigo-700/95 px-2 py-1 text-white shadow-md shadow-indigo-950/50 transition-all",
                      isDragging
                        ? "border-indigo-300/60 opacity-30 scale-[0.97]"
                        : isDropTarget
                          ? "border-indigo-300 ring-2 ring-indigo-300/70 ring-offset-2 ring-offset-zinc-900"
                          : "border-indigo-400/60 hover:border-indigo-300 hover:from-indigo-400 hover:to-indigo-600 hover:shadow-indigo-500/40",
                    ].join(" ")}
                    style={{
                      left: start * pxPerSec,
                      width: Math.max(20, dur * pxPerSec),
                      height: TRACK_HEIGHT - 8,
                    }}
                    title={clip?.name ?? `clip_${s.clipIndex}`}
                  >
                    {/* Highlight superior sutil para look 3D */}
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/30" />
                    <div className="flex items-baseline gap-1 text-[10px] font-semibold leading-tight">
                      <span className="text-indigo-100/70">#{idx + 1}</span>
                      <span className="truncate">
                        {clip?.name ?? `clip_${s.clipIndex}`}
                      </span>
                    </div>
                    <div className="font-mono text-[9px] tabular-nums text-indigo-100/70">
                      {dur.toFixed(1)}s
                    </div>

                    {/* Trim handle izquierdo */}
                    <div
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTrimDrag({ snipIdx: idx, side: "start" });
                      }}
                      className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 transition-colors hover:bg-white/50"
                      title="Recortar inicio"
                    />
                    {/* Trim handle derecho */}
                    <div
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTrimDrag({ snipIdx: idx, side: "end" });
                      }}
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 transition-colors hover:bg-white/50"
                      title="Recortar fin"
                    />
                  </div>
                );
              })}
            </div>

            {/* Track Subs */}
            <div
              onClick={handleTrackClick}
              className="absolute left-0 right-0 cursor-pointer"
              style={{
                top: RULER_HEIGHT + TRACK_HEIGHT + TRACK_GAP * 2,
                height: TRACK_HEIGHT,
                width: totalWidth,
              }}
            >
              <div className="absolute inset-0 rounded-sm bg-zinc-950/60 ring-1 ring-inset ring-zinc-800/80" />
              {transcripcion.map((w, idx) => {
                const dur = w.end - w.start;
                if (dur <= 0) return null;
                const isSelected = selectedWordIdx === idx;
                return (
                  <button
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      seek(w.start);
                      onWordClick?.(idx);
                    }}
                    className={[
                      "absolute top-3 overflow-hidden rounded border px-1 text-left text-[10px] leading-tight transition-all",
                      isSelected
                        ? "border-amber-400/80 bg-amber-400/20 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/60 hover:bg-emerald-500/20 hover:text-emerald-100",
                    ].join(" ")}
                    style={{
                      left: w.start * pxPerSec,
                      width: Math.max(8, dur * pxPerSec),
                      height: TRACK_HEIGHT - 16,
                    }}
                    title={`${formatTime(w.start)} → ${formatTime(w.end)} · ${w.texto}`}
                  >
                    <span className="block truncate font-medium">
                      {w.texto}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Track Audio (waveform) */}
            {showAudio && audioUrl && (
              <div
                onClick={handleTrackClick}
                className="absolute left-0 right-0 cursor-pointer"
                style={{
                  top:
                    RULER_HEIGHT + TRACK_HEIGHT * 2 + TRACK_GAP * 3,
                  height: AUDIO_TRACK_HEIGHT,
                  width: totalWidth,
                }}
              >
                {/* Wrap propio para no propagar clicks del waveform al
                    handleTrackClick: WaveSurfer ya hace su propio seek via
                    el evento `interaction`. */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute inset-0"
                >
                  <WaveformBar
                    videoUrl={audioUrl}
                    playerRef={playerRef}
                    fps={fps}
                    height={AUDIO_TRACK_HEIGHT}
                    stale={audioStale}
                  />
                </div>
              </div>
            )}

            {/* Cursor del playhead */}
            <div
              ref={cursorRef}
              className="pointer-events-none absolute top-0 z-10"
              style={{
                left: 0,
                height:
                  RULER_HEIGHT +
                  TRACK_HEIGHT * 2 +
                  TRACK_GAP * 3 +
                  (showAudio ? AUDIO_TRACK_HEIGHT + TRACK_GAP : 0),
                width: 2,
                background:
                  "linear-gradient(to bottom, #f43f5e 0%, #ef4444 100%)",
                boxShadow:
                  "0 0 0 1px rgba(0,0,0,0.4), 0 0 12px rgba(239,68,68,0.6)",
              }}
            >
              {/* Cabeza del cursor con triángulo */}
              <div className="timeline-cursor-pulse absolute -top-0.5 -left-2 h-3 w-5 rounded-sm bg-red-500 shadow-lg shadow-red-500/50">
                <span className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-red-500" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-5 w-5 items-center justify-center rounded text-xs font-bold text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  if (m === 0) return `${s.toFixed(1)}s`;
  return `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}
