"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { isCancelled } from "@/lib/pipeline-cancel";
import type {
  ClipMultiSource,
  PipelineProgress,
  PlanMulticlip,
  Proyecto,
} from "@/types";

interface CorteIA {
  start: number;
  end: number;
  razon: "silencio" | "error" | "repeticion" | "muletilla" | "off-topic" | "otro";
  explicacion: string;
}

interface CortesAnalysis {
  cortes: CorteIA[];
  observaciones: string;
}

interface StatusResponse {
  status: Proyecto["status"];
  renderMethod: Proyecto["renderMethod"];
  outputUrl: string | null;
  xmlUrl: string | null;
  edlUrl: string | null;
  capcutUrl: string | null;
  srtUrl: string | null;
  renderSubtitulos: boolean;
  cortesAnalysis: CortesAnalysis | null;
  keepSegmentsCount: number | null;
  duracionSeg: number | null;
  clips: ClipMultiSource[] | null;
  guion: string | null;
  planMulticlip: PlanMulticlip | null;
  errorMessage: string | null;
  progress: PipelineProgress | null;
  updatedAt: string;
}

const STEPS_ORIGINAL = [
  "Descarga de footage",
  "Detección de silencios",
  "Transcripción Whisper",
  "Orquestación Claude",
  "Corte FFmpeg",
  "Render Remotion",
  "Finalizado",
];

const STEPS_MIRAGE = [
  "Descarga de footage",
  "Detección de silencios",
  "Orquestación Claude",
  "Corte FFmpeg",
  "Render Captions.ai",
  "Finalizado",
];

const STEPS_CORTES = [
  "Descarga de footage",
  "Detección de silencios + metadata + audio",
  "Transcripción Whisper",
  "Análisis Claude (silencios + errores + repeticiones)",
  "Generación XML / EDL / CapCut",
  "Corte FFmpeg",
  "Render Remotion con subtítulos",
  "Finalizado",
];

const STEPS_MULTICLIP = [
  "Análisis de cada clip (metadata + audio)",
  "Transcripción Whisper de cada clip",
  "Plan Claude (orden + cortes + énfasis)",
  "Concatenación FFmpeg multi-source",
  "Ajuste de transcripción a la timeline final",
  "Generación XML / EDL / CapCut / SRT",
  "Finalizado",
];

// Cuando el usuario pidio `renderSubtitulos: true`, insertamos un paso extra
// de render Remotion entre la generacion de exports y el finalizado.
const STEPS_MULTICLIP_CON_QUEMADO = [
  "Análisis de cada clip (metadata + audio)",
  "Transcripción Whisper de cada clip",
  "Plan Claude (orden + cortes + énfasis)",
  "Concatenación FFmpeg multi-source",
  "Ajuste de transcripción a la timeline final",
  "Generación XML / EDL / CapCut / SRT",
  "Render MP4 con subtítulos quemados",
  "Finalizado",
];

