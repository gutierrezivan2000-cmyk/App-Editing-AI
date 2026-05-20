"use client";

import React, { useCallback, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { ClipMultiSource } from "@/types";

interface MultiUploadZoneProps {
  value: ClipMultiSource[];
  onChange: (clips: ClipMultiSource[]) => void;
  max?: number;
}

interface InFlight {
  id: string;
  name: string;
  progress: number;
  error?: string;
}

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB por clip

export const MultiUploadZone = ({
  value,
  onChange,
  max = 20,
}: MultiUploadZoneProps) => {
  const [dragging, setDragging] = useState(false);
  const [inFlight, setInFlight] = useState<InFlight[]>([]);
  const dragFromIdx = useRef<number | null>(null);

  const updateInFlight = useCallback(
    (id: string, patch: Partial<InFlight>) => {
      setInFlight((prev) =>
        prev.map((u) => (u.id === id ? { ...u, ...patch } : u))
      );
    },
    []
  );

  const removeInFlight = useCallback((id: string) => {
    setInFlight((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const uploadFile = useCallback(
    async (file: File, currentValue: ClipMultiSource[]) => {
      const inFlightId = crypto.randomUUID();

      if (!file.type.startsWith("video/")) {
        setInFlight((prev) => [
          ...prev,
          { id: inFlightId, name: file.name, progress: 0, error: "No es video" },
        ]);
        return currentValue;
      }
      if (file.size > MAX_BYTES) {
        setInFlight((prev) => [
          ...prev,
          { id: inFlightId, name: file.name, progress: 0, error: "Excede 500 MB" },
        ]);
        return currentValue;
      }

      setInFlight((prev) => [
        ...prev,
        { id: inFlightId, name: file.name, progress: 0 },
      ]);

      try {
        const pathname = `footage/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          onUploadProgress: ({ percentage }) => {
            updateInFlight(inFlightId, { progress: Math.round(percentage) });
          },
        });

        removeInFlight(inFlightId);
        return [...currentValue, { url: blob.url, name: file.name }];
      } catch (e) {
        updateInFlight(inFlightId, {
          progress: 0,
          error: e instanceof Error ? e.message : "Error desconocido",
        });
        return currentValue;
      }
    },
    [updateInFlight, removeInFlight]
  );

  const handleFiles = useCallback(
    async (files: FileList) => {
      const remaining = max - value.length;
      const toUpload = Array.from(files).slice(0, remaining);
      // Subir secuencial — evita saturar el navegador con N uploads paralelos.
      let acc = value;
      for (const f of toUpload) {
        acc = await uploadFile(f, acc);
        onChange(acc);
      }
    },
    [max, value, uploadFile, onChange]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const removeClip = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const moveClip = (from: number, to: number) => {
    if (from === to) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const onItemDragStart = (idx: number) => (e: React.DragEvent) => {
    dragFromIdx.current = idx;
    e.dataTransfer.effectAllowed = "move";
  };

  const onItemDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onItemDrop = (toIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragFromIdx.current === null) return;
    moveClip(dragFromIdx.current, toIdx);
    dragFromIdx.current = null;
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragging ? "border-indigo-500 bg-indigo-50" : "border-gray-300 hover:border-gray-400",
        ].join(" ")}
      >
        <div className="text-3xl mb-2">🎬</div>
        <p className="text-sm font-medium text-gray-700">
          Arrastra hasta {max} clips o{" "}
          <label className="cursor-pointer text-indigo-600 hover:text-indigo-700 underline">
            selecciona archivos
            <input
              type="file"
              accept="video/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
              disabled={value.length >= max}
            />
          </label>
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {value.length}/{max} clips · MP4, MOV, etc. — máx. 500 MB cada uno
        </p>
      </div>

      {(inFlight.length > 0 || value.length > 0) && (
        <ul className="space-y-2">
          {value.map((clip, idx) => (
            <li
              key={clip.url}
              draggable
              onDragStart={onItemDragStart(idx)}
              onDragOver={onItemDragOver}
              onDrop={onItemDrop(idx)}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2 cursor-move"
            >
              <span className="font-mono text-xs text-gray-400 w-6 text-right">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="text-gray-300 select-none">⋮⋮</span>
              <span className="flex-1 text-sm text-gray-700 truncate">{clip.name}</span>
              <button
                type="button"
                onClick={() => removeClip(idx)}
                className="text-xs text-red-600 hover:text-red-700 px-2 py-1"
                aria-label="Eliminar clip"
              >
                ✕
              </button>
            </li>
          ))}
          {inFlight.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-3 rounded-lg border border-indigo-100 bg-indigo-50 p-2"
            >
              <span className="font-mono text-xs text-indigo-400 w-6 text-right">…</span>
              <span className="flex-1 text-sm text-indigo-900 truncate">{u.name}</span>
              <span className="text-xs text-indigo-700">
                {u.error
                  ? <span className="text-red-700">{u.error}</span>
                  : u.progress > 0
                  ? `${u.progress}%`
                  : "subiendo…"}
              </span>
              {u.error && (
                <button
                  type="button"
                  onClick={() => removeInFlight(u.id)}
                  className="text-xs text-red-600 hover:text-red-700 px-2 py-1"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
