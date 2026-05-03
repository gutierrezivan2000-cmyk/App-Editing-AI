"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

interface UploadZoneProps {
  onUploaded: (url: string) => void;
}

export const UploadZone = ({ onUploaded }: UploadZoneProps) => {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setDone(false);
      setElapsed(0);

      if (!file.type.startsWith("video/")) {
        setError("Solo se aceptan archivos de video");
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        setError("El archivo excede el tamaño máximo de 500 MB");
        return;
      }

      setUploading(true);
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);

      try {
        const pathname = `footage/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
        });

        if (timerRef.current) clearInterval(timerRef.current);
        setDone(true);
        onUploaded(blob.url);
      } catch (e) {
        if (timerRef.current) clearInterval(timerRef.current);
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
        <label className="cursor-pointer text-indigo-600 hover:text-indigo-700 underline">
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
        <div className="mt-4 w-full max-w-xs">
          <p className="text-sm text-indigo-600 font-medium">
            Subiendo video... {elapsed}s
          </p>
          <p className="mt-1 text-xs text-gray-500">
            No cierres esta ventana. La subida puede tardar varios minutos según el tamaño y tu conexión.
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div className="h-2 rounded-full bg-indigo-500 animate-pulse w-full" />
          </div>
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
