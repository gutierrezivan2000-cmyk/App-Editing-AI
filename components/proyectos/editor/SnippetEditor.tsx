"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipMultiSource, SnippetPlan } from "@/types";

interface SnippetEditorProps {
  snippets: SnippetPlan[];
  onChange: (next: (prev: SnippetPlan[]) => SnippetPlan[]) => void;
  clips: ClipMultiSource[];
  onSeek: (sec: number) => void;
}

/**
 * Editor de snippets con:
 *   - Drag handle (≡) para reordenar arrastrando la fila completa.
 *   - Barra visual con dos handles que se arrastran con el mouse para
 *     ajustar start y end (recorte fino). Clampeado contra la duracion
 *     del clip de origen.
 *   - Edicion numerica directa de in/out por si querés precisión exacta.
 *   - Botones up/down/delete por accesibilidad teclado.
 *
 * Drag-and-drop usa HTML5 native DnD (sin libs externas). El indicador
 * visual de drop target es un borde indigo arriba/abajo del item destino.
 */
export function SnippetEditor({
  snippets,
  onChange,
  clips,
  onSeek,
}: SnippetEditorProps) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  const updateSnippet = (idx: number, patch: Partial<SnippetPlan>) => {
    onChange((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  };

  const moveSnippet = (from: number, to: number) => {
    if (from === to) return;
    onChange((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(from, 1);
      // Si `to` era despues de `from`, baja una posicion tras el splice.
      const insertAt = to > from ? to - 1 : to;
      copy.splice(insertAt, 0, moved);
      return copy;
    });
  };

  const moveByDelta = (idx: number, delta: -1 | 1) => {
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= snippets.length) return;
    onChange((prev) => {
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  };

  const deleteSnippet = (idx: number) => {
    onChange((prev) => prev.filter((_, i) => i !== idx));
  };

  // Tiempo acumulado del timeline final.
  let cumulative = 0;
  const cumulativeStarts = snippets.map((s) => {
    const start = cumulative;
    cumulative += s.end - s.start;
    return start;
  });

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          <span className="tabular-nums text-zinc-300">{snippets.length}</span>{" "}
          snippets
        </h3>
        <span className="flex items-center gap-1 text-[10px] text-zinc-600">
          <DragIcon className="h-3 w-3" />
          arrastrá para reordenar
        </span>
      </div>

      {snippets.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/50 px-4 py-6 text-center text-xs text-zinc-500">
          Sin snippets — el plan está vacío.
        </div>
      ) : (
        <ol className="space-y-2">
          {snippets.map((s, idx) => {
            const clip = clips[s.clipIndex];
            const clipDuracion = clip?.duracion ?? 0;
            const dur = s.end - s.start;
            const finalStart = cumulativeStarts[idx];
            const isDragging = draggingIdx === idx;
            const isDropTarget = dropTargetIdx === idx && draggingIdx !== idx;
            return (
              <li
                key={idx}
                onDragOver={(e) => {
                  if (draggingIdx === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropTargetIdx(idx);
                }}
                onDragLeave={() => {
                  if (dropTargetIdx === idx) setDropTargetIdx(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingIdx === null) return;
                  moveSnippet(draggingIdx, idx);
                  setDraggingIdx(null);
                  setDropTargetIdx(null);
                }}
                className={[
                  "rounded-lg border bg-zinc-950/50 p-3 transition-all",
                  isDragging
                    ? "border-indigo-500/40 opacity-40 scale-[0.98]"
                    : isDropTarget
                      ? "border-indigo-400 ring-2 ring-indigo-500/40 ring-offset-2 ring-offset-zinc-900"
                      : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50",
                ].join(" ")}
              >
                <div className="flex items-start gap-2">
                  {/* Drag handle */}
                  <button
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingIdx(idx);
                    }}
                    onDragEnd={() => {
                      setDraggingIdx(null);
                      setDropTargetIdx(null);
                    }}
                    className="flex-shrink-0 cursor-grab pt-0.5 text-zinc-600 transition-colors hover:text-zinc-300 active:cursor-grabbing"
                    title="Arrastrar para reordenar"
                  >
                    <DragIcon className="h-5 w-5" />
                  </button>
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-indigo-500/15 text-[10px] font-bold tabular-nums text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-xs font-medium text-zinc-100">
                      <span className="inline-flex rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                        clip #{s.clipIndex}
                      </span>
                      <span className="truncate">
                        {clip?.name ?? `clip_${s.clipIndex}`}
                      </span>
                    </p>
                    <button
                      onClick={() => onSeek(finalStart)}
                      className="mt-0.5 font-mono text-[10px] tabular-nums text-zinc-500 transition-colors hover:text-indigo-300"
                      title="Saltar a este snippet en el preview"
                    >
                      {formatTime(finalStart)} → {formatTime(finalStart + dur)}
                    </button>
                  </div>
                  <div className="flex gap-0.5">
                    <button
                      onClick={() => moveByDelta(idx, -1)}
                      disabled={idx === 0}
                      className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Mover arriba"
                    >
                      <ChevronUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => moveByDelta(idx, 1)}
                      disabled={idx === snippets.length - 1}
                      className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Mover abajo"
                    >
                      <ChevronDownIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteSnippet(idx)}
                      className="rounded p-1 text-zinc-500 transition-colors hover:bg-red-500/20 hover:text-red-300"
                      title="Borrar snippet"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Trim handles visuales */}
                <TrimBar
                  start={s.start}
                  end={s.end}
                  clipDuracion={clipDuracion}
                  onChange={(newStart, newEnd) =>
                    updateSnippet(idx, { start: newStart, end: newEnd })
                  }
                />

                <div className="mt-2 flex gap-2 text-[10px]">
                  <label className="flex flex-1 items-center gap-1.5">
                    <span className="font-semibold uppercase tracking-wider text-zinc-600">
                      in
                    </span>
                    <input
                      type="number"
                      value={s.start.toFixed(2)}
                      step="0.05"
                      min={0}
                      max={s.end - 0.1}
                      onChange={(e) =>
                        updateSnippet(idx, {
                          start: Math.max(
                            0,
                            Math.min(s.end - 0.1, Number(e.target.value)),
                          ),
                        })
                      }
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono tabular-nums text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                    />
                  </label>
                  <label className="flex flex-1 items-center gap-1.5">
                    <span className="font-semibold uppercase tracking-wider text-zinc-600">
                      out
                    </span>
                    <input
                      type="number"
                      value={s.end.toFixed(2)}
                      step="0.05"
                      min={s.start + 0.1}
                      max={clipDuracion || undefined}
                      onChange={(e) =>
                        updateSnippet(idx, {
                          end: Math.max(s.start + 0.1, Number(e.target.value)),
                        })
                      }
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono tabular-nums text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                    />
                  </label>
                  <span className="flex flex-shrink-0 items-center rounded bg-indigo-500/10 px-1.5 font-mono tabular-nums text-indigo-300 ring-1 ring-inset ring-indigo-500/20">
                    {dur.toFixed(2)}s
                  </span>
                </div>
                {s.razon !== undefined && (
                  <input
                    type="text"
                    value={s.razon ?? ""}
                    onChange={(e) =>
                      updateSnippet(idx, { razon: e.target.value })
                    }
                    className="mt-1.5 w-full rounded border border-transparent bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:bg-zinc-950 focus:text-zinc-200 focus:outline-none"
                    placeholder="Razón / nota interna…"
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const LIVE_THROTTLE_MS = 80;

/**
 * Barra horizontal con dos handles arrastrables. El ancho de la barra
 * representa la duracion COMPLETA del clip de origen. La zona indigo
 * entre los handles representa el snippet [start, end].
 *
 * Mouse drag handlers:
 *   - mousedown en handle -> empieza track de movimiento
 *   - mousemove (en window) -> updatea start o end segun cual handle Y
 *     emite onChange THROTTLED a ~80ms para que el preview Remotion vea
 *     el recorte en vivo. El throttle evita saturar React con setState
 *     en cada frame del mouse (~120Hz en monitores modernos).
 *   - mouseup -> emite onChange final con el valor exacto (sin throttle)
 *     para asegurar que el state termine alineado al ultimo pixel del drag.
 *
 * Usamos refs internas para el valor "vivo" del drag (no causa re-render
 * de este componente), pero igual mantenemos localStart/localEnd como
 * state para el rendering visual de los handles.
 */
function TrimBar({
  start,
  end,
  clipDuracion,
  onChange,
}: {
  start: number;
  end: number;
  clipDuracion: number;
  onChange: (newStart: number, newEnd: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  // Estado local para el drag — manda los pixeles donde dibujamos los handles.
  const [localStart, setLocalStart] = useState(start);
  const [localEnd, setLocalEnd] = useState(end);
  // Refs paralelas al state local para acceder al valor mas reciente desde
  // los listeners de mouse sin tener que reinyectar el effect en cada update.
  const localStartRef = useRef(start);
  const localEndRef = useRef(end);
  const lastEmitRef = useRef(0);
  const pendingEmitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincronizar el estado local cuando el padre cambia (ej. edicion numerica).
  useEffect(() => {
    if (!dragging) {
      setLocalStart(start);
      setLocalEnd(end);
      localStartRef.current = start;
      localEndRef.current = end;
    }
  }, [start, end, dragging]);

  const calcTimeFromX = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track || clipDuracion <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * clipDuracion;
    },
    [clipDuracion],
  );

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const t = calcTimeFromX(e.clientX);
      if (dragging === "start") {
        const next = Math.max(0, Math.min(t, localEndRef.current - 0.1));
        localStartRef.current = next;
        setLocalStart(next);
      } else {
        const next = Math.max(
          localStartRef.current + 0.1,
          Math.min(t, clipDuracion || t),
        );
        localEndRef.current = next;
        setLocalEnd(next);
      }
      // Throttle: emitir onChange como mucho una vez cada LIVE_THROTTLE_MS
      // (~12 veces por segundo). El padre actualiza el preview Remotion y
      // el waveform — esa cadencia se siente fluida sin ahogar React.
      const now = Date.now();
      if (now - lastEmitRef.current >= LIVE_THROTTLE_MS) {
        lastEmitRef.current = now;
        if (pendingEmitRef.current) {
          clearTimeout(pendingEmitRef.current);
          pendingEmitRef.current = null;
        }
        onChange(localStartRef.current, localEndRef.current);
      } else if (!pendingEmitRef.current) {
        // Si rechazamos un emit por throttle, schedulamos uno para el
        // final del intervalo para no perder el ultimo valor.
        const wait = LIVE_THROTTLE_MS - (now - lastEmitRef.current);
        pendingEmitRef.current = setTimeout(() => {
          pendingEmitRef.current = null;
          lastEmitRef.current = Date.now();
          onChange(localStartRef.current, localEndRef.current);
        }, wait);
      }
    };
    const handleUp = () => {
      if (pendingEmitRef.current) {
        clearTimeout(pendingEmitRef.current);
        pendingEmitRef.current = null;
      }
      setDragging(null);
      // Emit final SIN throttle — el valor del state queda alineado al
      // ultimo pixel del drag, exactamente donde el usuario solto el mouse.
      onChange(localStartRef.current, localEndRef.current);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    // Dependencias minimas: el listener accede a los valores vivos via
    // refs, asi que NO los listamos aca. El effect solo se re-inyecta
    // cuando empieza/termina un drag o cambia el clipDuracion.
  }, [dragging, calcTimeFromX, onChange, clipDuracion]);

  // Cleanup del setTimeout al desmontar.
  useEffect(() => {
    return () => {
      if (pendingEmitRef.current) clearTimeout(pendingEmitRef.current);
    };
  }, []);

  if (clipDuracion <= 0) return null;

  const startPct = (localStart / clipDuracion) * 100;
  const endPct = (localEnd / clipDuracion) * 100;

  return (
    <div className="mt-3">
      <div
        ref={trackRef}
        className="relative h-5 select-none rounded-md bg-zinc-900 ring-1 ring-inset ring-zinc-800"
      >
        {/* Zona seleccionada (snippet) */}
        <div
          className="absolute top-0 bottom-0 rounded-md bg-gradient-to-r from-indigo-500/40 to-indigo-400/40 ring-1 ring-inset ring-indigo-400/40"
          style={{
            left: `${startPct}%`,
            width: `${Math.max(0, endPct - startPct)}%`,
          }}
        />
        {/* Handle start */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging("start");
          }}
          className="absolute top-0 bottom-0 -ml-1.5 w-3 cursor-ew-resize rounded bg-indigo-500 shadow-md shadow-indigo-500/30 ring-2 ring-zinc-900 transition-colors hover:bg-indigo-400"
          style={{ left: `${startPct}%` }}
          title="Recortar inicio"
          aria-label="Ajustar inicio"
        />
        {/* Handle end */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging("end");
          }}
          className="absolute top-0 bottom-0 -ml-1.5 w-3 cursor-ew-resize rounded bg-indigo-500 shadow-md shadow-indigo-500/30 ring-2 ring-zinc-900 transition-colors hover:bg-indigo-400"
          style={{ left: `${endPct}%` }}
          title="Recortar fin"
          aria-label="Ajustar fin"
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] tabular-nums text-zinc-600">
        <span>0:00</span>
        <span>clip dura {clipDuracion.toFixed(1)}s</span>
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function DragIcon({ className }: { className?: string }) {
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
      <circle cx="9" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="18" r="1" />
    </svg>
  );
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
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
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
