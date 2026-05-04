"use client";

import React, { useCallback, useState } from "react";
import { upload } from "@vercel/blob/client";

interface UploadZoneProps {
  onUploaded: (url: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UploadZone = ({ onUploaded }: UploadZoneProps) => {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setDone(false);
      setProgress(0);
      setLoaded(0);
      setTotal(file.size);

      if (!file.type.startsWith("video/")) {
        setError("Solo se aceptan archivos de video");
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        setError("El archivo excede el tamaño máximo de 500 MB");
        return;
      }

      setUploading(true);

      try {
        const pathname = `footage/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          onUploadProgress: ({ loaded, total, percentage }) => {
            setProgress(Math.round(percentage));
            setLoaded(loaded);
            setTotal(total);
          },
        });

        setProgress(100);
        setDone(true);
        onUploaded(blob.url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido al subir el video");
      } finally {
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
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={[
        "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 sm:p-12 text-center transition-colors",
        dragging ? "border-indigo-500 bg-indigo-50" : "border-gray-300 hover:border-gray-400",
      ].join(" ")}
    >
      <div className="text-4xl mb-4">🎥</div>
      <p className="text-sm font-medium text-gray-700">
        Arrastra tu video aquí o{" "}
        <label className={`underline ${uploading ? "text-gray-400 cursor-not-allowed" : "cursor-pointer text-indigo-600 hover:text-indigo-700"}`}>
          selecciona un archivo
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
            disabled={uploading}
          />
        </label>
      </p>
      <p className="mt-1 text-xs text-gray-400">MP4, MOV, etc. — máx. 500 MB</p>

      {uploading && (
        <div className="mt-5 w-full max-w-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-indigo-700">{progress}%</span>
            <span className="text-xs text-gray-500">
              {formatBytes(loaded)} / {formatBytes(total)}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-2.5 rounded-full bg-indigo-500 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-400 text-center">
            No cierres esta ventana mientras se sube el video
          </p>
        </div>
      )}

      {done && !uploading && (
        <p className="mt-4 text-sm text-green-600 font-medium">✓ Video subido correctamente</p>
      )}
      {error && (
        <p className="mt-4 text-xs text-red-600 max-w-xs break-words text-left">{error}</p>
      )}
    </div>
  );
};
