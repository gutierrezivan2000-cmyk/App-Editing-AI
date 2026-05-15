"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Proyecto } from "@/types";

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
  cortesAnalysis: CortesAnalysis | null;
  keepSegmentsCount: number | null;
  duracionSeg: number | null;
  errorMessage: string | null;
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
  const [data, setData] = useState<StatusResponse>({
    status: initialStatus,
    renderMethod,
    outputUrl: null,
    xmlUrl: null,
    edlUrl: null,
    capcutUrl: null,
    cortesAnalysis: null,
    keepSegmentsCount: null,
    duracionSeg: null,
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  });

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/pipeline/${projectId}/status`);
        if (!res.ok) return;
        const fresh: StatusResponse = await res.json();
        if (cancelled) return;
        setData(fresh);
        if (fresh.status === "completed" && fresh.outputUrl) {
          onCompleted?.(fresh.outputUrl);
        }
      } catch {
        // silent retry
      }
    };

    fetchStatus();
    if (initialStatus === "completed" || initialStatus === "error") return;

    const interval = setInterval(async () => {
      await fetchStatus();
      if (cancelled) return;
      setData((d) => {
        if (d.status === "completed" || d.status === "error") {
          clearInterval(interval);
        }
        return d;
      });
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, initialStatus, onCompleted]);

  const steps =
    data.renderMethod === "cortes"
      ? STEPS_CORTES
      : data.renderMethod === "mirage"
      ? STEPS_MIRAGE
      : STEPS_ORIGINAL;

  const stepIndex =
    data.status === "pending"
      ? 0
      : data.status === "processing"
      ? Math.floor(steps.length / 2)
      : data.status === "completed"
      ? steps.length
      : 0;

  const isCortes = data.renderMethod === "cortes";
  const completed = data.status === "completed";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge status={data.status} />
        {data.status === "processing" && (
          <span className="text-sm text-gray-500 animate-pulse">
            Pipeline en ejecución...
          </span>
        )}
      </div>

      <ol className="space-y-2">
        {steps.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex && data.status === "processing";
          return (
            <li key={step} className="flex items-center gap-3 text-sm">
              <span
                className={[
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                  done
                    ? "bg-green-100 text-green-700"
                    : active
                    ? "bg-indigo-100 text-indigo-700 animate-pulse"
                    : "bg-gray-100 text-gray-400",
                ].join(" ")}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={
                  done
                    ? "text-gray-700"
                    : active
                    ? "font-medium text-indigo-700"
                    : "text-gray-400"
                }
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>

      {data.status === "error" && data.errorMessage && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <strong>Error:</strong> {data.errorMessage}
        </div>
      )}

      {isCortes && completed && (
        <div className="space-y-4 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Duración total</p>
              <p className="font-medium text-gray-900">
                {data.duracionSeg !== null ? `${data.duracionSeg.toFixed(1)} s` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Cortes IA</p>
              <p className="font-medium text-gray-900">
                {data.cortesAnalysis?.cortes.length ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Segmentos finales</p>
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
                <Button className="w-full">Vídeo con subtítulos</Button>
              </a>
            )}
            <a
              href={`/api/pipeline/${projectId}/download?type=footage`}
              className="flex-1 min-w-[180px]"
            >
              <Button variant="secondary" className="w-full">Vídeo original</Button>
            </a>
            {data.xmlUrl && (
              <a
                href={`/api/pipeline/${projectId}/download?type=xml`}
                className="flex-1 min-w-[180px]"
              >
                <Button variant="secondary" className="w-full">XML Premiere</Button>
              </a>
            )}
            {data.edlUrl && (
              <a
                href={`/api/pipeline/${projectId}/download?type=edl`}
                className="flex-1 min-w-[180px]"
              >
                <Button variant="secondary" className="w-full">EDL DaVinci</Button>
              </a>
            )}
            {data.capcutUrl && (
              <a
                href={`/api/pipeline/${projectId}/download?type=capcut`}
                className="flex-1 min-w-[180px]"
              >
                <Button variant="secondary" className="w-full">Proyecto CapCut</Button>
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

          {data.cortesAnalysis && data.cortesAnalysis.cortes.length > 0 && (
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
        </div>
      )}
    </div>
  );
};