const RAZON_LABEL: Record<CorteIA["razon"], { label: string; color: string }> = {
  silencio: { label: "Silencio", color: "bg-gray-100 text-gray-700" },
  error: { label: "Error / corrección", color: "bg-red-50 text-red-700" },
  repeticion: { label: "Repetición", color: "bg-amber-50 text-amber-700" },
  muletilla: { label: "Muletilla", color: "bg-yellow-50 text-yellow-800" },
  "off-topic": { label: "Off-topic", color: "bg-purple-50 text-purple-700" },
  otro: { label: "Otro", color: "bg-gray-100 text-gray-700" },
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/**
 * Heuristica para inferir el step ACTUAL del pipeline a partir de los campos
 * que ya estan poblados en DB. Antes mostrabamos siempre Math.floor(N/2) que
 * era un mentira visual. Ahora cada step se ilumina segun evidencia real.
 */
function computeStepIndex(
  data: StatusResponse,
  totalSteps: number
): number {
  if (data.status === "pending") return 0;
  if (data.status === "completed") return totalSteps;
  // Si el pipeline esta reportando progress en vivo, priorizalo. Refleja
  // el step REAL en el que esta el pipeline, no inferido de campos.
  if (data.progress) {
    return Math.max(0, Math.min(data.progress.step, totalSteps));
  }
  // Fallback: heuristica por campos poblados. Util cuando el progress
  // todavia no se reporto (primeros segundos del pipeline).
  return computeProcessingStep(data);
}

function computeProcessingStep(data: StatusResponse): number {
  if (data.renderMethod === "multiclip") {
    // STEPS_MULTICLIP (7 steps tras eliminar Render Remotion):
    //  0 Analisis (clips con metadata)  → data.clips poblado con widths/fps
    //  1 Transcripcion (sin campo DB)
    //  2 Plan Claude                    → data.planMulticlip
    //  3 Concat FFmpeg                  → data.outputUrl (video_unido)
    //  4 Ajuste transcripcion           (sin campo DB)
    //  5 Generacion XML/EDL/CapCut/SRT → data.xmlUrl + edlUrl + capcutUrl
    //  6 Finalizado
    if (data.xmlUrl && data.edlUrl && data.capcutUrl) return 6;
    if (data.outputUrl) return 4;
    if (data.planMulticlip) return 3;
    if (data.clips && data.clips.some((c) => c.width)) return 1;
    return 0;
  }
  if (data.renderMethod === "cortes") {
    if (data.xmlUrl && data.outputUrl) return 7;
    if (data.outputUrl) return 6;
    if (data.cortesAnalysis) return 4;
    return 0;
  }
  // original / mirage
  if (data.outputUrl) return 6;
  return 0;
}

interface PipelineStatusProps {
  projectId: string;
  initialStatus: Proyecto["status"];
  renderMethod: Proyecto["renderMethod"];
  onCompleted?: (outputUrl: string) => void;
}

export const PipelineStatus = ({
  projectId,
  initialStatus,
  renderMethod,
  onCompleted,
}: PipelineStatusProps) => {
  const router = useRouter();
  const [data, setData] = useState<StatusResponse>({
    status: initialStatus,
    renderMethod,
    outputUrl: null,
    xmlUrl: null,
    edlUrl: null,
    capcutUrl: null,
    srtUrl: null,
    renderSubtitulos: false,
    cortesAnalysis: null,
    keepSegmentsCount: null,
    duracionSeg: null,
    clips: null,
    guion: null,
    planMulticlip: null,
    errorMessage: null,
    progress: null,
    updatedAt: new Date().toISOString(),
  });
  const [retrying, setRetrying] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // onCompleted reference para no re-disparar el efecto cuando cambia.
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    // Polling adaptativo: 1.5s mientras processing (UI responsive), 8s en
    // pending (espera lenta), 0 si completed/error (no polleamos mas).
    const intervalFor = (s: Proyecto["status"]): number => {
      if (s === "processing") return 1500;
      if (s === "pending") return 3000;
      return 0;
    };

    const fetchStatus = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/pipeline/${projectId}/status`, {
          cache: "no-store",
        });
        if (!res.ok) {
          schedule(5000);
          return;
        }
        const fresh: StatusResponse = await res.json();
        if (cancelled) return;
        setData((prev) => {
          // Si cambia de no-completed a completed, disparar el callback UNA vez.
          if (
            prev.status !== "completed" &&
            fresh.status === "completed" &&
            fresh.outputUrl
          ) {
            onCompletedRef.current?.(fresh.outputUrl);
          }
          return fresh;
        });
        const next = intervalFor(fresh.status);
        if (next > 0) schedule(next);
      } catch {
        schedule(5000);
      }
    };

    const schedule = (ms: number) => {
      if (cancelled) return;
      timeoutId = setTimeout(fetchStatus, ms);
    };

    // Primera llamada inmediata; despues self-schedule segun el status.
    fetchStatus();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [projectId]);

  const steps =
    data.renderMethod === "multiclip"
      ? data.renderSubtitulos
        ? STEPS_MULTICLIP_CON_QUEMADO
        : STEPS_MULTICLIP
      : data.renderMethod === "cortes"
        ? STEPS_CORTES
        : data.renderMethod === "mirage"
          ? STEPS_MIRAGE
          : STEPS_ORIGINAL;

  const stepIndex = computeStepIndex(data, steps.length);

  const isCortes = data.renderMethod === "cortes";
  const isMulticlip = data.renderMethod === "multiclip";
  const showProjectFiles = isCortes || isMulticlip;
  const completed = data.status === "completed";
  const errored = data.status === "error";

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/pipeline/${projectId}/retry`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error desconocido" }));
        alert(`No se pudo reintentar: ${err.error ?? res.statusText}`);
        return;
      }
      // El polling siguiente recoge el nuevo status automaticamente.
      setData((d) => ({ ...d, status: "pending", errorMessage: null }));
    } finally {
      setRetrying(false);
    }
  };

  const handleCancel = async () => {
    if (cancelling) return;
    const sure = window.confirm(
      "¿Cancelar el pipeline?\n\n" +
        "El sandbox puede tardar un par de minutos en liberar recursos, pero el " +
        "proyecto queda marcado como cancelado de inmediato.",
    );
    if (!sure) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/pipeline/${projectId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error desconocido" }));
        alert(`No se pudo cancelar: ${err.error ?? res.statusText}`);
        return;
      }
      // Optimistic update — el polling siguiente confirma el nuevo estado.
      setData((d) => ({
        ...d,
        status: "error",
        errorMessage: "Cancelado por el usuario",
      }));
    } finally {
      setCancelling(false);
    }
  };

  const handleDuplicate = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const res = await fetch(`/api/pipeline/${projectId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encolar: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error desconocido" }));
        alert(`No se pudo duplicar: ${err.error ?? res.statusText}`);
        return;
      }
      const body = await res.json();
      router.push(`/dashboard/proyectos/${body.projectId}`);
    } finally {
      setDuplicating(false);
    }
  };

  const isActive = data.status === "pending" || data.status === "processing";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge status={data.status} />
        {data.status === "processing" && (
          <span className="text-sm text-gray-500 flex items-center gap-2">
            <SpinnerIcon className="h-3.5 w-3.5 animate-spin text-indigo-500" />
            <span>Paso {Math.min(stepIndex + 1, steps.length)} de {steps.length}</span>
          </span>
        )}
        {isActive && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Cancelar el pipeline. El sandbox puede tardar un par de minutos en liberar."
          >
            <CrossIcon className="h-3 w-3" />
            {cancelling ? "Cancelando…" : "Cancelar pipeline"}
          </button>
        )}
        {data.status === "pending" && (
          <span className="text-sm text-gray-500">En cola, esperando worker…</span>
        )}
      </div>

      {/* Banner del progreso actual — solo en processing y con progress activo */}
      {data.status === "processing" && data.progress && (
        <ProgressBanner
          progress={data.progress}
          onCancelClick={handleCancel}
          cancelling={cancelling}
        />
      )}

      <ol className="space-y-1.5">
        {steps.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex && data.status === "processing";
          const failed = i === stepIndex && data.status === "error";
          return (
            <li
              key={step}
              className={[
                "flex items-center gap-3 text-sm rounded-md px-2 py-1.5 transition-colors",
                active && "bg-indigo-50",
                failed && "bg-red-50",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span
                className={[
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  done
                    ? "bg-green-100 text-green-700"
                    : active
                      ? "bg-indigo-600 text-white"
                      : failed
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-400",
                ].join(" ")}
              >
                {done ? (
                  <CheckIcon className="h-3.5 w-3.5" />
                ) : active ? (
                  <SpinnerIcon className="h-3 w-3 animate-spin" />
                ) : failed ? (
                  <CrossIcon className="h-3 w-3" />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={
                  done
                    ? "text-gray-700"
                    : active
                      ? "font-medium text-indigo-700"
                      : failed
                        ? "font-medium text-red-700"
                        : "text-gray-400"
                }
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>

      {errored && isCancelled(data.errorMessage) && (
        <div className="space-y-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <div className="flex items-center gap-2">
            <InfoIcon className="h-4 w-4 flex-shrink-0" />
            <span>
              <strong>Pipeline cancelado.</strong> Si fue por error, podés
              re-lanzarlo con la misma config.
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleRetry}
              disabled={retrying}
            >
              {retrying ? "Reintentando…" : "Reintentar"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleDuplicate}
              disabled={duplicating}
            >
              {duplicating ? "Duplicando…" : "Duplicar como nuevo"}
            </Button>
          </div>
        </div>
      )}

      {errored && !isCancelled(data.errorMessage) && (
        <div className="space-y-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <div>
            <strong>Error:</strong> {data.errorMessage ?? "Pipeline falló sin mensaje"}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleRetry}
              disabled={retrying}
              className="bg-red-600 hover:bg-red-700"
            >
              {retrying ? "Reintentando…" : "Reintentar"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleDuplicate}
              disabled={duplicating}
            >
              {duplicating ? "Duplicando…" : "Duplicar y reintentar"}
            </Button>
          </div>
        </div>
      )}

      {/* Acciones disponibles cuando el proyecto ya terminó OK */}
      {completed && (
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? "Reintentando…" : "Re-correr pipeline"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleDuplicate}
            disabled={duplicating}
          >
            {duplicating ? "Duplicando…" : "Duplicar como nuevo proyecto"}
          </Button>
        </div>
      )}

      {showProjectFiles && completed && (
        <div className="space-y-4 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Duración final</p>
              <p className="font-medium text-gray-900">
                {data.duracionSeg !== null ? `${data.duracionSeg.toFixed(1)} s` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">
                {isMulticlip ? "Clips fuente" : "Cortes IA"}
              </p>
              <p className="font-medium text-gray-900">
                {isMulticlip
                  ? (data.clips?.length ?? 0)
                  : (data.cortesAnalysis?.cortes.length ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">
                {isMulticlip ? "Snippets en timeline" : "Segmentos finales"}
              </p>
              <p className="font-medium text-gray-900">
                {data.keepSegmentsCount ?? 0}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:flex-wrap">
            {data.outputUrl && (
              <a
                href={`/api/pipeline/${projectId}/download?type=output`}
                className="flex-1 min-w-[180px]"
              >
                <Button className="w-full">
                  <DownloadIcon className="h-4 w-4 mr-1.5" />
                  Vídeo con subtítulos
                </Button>
              </a>
            )}
            {!isMulticlip && (
              <a
                href={`/api/pipeline/${projectId}/download?type=footage`}
                className="flex-1 min-w-[180px]"
              >
                <Button variant="secondary" className="w-full">
                  <DownloadIcon className="h-4 w-4 mr-1.5" />
                  Vídeo original
                </Button>
              </a>
            )}
            {data.xmlUrl && (
              <a
                href={`/api/pipeline/${projectId}/download?type=xml`}
                className="flex-1 min-w-[180px]"
              >
                <Button variant="secondary" className="w-full">
                  <DownloadIcon className="h-4 w-4 mr-1.5" />
                  XML Premiere
                </Button>
              </a>
            )}
            {data.edlUrl && (
              <a
                href={`/api/pipeline/${projectId}/download?type=edl`}
                className="flex-1 min-w-[180px]"
              >
                <Button variant="secondary" className="w-full">
                  <DownloadIcon className="h-4 w-4 mr-1.5" />
                  EDL DaVinci
                </Button>
              </a>
            )}
            {data.capcutUrl && (
              <a
                href={`/api/pipeline/${projectId}/download?type=capcut`}
                className="flex-1 min-w-[180px]"
              >
                <Button variant="secondary" className="w-full">
                  <DownloadIcon className="h-4 w-4 mr-1.5" />
                  {isMulticlip ? "CapCut (con clips)" : "Proyecto CapCut"}
                </Button>
              </a>
            )}
            {data.srtUrl && (
              <a
                href={`/api/pipeline/${projectId}/download?type=srt`}
                className="flex-1 min-w-[180px]"
              >
                <Button variant="secondary" className="w-full">
                  <DownloadIcon className="h-4 w-4 mr-1.5" />
                  Subtítulos (.srt)
                </Button>
              </a>
            )}
          </div>

          {data.outputUrl && (
            <video
              key={data.outputUrl}
              src={data.outputUrl}
              controls
              className="w-full rounded-lg border border-gray-200 bg-black"
              style={{ maxHeight: 480 }}
            />
          )}

          {isCortes && data.cortesAnalysis && data.cortesAnalysis.cortes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Cortes que la IA decidió aplicar
              </p>
              {data.cortesAnalysis.observaciones && (
                <p className="text-xs text-gray-500 italic">
                  {data.cortesAnalysis.observaciones}
                </p>
              )}
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {data.cortesAnalysis.cortes.map((c, idx) => {
                  const style = RAZON_LABEL[c.razon];
                  return (
                    <li
                      key={idx}
                      className="grid grid-cols-[auto_auto_1fr] items-baseline gap-3 px-3 py-2 text-xs"
                    >
                      <span className="font-mono tabular-nums text-gray-700">
                        {formatTime(c.start)} → {formatTime(c.end)}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.color}`}
                      >
                        {style.label}
                      </span>
                      <span className="text-gray-600">{c.explicacion}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {isMulticlip && data.planMulticlip && data.planMulticlip.snippets.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Orden y snippets decididos por la IA
              </p>
              {data.planMulticlip.observaciones && (
                <p className="text-xs text-gray-500 italic">
                  {data.planMulticlip.observaciones}
                </p>
              )}
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {data.planMulticlip.snippets.map((s, idx) => {
                  const clipName =
                    data.clips?.[s.clipIndex]?.name ?? `clip_${s.clipIndex}`;
                  return (
                    <li
                      key={idx}
                      className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 px-3 py-2 text-xs"
                    >
                      <span className="font-mono tabular-nums text-gray-400 w-8 text-right">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-gray-700 truncate">
                          <span className="inline-flex rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5 text-[10px] font-semibold mr-2">
                            #{s.clipIndex} {clipName}
                          </span>
                          {s.razon && <span className="text-gray-500">{s.razon}</span>}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-gray-500">
                        {formatTime(s.start)} → {formatTime(s.end)}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {data.planMulticlip.enfasisPalabras.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1">
                    Énfasis:
                  </span>
                  {data.planMulticlip.enfasisPalabras.map((p) => (
                    <span
                      key={p}
                      className="rounded bg-yellow-50 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Limite de elapsed en un mismo step a partir del cual la UI muestra
 * warning de "posible estancamiento". 15 min cubre el render Remotion
 * mas pesado razonable. Mas que eso es sospechoso.
 *
 * El watchdog server-side (scripts/stuck-pipeline-cron.js) usa 8 min,
 * pero ese chequea updated_at — distinto del elapsed del progress.
 * Mantenemos el umbral del UI mas alto para no asustar antes de tiempo.
 */
const INACTIVITY_WARNING_MS = 15 * 60 * 1000;

interface ProgressBannerProps {
  progress: PipelineProgress;
  onCancelClick?: () => void;
  cancelling?: boolean;
}

/**
 * Banner del progreso actual. Muestra el detail + cronometro vivo desde
 * que arranco el step. Si hay percent, lo muestra como barra. Si el step
 * lleva mucho tiempo (> INACTIVITY_WARNING_MS), muestra warning de
 * inactividad con CTA para cancelar.
 */
function ProgressBanner({ progress, onCancelClick, cancelling }: ProgressBannerProps) {
  const [elapsed, setElapsed] = useState<number>(0);

  useEffect(() => {
    const updateElapsed = () => {
      const start = new Date(progress.startedAt).getTime();
      if (Number.isNaN(start)) {
        setElapsed(0);
        return;
      }
      setElapsed(Math.max(0, Date.now() - start));
    };
    updateElapsed();
    const id = setInterval(updateElapsed, 1000);
    return () => clearInterval(id);
  }, [progress.startedAt]);

  const elapsedStr = formatElapsed(elapsed);
  const looksStuck = elapsed > INACTIVITY_WARNING_MS;

  return (
    <div
      className={[
        "rounded-lg border p-3 transition-colors",
        looksStuck
          ? "border-amber-200 bg-amber-50/70"
          : "border-indigo-100 bg-indigo-50/60",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={[
              "flex items-center gap-2 text-sm font-medium",
              looksStuck ? "text-amber-900" : "text-indigo-900",
            ].join(" ")}
          >
            <SpinnerIcon
              className={[
                "h-4 w-4 flex-shrink-0 animate-spin",
                looksStuck ? "text-amber-600" : "text-indigo-600",
              ].join(" ")}
            />
            <span className="truncate">{progress.label}</span>
          </div>
          {progress.detail && (
            <p
              className={[
                "mt-1 text-xs",
                looksStuck ? "text-amber-700/80" : "text-indigo-700/80",
              ].join(" ")}
            >
              {progress.detail}
            </p>
          )}
        </div>
        <span
          className={[
            "font-mono text-xs tabular-nums",
            looksStuck ? "text-amber-700" : "text-indigo-700",
          ].join(" ")}
          title="Tiempo en este paso"
        >
          {elapsedStr}
        </span>
      </div>
      {typeof progress.percent === "number" && progress.percent >= 0 && (
        <div
          className={[
            "mt-2.5 h-1 overflow-hidden rounded-full",
            looksStuck ? "bg-amber-200" : "bg-indigo-200",
          ].join(" ")}
        >
          <div
            className={[
              "h-full rounded-full transition-all duration-500",
              looksStuck ? "bg-amber-600" : "bg-indigo-600",
            ].join(" ")}
            style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
          />
        </div>
      )}
      {looksStuck && onCancelClick && (
        <div className="mt-3 flex items-start gap-2 border-t border-amber-200 pt-3 text-xs text-amber-800">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <div className="flex-1">
            <p>
              <strong>Sin actividad detectada hace varios minutos.</strong> El
              sandbox podría estar caído. Si esperás más, un watchdog del servidor
              va a marcarlo como error automáticamente, pero podés cancelar
              ahora si querés liberar recursos.
            </p>
            <button
              onClick={onCancelClick}
              disabled={cancelling}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CrossIcon className="h-3 w-3" />
              {cancelling ? "Cancelando…" : "Cancelar pipeline"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${h}h ${String(rem).padStart(2, "0")}m`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Iconos SVG inline ───────────────────────────────────────────────
// Mantenemos componentes mínimos en este archivo para no depender de una
// librería de iconos. Si crece, mover a components/ui/Icons.tsx.

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CrossIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 00-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 3a1 1 0 011 1v8.586l3.293-3.293a1 1 0 011.414 1.414l-5 5a1 1 0 01-1.414 0l-5-5a1 1 0 011.414-1.414L9 12.586V4a1 1 0 011-1z" />
      <path d="M3 16a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}
