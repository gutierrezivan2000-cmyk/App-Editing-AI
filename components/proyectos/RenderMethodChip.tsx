import type { Proyecto } from "@/types";

type RenderMethod = Proyecto["renderMethod"];

/**
 * Chip pequeno indicando el modo de pipeline. Mismo lenguaje visual en
 * dashboard, listado de proyectos y detalle. Tamano y radius proporcional
 * para que se lea bien junto a nombres largos.
 */
export function RenderMethodChip({
  method,
  size = "md",
}: {
  method: RenderMethod;
  size?: "sm" | "md";
}) {
  const config: Record<RenderMethod, { label: string; bg: string; fg: string }> = {
    original: { label: "Original", bg: "bg-gray-100", fg: "text-gray-700" },
    mirage: { label: "Mirage", bg: "bg-purple-100", fg: "text-purple-700" },
    cortes: { label: "Cortes IA", bg: "bg-blue-100", fg: "text-blue-700" },
    multiclip: { label: "Multiclip", bg: "bg-indigo-100", fg: "text-indigo-700" },
  };
  const { label, bg, fg } = config[method];
  const sizeClasses =
    size === "sm"
      ? "h-6 px-2 text-[10px]"
      : "h-9 w-16 text-[10px]";
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-md font-semibold uppercase tracking-wide ${bg} ${fg} ${sizeClasses}`}
    >
      {label}
    </span>
  );
}
