"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Header } from "@/components/dashboard/Header";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface CorteStatus {
  id: string;
  nombre: string;
  status: "pending" | "processing" | "completed" | "error";
  xmlUrl?: string;
  errorMessage?: string;
  silenciosCount: number;
  segmentsCount: number;
  duracionSeg: number;
}

const STEPS = [
  { key: "download", label: "Descarga de footage" },
  { key: "metadata", label: "Extracción de metadata" },
  { key: "silences", label: "Detección de silencios" },
  { key: "xml", label: "Generación de XML" },
  { key: "done", label: "Finalizado" },
];

export default function CorteDetailPage() {
  const params = useParams<{ id: string }>();
  const [corte, setCorte] = useState<CorteStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/cortar/${params.id}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "No se pudo cargar el corte");
        }
        const data = (await res.json()) as CorteStatus;
        if (!cancelled) setCorte(data);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Error");
      }
    };

    fetchStatus();
    const interval = setInterval(() => {
      if (corte?.status === "completed" || corte?.status === "error") {
        clearInterval(interval);
        return;
      }
      fetchStatus();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [params.id, corte?.status]);

  if (loadError) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">{loadError}</p>
      </div>
    );
  }

  if (!corte) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">Cargando…</p>
      </div>
    );
  }

  const completed = corte.status === "completed";
  const errored = corte.status === "error";

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Header title={corte.nombre} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Estado</h2>
            <Badge status={corte.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {STEPS.map((step, idx) => {
              const stepActive =
                corte.status === "processing" || corte.status === "completed";
              const stepCompleted =
                corte.status === "completed" ||
                (corte.status === "processing" && idx < STEPS.length - 1);
              return (
                <li
                  key={step.key}
                  className="flex items-center gap-3 text-sm text-gray-600"
                >
                  <span
                    className={[
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                      stepCompleted
                        ? "bg-green-100 text-green-700"
                        : stepActive
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-gray-100 text-gray-400",
                    ].join(" ")}
                  >
                    {idx + 1}
                  </span>
                  {step.label}
                </li>
              );
            })}
          </ul>

          {errored && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <strong>Error:</strong> {corte.errorMessage ?? "Error desconocido"}
            </div>
          )}
        </CardContent>
      </Card>

      {completed && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Resultado</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500">Duración total</p>
                <p className="font-medium text-gray-900">
                  {corte.duracionSeg.toFixed(1)} s
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Silencios detectados</p>
                <p className="font-medium text-gray-900">{corte.silenciosCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Segmentos a conservar</p>
                <p className="font-medium text-gray-900">{corte.segmentsCount}</p>
              </div>
            </div>

            {corte.xmlUrl && (
              <a href={corte.xmlUrl} download={`${corte.nombre}.xml`}>
                <Button>Descargar XML para Premiere Pro</Button>
              </a>
            )}

            <p className="text-xs text-gray-500">
              <strong>Cómo importar:</strong> en Premiere Pro, ve a{" "}
              <em>File → Import</em> y selecciona el XML descargado. Premiere
              creará una secuencia con los segmentos ya cortados; el archivo
              original debe estar accesible vía URL pública.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
