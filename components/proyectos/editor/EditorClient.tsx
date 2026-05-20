"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { PlayerRef } from "@remotion/player";
import { EditorToolbar } from "./EditorToolbar";
import { EditorStatusBar } from "./EditorStatusBar";
import { RemotionPreview } from "./RemotionPreview";
import { SubtitleEditor } from "./SubtitleEditor";
import { EnfasisEditor } from "./EnfasisEditor";
import { SnippetEditor } from "./SnippetEditor";
import { Timeline } from "./Timeline";
import { SubtitleOverlay } from "./SubtitleOverlay";
import { ToastStack, type ToastMessage } from "./Toast";
import { useEditorHistory } from "@/hooks/useEditorHistory";
import type {
  ClienteProfile,
  ClipMultiSource,
  PlanMulticlip,
  SnippetPlan,
  SubtitulosOverride,
  WordTimestamp,
} from "@/types";

interface EditorClientProps {
  project: {
    id: string;
    nombre: string;
    clienteId: string;
    outputUrl: string;
    clips: ClipMultiSource[];
    planMulticlip: PlanMulticlip;
    subtitulosOverride: SubtitulosOverride | null;
    renderSubtitulos: boolean;
  };
  cliente: ClienteProfile;
  transcripcionInicial: WordTimestamp[];
}

type Tab = "subtitulos" | "enfasis" | "snippets";

/**
 * Estado unificado del editor — todo lo que vive en el undo/redo stack
 * va dentro de este objeto. Si en el futuro agregamos más cosas
 * editables (ej. animación, posición), van acá.
 */
interface EditorState {
  transcripcion: WordTimestamp[];
  snippets: SnippetPlan[];
  enfasisPalabras: string[];
}

