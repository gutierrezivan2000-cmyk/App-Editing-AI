"use client";

import { useMemo, useState } from "react";
import type { WordTimestamp } from "@/types";

interface EnfasisEditorProps {
  enfasisPalabras: string[];
  onChange: (next: (prev: string[]) => string[]) => void;
  /** Para sugerir palabras frecuentes de la transcripcion. */
  transcripcion: WordTimestamp[];
}

/**
 * Edicion de palabras de énfasis. Estas son las palabras que el render
 * Remotion y los exports (CapCut, SRT) resaltan visualmente (color
 * distinto, tamano mayor segun la animacion).
 *
 * Permite:
 *   - Agregar palabras (chip + input)
 *   - Quitar (X en cada chip)
 *   - Sugerir desde palabras frecuentes de la transcripcion
 */
export function EnfasisEditor({
  enfasisPalabras,
  onChange,
  transcripcion,
}: EnfasisEditorProps) {
  const [input, setInput] = useState("");

  const normalizedSet = useMemo(
    () => new Set(enfasisPalabras.map((p) => p.toLowerCase())),
    [enfasisPalabras],
  );

  const sugerencias = useMemo(() => {
    // Top 12 palabras mas frecuentes de la transcripcion que NO esten ya
    // en enfasis y tengan al menos 4 chars (filtrar conectores cortos).
    const freq = new Map<string, number>();
    for (const w of transcripcion) {
      const clean = w.texto
        .toLowerCase()
        .replace(/[.,!?¿¡:;"'()]/g, "")
        .trim();
      if (clean.length < 4) continue;
      if (normalizedSet.has(clean)) continue;
      freq.set(clean, (freq.get(clean) ?? 0) + 1);
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([w]) => w);
  }, [transcripcion, normalizedSet]);

  const addWord = (raw: string) => {
    const clean = raw
      .toLowerCase()
      .replace(/[.,!?¿¡:;"'()]/g, "")
      .trim();
    if (!clean || normalizedSet.has(clean)) return;
    onChange((prev) => [...prev, clean]);
  };

  const removeWord = (word: string) => {
    onChange((prev) => prev.filter((w) => w !== word));
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-amber-500/10 ring-1 ring-inset ring-amber-500/30">
          <SparkIcon className="h-4 w-4 text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-zinc-100">
            Palabras destacadas
          </h3>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            Se resaltan en los subtítulos (color · tamaño). Ideales para CTAs,
            cifras y conceptos clave.
          </p>
        </div>
      </div>

      {/* Input para agregar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          placeholder="Agregar palabra…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addWord(input);
              setInput("");
            }
          }}
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
        />
        <button
          onClick={() => {
            addWord(input);
            setInput("");
          }}
          disabled={!input.trim()}
          className="inline-flex items-center gap-1 rounded-md bg-gradient-to-b from-indigo-500 to-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm shadow-indigo-500/30 transition-all hover:from-indigo-400 hover:to-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Añadir
        </button>
      </div>

      {/* Chips actuales */}
      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Activas
          <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500/15 px-1.5 py-0 text-[10px] tabular-nums text-amber-300 ring-1 ring-inset ring-amber-500/30">
            {enfasisPalabras.length}
          </span>
        </h4>
        {enfasisPalabras.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {enfasisPalabras.map((w) => (
              <span
                key={w}
                className="group inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 transition-colors hover:border-amber-500/50 hover:bg-amber-500/15"
              >
                {w}
                <button
                  onClick={() => removeWord(w)}
                  className="-mr-0.5 rounded-full p-0.5 text-amber-400/70 transition-colors hover:bg-amber-500/30 hover:text-amber-100"
                  aria-label={`Quitar ${w}`}
                  title="Quitar"
                >
                  <XIcon className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/50 px-3 py-2.5 text-center text-xs text-zinc-500">
            Sin palabras destacadas todavía.
          </p>
        )}
      </div>

      {/* Sugerencias */}
      {sugerencias.length > 0 && (
        <div>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Sugerencias
            <span className="ml-1 normal-case text-zinc-600">
              · más frecuentes en la transcripción
            </span>
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {sugerencias.map((w) => (
              <button
                key={w}
                onClick={() => addWord(w)}
                className="group inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-zinc-400 transition-all hover:border-indigo-500/60 hover:bg-indigo-500/10 hover:text-indigo-200 active:scale-95"
              >
                <PlusIcon className="h-2.5 w-2.5 text-zinc-600 transition-colors group-hover:text-indigo-300" />
                {w}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SparkIcon({ className }: { className?: string }) {
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
      <path d="M12 3v18M5 8l14 8M5 16l14-8" />
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

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
