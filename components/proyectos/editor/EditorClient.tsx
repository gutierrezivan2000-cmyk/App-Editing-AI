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
import { StyleEditor } from "./StyleEditor";
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

type Tab = "subtitulos" | "enfasis" | "snippets" | "estilo";

/**
 * Estado unificado del editor — todo lo que vive en el undo/redo stack
 * va dentro de este objeto. Si en el futuro agregamos más cosas
 * editables (ej. animación, posición), van acá.
 */
interface EditorState {
  transcripcion: WordTimestamp[];
  snippets: SnippetPlan[];
  enfasisPalabras: string[];
  /** null = sin override; usar 100% el del cliente. */
  subtitulosOverride: SubtitulosOverride | null;
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
      subtitulosOverride: project.subtitulosOverride,
    },
    debounceMs: 800,
    maxHistorySize: 50,
  });
  const { state, setState: setEditorState, undo, redo, commit, canUndo, canRedo, pastSize, futureSize } = history;
  const { transcripcion, snippets, enfasisPalabras, subtitulosOverride } = state;

  const [tab, setTab] = useState<Tab>("subtitulos");
  const [selectedWordIdx, setSelectedWordIdx] = useState<number | undefined>(
    undefined,
  );
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // dirty = el estado actual NO coincide con lo que tiene el server.
  //
  // Antes usabamos `pastSize !== savedSnapshotSize || futureSize > 0`, lo
  // que daba un falso positivo: si el usuario hacia Save -> Edit -> Undo,
  // el state actual volvia a coincidir con lo guardado pero `futureSize=1`
  // dejaba dirty=true y el boton Save quedaba habilitado sin razon.
  //
  // Ahora comparamos por identidad referencial cada slice del state contra
  // el snapshot que se guardo. setEditorState siempre genera un objeto
  // nuevo con spread, pero los slices que NO cambian conservan su identidad
  // — undo a un estado previo recupera las MISMAS referencias que estaban
  // al momento de ese commit, asi que la comparacion shallow detecta
  // correctamente "estoy en el mismo estado que cuando guarde".
  const [savedSnapshot, setSavedSnapshot] = useState<EditorState | null>(null);
  const dirty = useMemo(() => {
    if (!savedSnapshot) {
      // Nunca guardamos: dirty si hay historial (osea, hubo edits).
      return pastSize > 0 || futureSize > 0;
    }
    return (
      state.transcripcion !== savedSnapshot.transcripcion ||
      state.snippets !== savedSnapshot.snippets ||
      state.enfasisPalabras !== savedSnapshot.enfasisPalabras ||
      state.subtitulosOverride !== savedSnapshot.subtitulosOverride
    );
  }, [state, savedSnapshot, pastSize, futureSize]);
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
      ...(subtitulosOverride ?? {}),
    }),
    [cliente.subtitulos, subtitulosOverride],
  );

  // Snippets originales que dieron lugar al video_unido.mp4 actual. El
  // waveform corresponde a ESE audio — si el usuario reordena, recorta o
  // borra snippets, los tiempos del waveform dejan de coincidir con lo que
  // reproduce el preview en modo live. Detectamos drift comparando contra
  // un snapshot inicial inmutable.
  const initialSnippetsRef = useRef(project.planMulticlip.snippets);
  const audioStale = useMemo(() => {
    const initial = initialSnippetsRef.current;
    if (snippets.length !== initial.length) return true;
    for (let i = 0; i < snippets.length; i++) {
      const a = snippets[i];
      const b = initial[i];
      if (
        a.clipIndex !== b.clipIndex ||
        Math.abs(a.start - b.start) > 0.01 ||
        Math.abs(a.end - b.end) > 0.01
      ) {
        return true;
      }
    }
    return false;
  }, [snippets]);

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
  const updateSubtitulosOverride = useCallback(
    (next: SubtitulosOverride | null) => {
      setEditorState((prev) => ({ ...prev, subtitulosOverride: next }));
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
      // PATCH acepta subtitulosOverride opcional. Mandamos siempre el valor
      // efectivo del estado — `null` se serializa pero updateProject hace
      // COALESCE, asi que para "borrar el override" hace falta mandar
      // explicitamente un objeto vacio. Por simplicidad, si null lo omitimos.
      const body: Record<string, unknown> = {
        transcripcion,
        planMulticlip: planActualizado,
      };
      if (subtitulosOverride !== null) {
        body.subtitulosOverride = subtitulosOverride;
      }
      const res = await fetch(`/api/pipeline/${project.id}/editor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pushToast("error", `No se pudo guardar: ${err.error ?? res.statusText}`);
        return;
      }
      setLastSavedAt(new Date());
      // Guardamos un snapshot del state que acabamos de persistir. Como
      // useEditorHistory hace setStateInternal(curr -> curr) en commit, el
      // `state` que vemos aca tiene la misma identidad de slices que va a
      // tener el `lastCommittedRef` interno. Cualquier undo posterior que
      // pase por ese commit va a recuperar las mismas referencias y
      // dirty va a evaluar a false correctamente.
      setSavedSnapshot(state);
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
    subtitulosOverride,
    transcripcion,
    state,
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

  const handleResyncTranscripcion = useCallback(async () => {
    if (resyncing || rerendering) return;
    // Confirm: la operacion DESCARTA las edits manuales de texto en la
    // transcripcion. Necesitamos asegurarnos de que el usuario lo entiende.
    const confirmed =
      typeof window !== "undefined" &&
      window.confirm(
        "Re-sincronizar va a regenerar la transcripcion desde los clips originales para que coincida con el nuevo orden de snippets.\n\n" +
          "ADVERTENCIA: las edits manuales de texto que hayas hecho en la transcripcion se van a perder.\n\n" +
          "¿Continuar?",
      );
    if (!confirmed) return;
    setResyncing(true);
    try {
      const res = await fetch(
        `/api/pipeline/${project.id}/resync-transcripcion`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pushToast(
          "error",
          `No se pudo re-sincronizar: ${err.error ?? res.statusText}`,
        );
        return;
      }
      const data = (await res.json()) as {
        ok: boolean;
        transcripcion: WordTimestamp[];
        palabras: number;
      };
      updateTranscripcion(data.transcripcion);
      pushToast(
        "success",
        `Transcripcion re-sincronizada (${data.palabras} palabras). Guarda los cambios cuando estes listo.`,
        3500,
      );
    } finally {
      setResyncing(false);
    }
  }, [resyncing, rerendering, project.id, pushToast, updateTranscripcion]);

  const handleRerenderOutput = useCallback(async () => {
    if (rerendering || regenerating) return;
    // Avisamos del caveat si hay drift de snippets. Si no hay drift, la
    // confirmacion es mas suave (solo "esto encola un job de N min").
    const driftWarning = audioStale
      ? "ATENCION: detectamos que reordenaste snippets desde la ultima vez que se armo el video. Los subtitulos pueden quedar mal sincronizados.\n\n" +
        "Recomendado: cancela y dale primero a 'Re-sincronizar subs'.\n\n"
      : "";
    const renderNote = project.renderSubtitulos
      ? "Incluye render del MP4 con subtitulos quemados (5-15 min). "
      : "Solo regenera el video_unido y los editables (2-5 min). ";
    const confirmed =
      typeof window !== "undefined" &&
      window.confirm(
        driftWarning +
          renderNote +
          "Vas a volver al detalle del proyecto para ver el progreso.\n\n" +
          "¿Encolar el re-render?",
      );
    if (!confirmed) return;

    setRerendering(true);
    try {
      if (dirty) {
        await handleSave();
      }
      const res = await fetch(`/api/pipeline/${project.id}/rerender-output`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pushToast(
          "error",
          `No se pudo encolar el re-render: ${err.error ?? res.statusText}`,
        );
        return;
      }
      pushToast(
        "info",
        "Re-render encolado. Te llevo al detalle del proyecto para ver el progreso.",
        3000,
      );
      // Pequena pausa para que el toast se vea antes de la navegacion.
      setTimeout(() => {
        router.push(`/dashboard/proyectos/${project.id}`);
      }, 600);
    } finally {
      setRerendering(false);
    }
  }, [
    rerendering,
    regenerating,
    audioStale,
    project.renderSubtitulos,
    project.id,
    dirty,
    handleSave,
    pushToast,
    router,
  ]);

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
        audioStale={audioStale}
        resyncing={resyncing}
        rerendering={rerendering}
        canResync={audioStale}
        onUndo={undo}
        onRedo={redo}
        onSave={handleSave}
        onRegenerate={handleRegenerate}
        onResyncTranscripcion={handleResyncTranscripcion}
        onRerenderOutput={handleRerenderOutput}
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
              <TabButton
                active={tab === "estilo"}
                onClick={() => setTab("estilo")}
                label="Estilo"
                dot={subtitulosOverride !== null}
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
              {tab === "estilo" && (
                <StyleEditor
                  value={subtitulosOverride}
                  onChange={updateSubtitulosOverride}
                  cliente={cliente}
                />
              )}
            </div>
          </aside>
        </div>

        <div
          className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900"
          // 280px = toolbar(~32) + ruler(26) + 2*track(112) + 3*gap(18) +
          //        audio_track(48) + gap(6) + margenes(~38)
          style={{ height: 280 }}
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
            audioUrl={project.outputUrl || undefined}
            audioStale={audioStale}
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
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  /** Punto indicador (estado activo/dirty) en lugar de contador numerico. */
  dot?: boolean;
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
      {dot && (
        <span
          className={[
            "ml-1.5 inline-block h-1.5 w-1.5 rounded-full",
            active
              ? "bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.7)]"
              : "bg-indigo-500/60",
          ].join(" ")}
          aria-hidden
        />
      )}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
      )}
    </button>
  );
}
