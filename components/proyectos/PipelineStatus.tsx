"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import type { Proyecto } from "@/types";

interface StatusResponse {
  status: Proyecto["status"];
  outputUrl: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

const STEPS = [
  "Descarga de footage",
  "Detección de silencios",
  "Transcripción Whisper",
  "Orquestación Claude",
  "Corte FFmpeg",
  "Render Remotion",
  "Finalizado",
];

interface PipelineStatusProps {
  projectId: string;
  initialStatus: Proyecto["status"];
  onCompleted?: (outputUrl: string) => void;
}

export const PipelineStatus = ({
  projectId,
  initialStatus,
  onCompleted,
}: PipelineStatusProps) => {
  const [data, setData] = useState<StatusResponse>({
    status: initialStatus,
    outputUrl: null,
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  });

  useEffect(() => {
    if (data.status === "completed" || data.status === "error") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/pipeline/${projectId}/status`);
        if (!res.ok) return;
        const fresh: StatusResponse = await res.json();
        setData(fresh);
        if (fresh.status === "completed" && fresh.outputUrl) {
          onCompleted?.(fresh.outputUrl);
        }
        if (fresh.status === "completed" || fresh.status === "error") {
          clearInterval(interval);
        }
      } catch {
        // silent retry
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [projectId, data.status, onCompleted]);

  const stepIndex =
    data.status === "pending"
      ? 0
      : data.status === "processing"
      ? 3
      : data.status === "completed"
      ? STEPS.length
      : 0;

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
        {STEPS.map((step, i) => {
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
    </div>
  );
};
