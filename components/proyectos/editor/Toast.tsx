"use client";

import { useEffect, useState } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  /** Tiempo de vida en ms. 0 = no auto-dismiss. */
  duration?: number;
}

interface ToastStackProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

/**
 * Stack de toasts en la esquina inferior derecha. Estilo Linear: card
 * compacta con icono + texto + auto-fade después de N segundos.
 *
 * Tres tipos: success (emerald), error (red), info (indigo). Mas que eso
 * es ruido visual — si el editor necesita un cuarto, probablemente sea
 * señal de overengineering.
 */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div className="pointer-events-none fixed bottom-14 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const [exiting, setExiting] = useState(false);
  const [entered, setEntered] = useState(false);

  // Animar entrada después del primer paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!toast.duration) return;
    const timer = setTimeout(() => setExiting(true), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration]);

  useEffect(() => {
    if (!exiting) return;
    // Pequeño delay para que la animación de salida se vea antes del
    // unmount real.
    const timer = setTimeout(() => onDismiss(toast.id), 240);
    return () => clearTimeout(timer);
  }, [exiting, toast.id, onDismiss]);

  const styles: Record<
    ToastType,
    {
      iconBg: string;
      iconColor: string;
      glow: string;
      accent: string;
    }
  > = {
    success: {
      iconBg: "bg-emerald-500/15 ring-emerald-500/30",
      iconColor: "text-emerald-300",
      glow: "shadow-emerald-500/10",
      accent: "from-emerald-500/40 to-transparent",
    },
    error: {
      iconBg: "bg-red-500/15 ring-red-500/30",
      iconColor: "text-red-300",
      glow: "shadow-red-500/10",
      accent: "from-red-500/40 to-transparent",
    },
    info: {
      iconBg: "bg-indigo-500/15 ring-indigo-500/30",
      iconColor: "text-indigo-300",
      glow: "shadow-indigo-500/10",
      accent: "from-indigo-500/40 to-transparent",
    },
  };
  const s = styles[toast.type];

  const visible = entered && !exiting;

  return (
    <div
      className={[
        "pointer-events-auto relative flex max-w-sm items-start gap-2.5 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/95 px-3 py-2.5 text-sm text-zinc-100 shadow-xl backdrop-blur transition-all duration-200",
        s.glow,
        visible ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0",
      ].join(" ")}
    >
      {/* Accent bar lateral */}
      <span
        className={`absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b ${s.accent}`}
      />
      <span
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${s.iconBg} ${s.iconColor}`}
      >
        {toast.type === "success" && <CheckIcon className="h-3.5 w-3.5" />}
        {toast.type === "error" && <AlertIcon className="h-3.5 w-3.5" />}
        {toast.type === "info" && <InfoIcon className="h-3.5 w-3.5" />}
      </span>
      <span className="flex-1 pt-0.5 text-[13px] leading-snug text-zinc-200">
        {toast.message}
      </span>
      <button
        onClick={() => setExiting(true)}
        className="flex-shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        aria-label="Cerrar"
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
