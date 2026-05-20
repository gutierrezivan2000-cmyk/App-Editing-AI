"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import type { WordTimestamp } from "@/types";

interface SubtitleOverlayProps {
  playerRef: React.RefObject<PlayerRef | null>;
  fps: number;
  transcripcion: WordTimestamp[];
  onChangeWord: (idx: number, patch: Partial<WordTimestamp>) => void;
  /** Cuándo el usuario clickea una palabra (se selecciona para edición). */
  onSelectWord?: (idx: number) => void;
  /** Índice seleccionado actualmente (highlight + abre editor inline). */
  selectedIdx?: number;
}

/**
 * Overlay sobre el Remotion Player que muestra la línea de subtítulos
 * actual (palabras alrededor del currentFrame) en grande, con la palabra
 * actual destacada.
 *
 * Click en cualquier palabra:
 *   - Selecciona la palabra (el padre puede mostrar editor inline aparte
 *     o resaltar en el panel lateral)
 *   - Salta al inicio de esa palabra en el player
 *
 * Doble click en una palabra abre edición inline DENTRO del overlay
 * (input que reemplaza el texto). Enter o blur confirma.
 *
 * Esto NO modifica los subs que aparecen en el render Remotion — esos
 * los renderiza SubtitulosDinamicos dentro de la composición. El overlay
 * es una capa adicional para edición (mismo tamaño/posición que los
 * subs reales para que la edición se sienta WYSIWYG).
 */
export function SubtitleOverlay({
  playerRef,
  fps,
  transcripcion,
  onChangeWord,
  onSelectWord,
  selectedIdx,
}: SubtitleOverlayProps) {
  // Indice de la palabra cuya ventana de tiempo contiene el currentFrame.
  // Actualizamos via ref para evitar re-render por frame; solo re-render
  // cuando el indice cambia (cuando saltamos de palabra a palabra).
  const [activeWordIdx, setActiveWordIdx] = useState<number>(-1);
  const lastIdxRef = useRef(-1);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // Detector de palabras que acaban de cambiar (texto distinto al render
  // anterior). El componente las pinta con `editor-flash` que se borra
  // solo después de 600ms via CSS animation.
  const prevTextsRef = useRef<string[]>([]);
  const flashedIdsRef = useRef<Map<number, number>>(new Map());
  const [, forceRender] = useState(0);
  useEffect(() => {
    const prev = prevTextsRef.current;
    const now = Date.now();
    let anyFlash = false;
    transcripcion.forEach((w, i) => {
      if (prev[i] !== undefined && prev[i] !== w.texto) {
        flashedIdsRef.current.set(i, now);
        anyFlash = true;
      }
    });
    prevTextsRef.current = transcripcion.map((w) => w.texto);
    if (anyFlash) {
      // Forzar un re-render despues de 700ms para borrar el flash.
      const t = setTimeout(() => forceRender((n) => n + 1), 700);
      return () => clearTimeout(t);
    }
  }, [transcripcion]);
  const isFlashing = (idx: number): boolean => {
    const ts = flashedIdsRef.current.get(idx);
    if (!ts) return false;
    if (Date.now() - ts > 700) {
      flashedIdsRef.current.delete(idx);
      return false;
    }
    return true;
  };

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handler: Parameters<PlayerRef["addEventListener"]>[1] = (e) => {
      const detail = (e as CustomEvent<{ frame: number }>).detail;
      if (!detail || typeof detail.frame !== "number") return;
      const sec = detail.frame / fps;
      // Busqueda lineal del index actual. Para transcripciones < 2000
      // palabras esto es <1ms por frame, OK.
      let idx = -1;
      for (let i = 0; i < transcripcion.length; i++) {
        const w = transcripcion[i];
        if (sec >= w.start && sec < w.end) {
          idx = i;
          break;
        }
        if (sec < w.start) break;
      }
      if (idx !== lastIdxRef.current) {
        lastIdxRef.current = idx;
        setActiveWordIdx(idx);
      }
    };
    player.addEventListener("frameupdate", handler);
    return () => {
      player.removeEventListener("frameupdate", handler);
    };
  }, [playerRef, fps, transcripcion]);

  // Ventana de palabras a mostrar: 4 alrededor de la actual (2 antes, 2 después).
  const winSize = 2;
  const center = activeWordIdx >= 0 ? activeWordIdx : 0;
  const from = Math.max(0, center - winSize);
  const to = Math.min(transcripcion.length, center + winSize + 1);
  const visible = transcripcion.slice(from, to);
  const visibleIndices = visible.map((_, i) => from + i);

  const seekTo = (sec: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(Math.max(0, Math.round(sec * fps)));
  };

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setEditingValue(transcripcion[i]?.texto ?? "");
  };

  const commitEdit = () => {
    if (editingIdx === null) return;
    const trimmed = editingValue.trim();
    if (trimmed.length > 0 && trimmed !== transcripcion[editingIdx]?.texto) {
      onChangeWord(editingIdx, { texto: trimmed });
    }
    setEditingIdx(null);
  };

  if (transcripcion.length === 0) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center">
        <div className="rounded bg-black/40 px-3 py-1 text-xs text-white/80">
          Sin subtítulos
        </div>
      </div>
    );
  }

  if (activeWordIdx === -1 && visible.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[90%] flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-md bg-black/55 px-3 py-2 text-center backdrop-blur-sm">
        {visible.map((w, k) => {
          const realIdx = visibleIndices[k];
          const isActive = realIdx === activeWordIdx;
          const isSelected = realIdx === selectedIdx;
          if (editingIdx === realIdx) {
            return (
              <input
                key={realIdx}
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingIdx(null);
                  }
                }}
                className="min-w-[3ch] rounded border-2 border-indigo-400 bg-white px-1 py-0.5 text-base font-semibold text-gray-900 outline-none"
                style={{ width: `${Math.max(3, editingValue.length + 1)}ch` }}
              />
            );
          }
          const flashing = isFlashing(realIdx);
          return (
            <button
              key={realIdx}
              onClick={(e) => {
                e.stopPropagation();
                onSelectWord?.(realIdx);
                seekTo(w.start);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEdit(realIdx);
              }}
              className={[
                "rounded px-1 py-0.5 text-base font-semibold transition-colors",
                isActive
                  ? "bg-white/95 text-gray-900 shadow"
                  : isSelected
                    ? "bg-amber-300/90 text-amber-900"
                    : "text-white/85 hover:bg-white/15",
                flashing && "editor-flash",
              ]
                .filter(Boolean)
                .join(" ")}
              title="Click para seleccionar · Doble click para editar"
            >
              {w.texto}
            </button>
          );
        })}
      </div>
      {activeWordIdx >= 0 && (
        <span className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full pt-1 font-mono text-[10px] text-white/60">
          {transcripcion[activeWordIdx]
            ? `${formatTime(transcripcion[activeWordIdx].start)} – ${formatTime(transcripcion[activeWordIdx].end)}`
            : ""}
        </span>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}
