"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import type { SnippetPlan, WordTimestamp } from "@/types";

interface EditorStatusBarProps {
  playerRef: React.RefObject<PlayerRef | null>;
  fps: number;
  transcripcion: WordTimestamp[];
  snippets: SnippetPlan[];
  pastSize: number;
  futureSize: number;
  pendingChanges: boolean;
}

/**
 * Barra de estado en el footer del editor. Muestra info contextual en
 * vivo: tiempo actual, palabra activa, índice de snippet, conteo de
 * cambios deshacibles. Sirve para que el usuario tenga señales visuales
 * constantes de QUÉ está pasando.
 *
 * Sincroniza el tiempo via `frameupdate` del Player con manipulación
 * directa del DOM (no setState por frame) — el resto sí re-renderiza
 * cuando las props del padre cambian.
 */
export function EditorStatusBar({
  playerRef,
  fps,
  transcripcion,
  snippets,
  pastSize,
  futureSize,
  pendingChanges,
}: EditorStatusBarProps) {
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handler: Parameters<PlayerRef["addEventListener"]>[1] = (e) => {
      const detail = (e as CustomEvent<{ frame: number }>).detail;
      if (!detail || typeof detail.frame !== "number") return;
      // Texto del tiempo lo updateamos directo en el DOM (sin re-render).
      const el = timeRef.current;
      if (el) el.textContent = formatTime(detail.frame / fps);
      // currentFrame para calcular palabra/snippet activos: solo updateamos
      // cuando es necesario (cada ~10 frames) para no spammar re-renders.
      setCurrentFrame((prev) => {
        if (Math.abs(prev - detail.frame) >= Math.max(1, Math.floor(fps / 5))) {
          return detail.frame;
        }
        return prev;
      });
    };
    player.addEventListener("frameupdate", handler);
    return () => {
      player.removeEventListener("frameupdate", handler);
    };
  }, [playerRef, fps]);

  const sec = currentFrame / fps;

  // Palabra activa
  let activeWord: WordTimestamp | null = null;
  for (const w of transcripcion) {
    if (sec >= w.start && sec < w.end) {
      activeWord = w;
      break;
    }
    if (sec < w.start) break;
  }

  // Snippet activo (acumulado timeline final)
  let activeSnippetIdx = -1;
  {
    let acc = 0;
    for (let i = 0; i < snippets.length; i++) {
      const dur = snippets[i].end - snippets[i].start;
      if (sec >= acc && sec < acc + dur) {
        activeSnippetIdx = i;
        break;
      }
      acc += dur;
    }
  }

  return (
    <footer className="flex h-7 flex-shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-950 px-3 text-[11px] text-zinc-400">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 font-mono tabular-nums">
          <ClockMicroIcon className="h-3 w-3 text-zinc-500" />
          <span ref={timeRef} className="text-zinc-200">
            {formatTime(sec)}
          </span>
        </span>
        {activeWord && (
          <>
            <Separator />
            <span className="flex items-center gap-1.5">
              <WordIcon className="h-3 w-3 text-zinc-600" />
              <span className="text-zinc-600">palabra</span>
              <span className="font-medium text-zinc-200">
                {activeWord.texto}
              </span>
            </span>
          </>
        )}
        {activeSnippetIdx >= 0 && (
          <>
            <Separator />
            <span className="flex items-center gap-1.5">
              <FilmIcon className="h-3 w-3 text-zinc-600" />
              <span className="text-zinc-600">snippet</span>
              <span className="font-mono tabular-nums text-zinc-200">
                #{activeSnippetIdx + 1}
                <span className="text-zinc-600">/{snippets.length}</span>
              </span>
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {pendingChanges && (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-300 ring-1 ring-inset ring-amber-500/20">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.6)]" />
            <span>cambios sin guardar</span>
          </span>
        )}
        <span className="flex items-center gap-1.5 text-zinc-500">
          <HistoryIcon className="h-3 w-3" />
          <span>
            <span className="font-mono tabular-nums text-zinc-300">
              {pastSize}
            </span>
            {futureSize > 0 && (
              <>
                <span className="text-zinc-700"> / </span>
                <span className="font-mono tabular-nums text-zinc-500">
                  {futureSize}
                </span>
              </>
            )}
          </span>
        </span>
      </div>
    </footer>
  );
}

function Separator() {
  return <span className="text-zinc-700">·</span>;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function ClockMicroIcon({ className }: { className?: string }) {
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

function WordIcon({ className }: { className?: string }) {
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
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </svg>
  );
}

function FilmIcon({ className }: { className?: string }) {
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
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18M17 3v18M3 12h18" />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
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
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
