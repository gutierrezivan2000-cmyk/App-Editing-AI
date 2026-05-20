import type { ReactNode } from "react";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

interface MetricsCardProps {
  label: string;
  value: number | string;
  /** SVG icon (cualquier ReactNode con className="h-5 w-5" suficiente). */
  icon: ReactNode;
  /** Tono de color del icono y el fondo. */
  tone?: Tone;
  /** Linea pequena debajo del valor — tendencia, comparacion, etc. */
  trend?: string;
}

const toneClasses: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "bg-gray-100", fg: "text-gray-600" },
  info: { bg: "bg-indigo-50", fg: "text-indigo-600" },
  success: { bg: "bg-emerald-50", fg: "text-emerald-600" },
  warning: { bg: "bg-amber-50", fg: "text-amber-600" },
  danger: { bg: "bg-red-50", fg: "text-red-600" },
};

/**
 * Card de KPI con icono coloreado segun "tone", valor en numerica grande,
 * y label/trend en escala secundaria. Substituye al MetricsCard antiguo
 * que usaba emojis como icono.
 */
export const MetricsCard = ({
  label,
  value,
  icon,
  tone = "neutral",
  trend,
}: MetricsCardProps) => {
  const { bg, fg } = toneClasses[tone];
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-sm">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </p>
        <p className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight text-gray-900">
          {value}
        </p>
        {trend && (
          <p className="mt-1 text-xs text-gray-400">{trend}</p>
        )}
      </div>
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${bg} ${fg}`}
      >
        {icon}
      </div>
    </div>
  );
};
