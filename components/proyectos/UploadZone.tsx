"use client";

import React, { useCallback, useState } from "react";
import { upload } from "@vercel/blob/client";

interface UploadZoneProps {
  onUploaded: (url: string) => void;
}

export const UploadZone = ({ onUploaded }: UploadZoneProps) => {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);

      if (!file.type.startsWith("video/")) {
        setError("Solo se aceptan archivos de video");
        return;
      }

      const maxSize = 500 * 1024 * 1024;
      if (file.size > maxSize) {
        setError("El archivo excede el tamaño máximo de 500 MB");
        return;
      }

      setUploading(true);
      setProgress("Subiendo...");
      try {
        const ext = file.name.split(".").pop() ?? "mp4";
        const pathname = `footage/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          contentType: file.type,
        });

        setProgress("¡Listo!");
        onUploaded(blob.url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido");
        setProgress(null);
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

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={[
        "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition-colors",
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
            onChange={onFileChange}
            disabled={uploading}
          />
        </label>
      </p>
      <p className="mt-1 text-xs text-gray-400">MP4, MOV, etc. — máx. 500 MB</p>
      {uploading && (
        <p className="mt-4 text-sm text-indigo-600 animate-pulse">{progress}</p>
      )}
      {!uploading && progress === "¡Listo!" && (
        <p className="mt-4 text-sm text-green-600 font-medium">✓ Video subido correctamente</p>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
};
