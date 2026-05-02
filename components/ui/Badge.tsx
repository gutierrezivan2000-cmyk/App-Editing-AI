import type { Proyecto } from "@/types";

type Status = Proyecto["status"];

const statusConfig: Record<
  Status,
  { label: string; classes: string }
> = {
  pending: {
    label: "Pendiente",
    classes: "bg-gray-100 text-gray-700",
  },
  processing: {
    label: "Procesando",
    classes: "bg-blue-100 text-blue-700 animate-pulse",
  },
  completed: {
    label: "Completado",
    classes: "bg-green-100 text-green-700",
  },
  error: {
    label: "Error",
    classes: "bg-red-100 text-red-700",
  },
};

export const Badge = ({ status }: { status: Status }) => {
  const { label, classes } = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
};
