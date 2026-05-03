"use client";

import React, { useCallback, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

interface UploadZoneProps {
  onUploaded: (url: string) => void;
}

export const UploadZone = ({ onUploaded }: UploadZoneProps) => {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setDone(false);
      setProgress(0);

      if (!file.type.startsWith("video/")) {
        setError("Solo se aceptan archivos de video");
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        setError("El archivo excede el tamaño máximo de 500 MB");
        return;
      }

      setUploading(true);

      // Simulate upload progress (real progress not available in this SDK version)
      let simPct = 0;
      timerRef.current = setInterval(() => {
        // Slow down as it approaches 98% to give the upload time to finish
        const step = simPct < 60 ? Math.random() * 5 : simPct < 85 ? Math.random() * 2 : 0.3;
        simPct = Math.min(simPct + step, 98);
        setProgress(Math.round(simPct));
      }, 600);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);

      try {
        const pathname = `footage/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
        });
        clearTimeout(timeoutId);

        clearInterval(timerRef.current!);
        setProgress(100);
        setDone(true);
        onUploaded(blob.url);
      } catch (e) {
        clearTimeout(timeoutId);
        clearInterval(timerRef.current!);
        const msg = e instanceof Error ? e.message : "Error desconocido al subir el video";
        setError(msg.includes("abort") ? "La subida tardó demasiado. Intenta con un archivo más pequeño." : msg);
      } finally {
        timerRef.current = null;
        setUploading(false);
      }
    },
    [onUploaded]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={[
        "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 sm:p-12 text-center transition-colors",
        dragging
          ? "border-indigo-500 bg-indigo-50"
          : "border-gray-300 hover:border-gray-400",
      ].join(" ")}
    >
      <div className="text-4xl mb-4">🎥</div>
      <p className="text-sm font-medium text-gray-700">
        Arrastra tu video aquí o{" "}
        <label className="cursor-pointer text-indigo-600 hover:text-indigo-700 underline">
          selecciona un archivo
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
            }}
            disabled={uploading}
          />
        </label>
      </p>
      <p className="mt-1 text-xs text-gray-400">MP4, MOV, etc. — máx. 500 MB</p>

      {uploading && (
        <div className="mt-4 w-full max-w-xs">
          <p className="text-sm text-indigo-600">
            {progress >= 98
              ? "Finalizando... por favor espera"
              : progress > 0
              ? `Subiendo... ${progress}%`
              : "Preparando subida..."}
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${Math.max(progress, 5)}%` }}
            />
          </div>
        </div>
      )}

      {done && !uploading && (
        <p className="mt-4 text-sm text-green-600 font-medium">
          ✓ Video subido correctamente
        </p>
      )}
      {error && (
        <p className="mt-4 text-xs text-red-600 max-w-xs break-words text-left">
          {error}
        </p>
      )}
    </div>
  );
};
