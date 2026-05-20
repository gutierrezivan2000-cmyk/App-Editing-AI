"use client";

import { useEffect, useRef, useState } from "react";
import type { WordTimestamp } from "@/types";

interface SubtitleEditorProps {
  transcripcion: WordTimestamp[];
  onChange: (next: (prev: WordTimestamp[]) => WordTimestamp[]) => void;
  /** Saltar el preview a un segundo determinado del video. */
  onSeek: (sec: number) => void;
  enfasisPalabras: string[];
  /** Indice seleccionado (sincronizado con timeline/overlay). */
  selectedIdx?: number;
  /** Notificar al padre cuando el usuario selecciona una palabra. */
  onSelect?: (idx: number | undefined) => void;
}

/**
 * Edicion granular de la transcripcion. Por palabra: texto + start + end.
 *
 * UI: lista virtual-ish (cada palabra es una fila compacta) con:
 *   - Indicador de tiempo (clickable -> seek en el player)
 *   - Texto editable inline
 *   - Botones para split (insertar palabra antes/despues) y delete
 *
 * Limitaciones intencionales: NO permitimos cambiar el start de una
 * palabra para que sea posterior al start de la siguiente — eso
 * desordenaria el flujo. Es responsabilidad del editor de snippets si
 * el usuario quiere reordenar.
 */
export function SubtitleEditor({
  transcripcion,
  onChange,
  onSeek,
  enfasisPalabras,
  selectedIdx,
  onSelect,
}: SubtitleEditorProps) {
  const enfasisSet = new Set(enfasisPalabras.map((p) => p.toLowerCase()));
  const [searchQuery, setSearchQuery] = useState("");
  const queryLower = searchQuery.trim().toLowerCase();
  const selectedRowRef = useRef<HTMLLIElement | null>(null);

  // Cuando el padre cambia selectedIdx (por click en overlay o timeline),
  // scrolleamos la fila a la vista.
  useEffect(() => {
    if (selectedIdx !== undefined && selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }, [selectedIdx]);

  const filteredIndices = transcripcion
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => {
      if (!queryLower) return true;
      return w.texto.toLowerCase().includes(queryLower);
    });

  const updateWord = (idx: number, patch: Partial<WordTimestamp>) => {
    onChange((prev) =>
      prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    );
  };

  const deleteWord = (idx: number) => {
    onChange((prev) => prev.filter((_, i) => i !== idx));
  };

  const insertWordAfter = (idx: number) => {
    onChange((prev) => {
      const curr = prev[idx];
      const next = prev[idx + 1];
      // La nueva palabra ocupa el espacio entre curr.end y next.start,
      // o 0.3s despues de curr si no hay siguiente.
      const newStart = curr.end;
      const newEnd = next
        ? Math.min(curr.end + 0.3, (curr.end + next.start) / 2)
        : curr.end + 0.3;
      const newWord: WordTimestamp = {
        texto: "",
        start: newStart,
        end: newEnd,
        enfasis: false,
      };
      const copy = [...prev];
      copy.splice(idx + 1, 0, newWord);
      return copy;
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header con búsqueda */}
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar palabra…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              title="Limpiar"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-500">
          <span className="tabular-nums text-zinc-300">{transcripcion.length}</span>{" "}
          palabras
          {queryLower && (
            <>
              {" "}
              ·{" "}
              <span className="tabular-nums text-indigo-300">
                {filteredIndices.length}
              </span>{" "}
              coinciden
            </>
          )}
        </p>
      </div>

      {/* Lista */}
      <ul className="flex-1 divide-y divide-zinc-800/60 overflow-y-auto scrollbar-dark">
        {filteredIndices.length === 0 && (
          <li className="flex flex-col items-center justify-center gap-2 p-8 text-center text-xs text-zinc-500">
            <SearchIcon className="h-6 w-6 text-zinc-700" />
            {transcripcion.length === 0
              ? "Sin transcripción todavía."
              : "Ninguna palabra coincide con la búsqueda."}
          </li>
        )}
        {filteredIndices.map(({ w, i }) => {
          const cleanTexto = w.texto.toLowerCase().replace(/[.,!?¿¡:;"'()]/g, "");
          const isEnfasis = enfasisSet.has(cleanTexto);
          const isSelected = selectedIdx === i;
          return (
            <li
              key={i}
              ref={isSelected ? selectedRowRef : null}
              className={[
                "group relative px-3 py-2 transition-colors",
                isSelected
                  ? "bg-amber-500/10"
                  : "hover:bg-zinc-800/40",
              ].join(" ")}
              onClick={() => onSelect?.(i)}
            >
              {/* Barra lateral indicadora si está seleccionado */}
              {isSelected && (
                <span className="absolute inset-y-0 left-0 w-0.5 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(w.start);
                  }}
                  className="flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-500 transition-colors hover:bg-indigo-500/20 hover:text-indigo-300"
                  title="Saltar a este punto en el preview"
                >
                  {formatTime(w.start)}
                </button>
                <input
                  type="text"
                  value={w.texto}
                  onChange={(e) =>
                    updateWord(i, { texto: e.target.value })
                  }
                  onFocus={() => onSelect?.(i)}
                  className={[
                    "flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm transition-all focus:border-indigo-500/60 focus:bg-zinc-950 focus:outline-none focus:ring-1 focus:ring-indigo-500/30",
                    isEnfasis
                      ? "font-semibold text-amber-300"
                      : "text-zinc-100",
                  ].join(" ")}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    insertWordAfter(i);
                  }}
                  className="hidden flex-shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-indigo-500/20 hover:text-indigo-300 group-hover:block"
                  title="Insertar palabra después"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteWord(i);
                  }}
                  className="hidden flex-shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-red-500/20 hover:text-red-300 group-hover:block"
                  title="Borrar palabra"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Editores de start/end visibles solo si la palabra está hovered/selected */}
              <div
                className={[
                  "ml-12 mt-1 flex gap-2 text-[10px] text-zinc-500",
                  isSelected ? "flex" : "hidden group-hover:flex",
                ].join(" ")}
              >
                <label className="flex items-center gap-1">
                  <span className="uppercase tracking-wider text-zinc-600">
                    inicio
                  </span>
                  <input
                    type="number"
                    value={w.start.toFixed(2)}
                    step="0.05"
                    min={0}
                    onChange={(e) =>
                      updateWord(i, { start: Number(e.target.value) })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-[10px] tabular-nums text-zinc-300 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="uppercase tracking-wider text-zinc-600">
                    fin
                  </span>
                  <input
                    type="number"
                    value={w.end.toFixed(2)}
                    step="0.05"
                    min={0}
                    onChange={(e) =>
                      updateWord(i, { end: Number(e.target.value) })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-[10px] tabular-nums text-zinc-300 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <span className="font-mono tabular-nums text-zinc-600">
                  {(w.end - w.start).toFixed(2)}s
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function SearchIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
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
      <path d="M5 12h14" />
      <path d="M12 5v14" />
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
