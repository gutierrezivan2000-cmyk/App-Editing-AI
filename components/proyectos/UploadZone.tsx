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

        // Step 1: get a client upload token from our server
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
          const body = await tokenRes.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ||
              `Error al preparar la subida (${tokenRes.status})`
          );
        }

        const { clientToken } = (await tokenRes.json()) as {
          clientToken?: string;
        };
        if (!clientToken) {
          throw new Error(
            "El servidor no devolvió un token. Verifica que BLOB_READ_WRITE_TOKEN esté configurado en Vercel."
          );
        }

        // Step 2: PUT file directly to Vercel Blob CDN via XHR for real progress
        const blobUrl = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", `https://blob.vercel-storage.com/${pathname}`);
          xhr.setRequestHeader("x-api-version", "7");
          xhr.setRequestHeader("authorization", `Bearer ${clientToken}`);

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setProgress(Math.round((event.loaded / event.total) * 100));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText) as { url?: string };
                if (data.url) {
                  resolve(data.url);
                } else {
                  reject(new Error("El servidor de archivos no devolvió la URL del video."));
                }
              } catch {
                reject(new Error("Respuesta inválida del servidor de archivos."));
              }
            } else {
              let msg = `Error al subir el archivo (${xhr.status})`;
              try {
                const data = JSON.parse(xhr.responseText) as {
                  error?: { message?: string };
                };
                if (data.error?.message) msg = data.error.message;
              } catch { /* ignore */ }
              reject(new Error(msg));
            }
          };

          xhr.onerror = () =>
            reject(
              new Error(
                "Error de red al subir el video. Revisa tu conexión e inténtalo de nuevo."
              )
            );

          xhr.ontimeout = () =>
            reject(
              new Error(
                "La subida tardó demasiado tiempo. Intenta con un archivo más pequeño."
              )
            );

          // 10-minute hard timeout
          xhr.timeout = 10 * 60 * 1000;

          xhr.send(file);
        });

        setProgress(100);
        setDone(true);
        onUploaded(blobUrl);
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
            {progress > 0
              ? `Subiendo... ${progress}%`
              : "Preparando subida..."}
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-indigo-500 transition-all duration-300"
              style={{ width: progress > 0 ? `${progress}%` : "10%", animation: progress > 0 ? "none" : "pulse 1.5s ease-in-out infinite" }}
            />
          </div>
        </div>
      )}

      {done && !uploading && (
        <p className="mt-4 text-sm text-green-600 font-medium">
          ✓ Video subido correctamente
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
};
