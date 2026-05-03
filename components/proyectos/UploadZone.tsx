"use client";

import React, { useCallback, useState } from "react";

interface UploadZoneProps {
  onUploaded: (url: string) => void;
}

export const UploadZone = ({ onUploaded }: UploadZoneProps) => {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      try {
        const pathname = `footage/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        // Get client token and upload URL from our server
        const tokenRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "blob.generate-client-token",
            payload: {
              pathname,
              callbackUrl: `${window.location.origin}/api/upload`,
              clientPayload: null,
              multipart: false,
            },
          }),
        });

        if (!tokenRes.ok) {
          throw new Error("Error al preparar la subida");
        }

        const { clientToken, uploadUrl } = (await tokenRes.json()) as {
          clientToken?: string;
          uploadUrl?: string;
        };

        if (!clientToken || !uploadUrl) {
          throw new Error("No se pudo obtener credenciales de subida. Verifica que Vercel Blob Storage esté conectado.");
        }

        // Upload directly using the URL and token provided by our server
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "authorization": `Bearer ${clientToken}`,
          },
          body: file,
        });

        if (!uploadRes.ok) {
          const error = await uploadRes.text().catch(() => `HTTP ${uploadRes.status}`);
          throw new Error(`Error al subir: ${error}`);
        }

        const uploadData = await uploadRes.json() as { url?: string };
        if (!uploadData.url) {
          throw new Error("El servidor no devolvió la URL del video");
        }

        setProgress(100);
        setDone(true);
        onUploaded(uploadData.url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido");
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
          <p className="text-sm text-indigo-600">Subiendo...</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div className="h-2 rounded-full bg-indigo-500 animate-pulse" />
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
