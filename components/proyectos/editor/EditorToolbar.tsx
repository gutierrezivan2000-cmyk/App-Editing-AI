"use client";

import Link from "next/link";

interface EditorToolbarProps {
  projectId: string;
  projectName: string;
  dirty: boolean;
  lastSavedAt: Date | null;
  saving: boolean;
  regenerating: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Indica drift de snippets vs el video_unido original. */
  audioStale: boolean;
  /** Cargando la nueva transcripcion derivada desde clips originales. */
  resyncing: boolean;
  /** Re-renderizando el output (video_unido + exports + MP4 quemado). */
  rerendering: boolean;
  /** Si false, no mostramos el boton resync (no hay drift). */
  canResync: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onRegenerate: () => void;
  onResyncTranscripcion: () => void;
  onRerenderOutput: () => void;
}

/**
 * Toolbar superior del editor. Tres secciones (izq · centro · der) con
 * separadores sutiles. Dark theme tipo CapCut/Descript.
 */
export function EditorToolbar({
  projectId,
  projectName,
  dirty,
  lastSavedAt,
  saving,
  regenerating,
  canUndo,
  canRedo,
  audioStale,
  resyncing,
  rerendering,
  canResync,
  onUndo,
  onRedo,
  onSave,
  onRegenerate,
  onResyncTranscripcion,
  onRerenderOutput,
}: EditorToolbarProps) {
  return (
    <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3">
      {/* IZQUIERDA — back + project name + saved state */}
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={`/dashboard/proyectos/${projectId}`}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          title="Volver al proyecto"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Link>
        <div className="h-5 w-px bg-zinc-800" />
        <div className="flex min-w-0 items-center gap-2 px-1">
          <FilmStripIcon className="h-4 w-4 flex-shrink-0 text-zinc-500" />
          <h1 className="truncate text-sm font-medium text-zinc-100">
            {projectName}
          </h1>
        </div>
        <SavedChip dirty={dirty} lastSavedAt={lastSavedAt} saving={saving} />
      </div>

      {/* CENTRO — undo/redo */}
      <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
        <ToolbarButton
          onClick={onUndo}
          disabled={!canUndo}
          label="Deshacer"
          shortcut="Ctrl+Z"
          icon={<UndoIcon className="h-4 w-4" />}
        />
        <div className="h-5 w-px bg-zinc-800" />
        <ToolbarButton
          onClick={onRedo}
          disabled={!canRedo}
          label="Rehacer"
          shortcut="Ctrl+Shift+Z"
          icon={<RedoIcon className="h-4 w-4" />}
        />
      </div>

      {/* DERECHA — save + regenerate + (resync) + rerender */}
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving || !dirty}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-medium text-zinc-200 transition-all hover:border-zinc-600 hover:bg-zinc-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title={dirty ? "Guardar cambios (Ctrl+S)" : "Sin cambios para guardar"}
        >
          <SaveIcon className="h-3.5 w-3.5" />
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button
          onClick={onRegenerate}
          disabled={regenerating || rerendering}
          className="group inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-medium text-zinc-200 transition-all hover:border-zinc-600 hover:bg-zinc-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title="Guardar y regenerar XML / EDL / CapCut / SRT con los cambios (sin tocar el video)"
        >
          <RegenerateIcon
            className={`h-3.5 w-3.5 transition-transform duration-500 ${regenerating ? "animate-spin" : "group-hover:rotate-180"}`}
          />
          {regenerating ? "Regenerando…" : "Regenerar editables"}
        </button>
        {/* Re-sincronizar transcripcion: solo aparece si hay drift de
            snippets vs el video_unido original. */}
        {canResync && (
          <button
            onClick={onResyncTranscripcion}
            disabled={resyncing || rerendering || saving}
            className="group inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-medium text-amber-200 transition-all hover:border-amber-400/60 hover:bg-amber-500/15 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            title={audioStale
              ? "Reordenaste snippets — re-deriva los timestamps de subtitulos desde las transcripciones originales. Atencion: pierde edits manuales de texto."
              : "Re-deriva los timestamps de subtitulos desde las transcripciones originales"}
          >
            <SyncIcon
              className={`h-3.5 w-3.5 ${resyncing ? "animate-spin" : ""}`}
            />
            {resyncing ? "Re-sincronizando…" : "Re-sincronizar subs"}
          </button>
        )}
        <button
          onClick={onRerenderOutput}
          disabled={rerendering || regenerating || saving}
          className="group inline-flex h-8 items-center gap-1.5 rounded-md bg-gradient-to-b from-indigo-500 to-indigo-600 px-3 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition-all hover:from-indigo-400 hover:to-indigo-500 hover:shadow-indigo-500/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          title="Re-armar el video final con los cambios — encola un job que regenera video_unido, exports y (si aplica) MP4 con subs quemados"
        >
          <FilmIcon
            className={`h-3.5 w-3.5 ${rerendering ? "animate-pulse" : ""}`}
          />
          {rerendering ? "Encolando…" : "Re-render final"}
        </button>
      </div>
    </header>
  );
}

function SavedChip({
  dirty,
  lastSavedAt,
  saving,
}: {
  dirty: boolean;
  lastSavedAt: Date | null;
  saving: boolean;
}) {
  if (saving) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
        Guardando…
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        Sin guardar
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
        <CheckMicroIcon className="h-2.5 w-2.5" />
        {lastSavedAt.toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    );
  }
  return null;
}

function ToolbarButton({
  onClick,
  disabled,
  label,
  shortcut,
  icon,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      {icon}
    </button>
  );
}

// ─── Iconos (Lucide-style stroke-based) ───────────────────────────

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}
function FilmStripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" />
    </svg>
  );
}
function UndoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}
function RedoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </svg>
  );
}
function SaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}
function RegenerateIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}
function CheckMicroIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function SyncIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
function FilmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" />
    </svg>
  );
}