export function EditorClient({
  project,
  cliente,
  transcripcionInicial,
}: EditorClientProps) {
  const router = useRouter();

  // ─── Historia: undo/redo unificado para todo el estado editable ───
  const history = useEditorHistory<EditorState>({
    initial: {
      transcripcion: transcripcionInicial,
      snippets: project.planMulticlip.snippets,
      enfasisPalabras: project.planMulticlip.enfasisPalabras,
    },
    debounceMs: 800,
    maxHistorySize: 50,
  });
  const { state, setState: setEditorState, undo, redo, commit, canUndo, canRedo, pastSize, futureSize } = history;
  const { transcripcion, snippets, enfasisPalabras } = state;

  const [tab, setTab] = useState<Tab>("subtitulos");
  const [selectedWordIdx, setSelectedWordIdx] = useState<number | undefined>(
    undefined,
  );
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // dirty = hay cambios en past que el server no conoce.
  const [savedSnapshotSize, setSavedSnapshotSize] = useState(0);
  const dirty = pastSize !== savedSnapshotSize || futureSize > 0;
  const playerRef = useRef<PlayerRef | null>(null);

  // ─── Toast notifications ───
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const pushToast = useCallback(
    (type: ToastMessage["type"], message: string, duration = 2400) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, type, message, duration }]);
    },
    [],
  );
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const subtitulosCfg = useMemo(
    () => ({
      ...cliente.subtitulos,
      ...(project.subtitulosOverride ?? {}),
    }),
    [cliente.subtitulos, project.subtitulosOverride],
  );

  const fps = cliente.exportacion.fps ?? 30;

  // ─── Setters de cada slice del estado, usando setEditorState ───
  const updateTranscripcion = useCallback(
    (
      next:
        | WordTimestamp[]
        | ((prev: WordTimestamp[]) => WordTimestamp[]),
    ) => {
      setEditorState((prev) => ({
        ...prev,
        transcripcion:
          typeof next === "function" ? next(prev.transcripcion) : next,
      }));
    },
    [setEditorState],
  );
  const updateSnippets = useCallback(
    (next: SnippetPlan[] | ((prev: SnippetPlan[]) => SnippetPlan[])) => {
      setEditorState((prev) => ({
        ...prev,
        snippets:
          typeof next === "function" ? next(prev.snippets) : next,
      }));
    },
    [setEditorState],
  );
  const updateEnfasis = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      setEditorState((prev) => ({
        ...prev,
        enfasisPalabras:
          typeof next === "function" ? next(prev.enfasisPalabras) : next,
      }));
    },
    [setEditorState],
  );
  const patchWord = useCallback(
    (idx: number, patch: Partial<WordTimestamp>) => {
      updateTranscripcion((prev) =>
        prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
      );
    },
    [updateTranscripcion],
  );

  const handleSelectWord = useCallback(
    (idx: number | undefined) => {
      setSelectedWordIdx(idx);
      if (idx !== undefined) setTab("subtitulos");
    },
    [],
  );

  // ─── Save / Regenerate ───
  const handleSave = useCallback(async () => {
    if (saving) return;
    commit(); // asegurar que cambios pendientes esten en past
    setSaving(true);
    try {
      const planActualizado: PlanMulticlip = {
        ...project.planMulticlip,
        snippets,
        enfasisPalabras,
      };
      const res = await fetch(`/api/pipeline/${project.id}/editor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcripcion,
          planMulticlip: planActualizado,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pushToast("error", `No se pudo guardar: ${err.error ?? res.statusText}`);
        return;
      }
      setLastSavedAt(new Date());
      setSavedSnapshotSize(pastSize);
      pushToast("success", "Cambios guardados");
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    commit,
    project.id,
    project.planMulticlip,
    snippets,
    enfasisPalabras,
    transcripcion,
    pastSize,
    pushToast,
  ]);

  const handleRegenerate = useCallback(async () => {
    if (regenerating) return;
    if (dirty) {
      await handleSave();
    }
    setRegenerating(true);
    try {
      const res = await fetch(
        `/api/pipeline/${project.id}/regenerate-editables`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pushToast(
          "error",
          `No se pudo regenerar: ${err.error ?? res.statusText}`,
        );
        return;
      }
      pushToast(
        "success",
        "Editables regenerados — descargá los archivos en el detalle del proyecto",
        4000,
      );
    } finally {
      setRegenerating(false);
    }
  }, [regenerating, dirty, handleSave, project.id, pushToast]);

  const handleSeekTo = useCallback(
    (sec: number) => {
      const ref = playerRef.current;
      if (!ref) return;
      ref.seekTo(Math.max(0, Math.round(sec * fps)));
      ref.play();
    },
    [fps],
  );

  // ─── Atajos de teclado ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignorar si el foco esta en un input/textarea editable que NO sea
      // de los inputs principales del editor (queremos que Ctrl+Z funcione
      // incluso si el foco esta en una textbox del panel — pero NO si el
      // usuario quiere undo en el input mismo).
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (
        ctrl &&
        (e.key.toLowerCase() === "y" ||
          (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
      // Space para play/pause solo cuando el foco NO esta en un input.
      if (e.key === " " && !isEditable) {
        e.preventDefault();
        const player = playerRef.current;
        if (!player) return;
        if (player.isPlaying()) player.pause();
        else player.play();
        return;
      }
      // Escape para deseleccionar.
      if (e.key === "Escape") {
        setSelectedWordIdx(undefined);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, handleSave]);

  // ─── Aviso si el usuario intenta cerrar la pestaña con cambios ───
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers modernos ignoran el mensaje y muestran uno propio.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <EditorToolbar
        projectId={project.id}
        projectName={project.nombre}
        dirty={dirty}
        lastSavedAt={lastSavedAt}
        saving={saving}
        regenerating={regenerating}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSave={handleSave}
        onRegenerate={handleRegenerate}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {/* PREVIEW STAGE — fondo casi negro con gradiente sutil tipo cinematic */}
          <div
            className="relative flex flex-1 min-w-0 items-center justify-center overflow-hidden p-6"
            style={{
              background:
                "radial-gradient(ellipse at center, #0a0a0c 0%, #050507 100%)",
            }}
          >
            {/* Grid pattern decorativo de fondo */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />
            <div className="relative flex w-full max-w-md flex-col items-center">
              {/* Frame del preview con sombra y borde */}
              <div className="relative w-full overflow-hidden rounded-lg border border-zinc-800 shadow-2xl shadow-black/80 ring-1 ring-white/5">
                <RemotionPreview
                  ref={playerRef}
                  videoUrl={project.outputUrl}
                  transcripcion={transcripcion}
                  enfasisPalabras={enfasisPalabras}
                  clienteProfile={{
                    ...cliente,
                    subtitulos: subtitulosCfg,
                  }}
                  // Modo live: el preview reconstruye desde los clips
                  // originales con los snippets actuales — cualquier
                  // recorte/reorden se refleja al instante.
                  clips={project.clips}
                  snippets={snippets}
                />
                <SubtitleOverlay
                  playerRef={playerRef}
                  fps={fps}
                  transcripcion={transcripcion}
                  onChangeWord={patchWord}
                  onSelectWord={handleSelectWord}
                  selectedIdx={selectedWordIdx}
                />
              </div>
              {/* Hint debajo del preview */}
              <p className="mt-3 select-none text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                Vista previa en vivo · Espacio para play/pause
              </p>
            </div>
          </div>

          {/* SIDEBAR — panel lateral con tabs */}
          <aside className="flex w-[420px] flex-shrink-0 flex-col border-l border-zinc-800 bg-zinc-900">
            <div className="flex border-b border-zinc-800 bg-zinc-950/40">
              <TabButton
                active={tab === "subtitulos"}
                onClick={() => setTab("subtitulos")}
                label="Subtítulos"
                count={transcripcion.length}
              />
              <TabButton
                active={tab === "enfasis"}
                onClick={() => setTab("enfasis")}
                label="Énfasis"
                count={enfasisPalabras.length}
              />
              <TabButton
                active={tab === "snippets"}
                onClick={() => setTab("snippets")}
                label="Snippets"
                count={snippets.length}
              />
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-dark">
              {tab === "subtitulos" && (
                <SubtitleEditor
                  transcripcion={transcripcion}
                  onChange={updateTranscripcion}
                  onSeek={handleSeekTo}
                  enfasisPalabras={enfasisPalabras}
                  selectedIdx={selectedWordIdx}
                  onSelect={handleSelectWord}
                />
              )}
              {tab === "enfasis" && (
                <EnfasisEditor
                  enfasisPalabras={enfasisPalabras}
                  onChange={updateEnfasis}
                  transcripcion={transcripcion}
                />
              )}
              {tab === "snippets" && (
                <SnippetEditor
                  snippets={snippets}
                  onChange={updateSnippets}
                  clips={project.clips}
                  onSeek={handleSeekTo}
                />
              )}
            </div>
          </aside>
        </div>

        <div
          className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900"
          style={{ height: 220 }}
        >
          <Timeline
            playerRef={playerRef}
            fps={fps}
            snippets={snippets}
            onSnippetsChange={updateSnippets}
            clips={project.clips}
            transcripcion={transcripcion}
            onWordClick={handleSelectWord}
            selectedWordIdx={selectedWordIdx}
          />
        </div>

        <EditorStatusBar
          playerRef={playerRef}
          fps={fps}
          transcripcion={transcripcion}
          snippets={snippets}
          pastSize={pastSize}
          futureSize={futureSize}
          pendingChanges={dirty}
        />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "relative flex-1 px-3 py-3 text-xs font-medium transition-all",
        active
          ? "text-zinc-100"
          : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300",
      ].join(" ")}
    >
      {label}
      {typeof count === "number" && (
        <span
          className={[
            "ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
            active
              ? "bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/30"
              : "bg-zinc-800 text-zinc-500",
          ].join(" ")}
        >
          {count}
        </span>
      )}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
      )}
    </button>
  );
}
