/**
 * Logo lockup de la app. Se usa en sidebar, paginas de auth, etc.
 * Variantes:
 *   - `compact`: solo el mark + wordmark inline (default)
 *   - `stacked`: mark arriba, wordmark abajo, centrado (para auth pages)
 */

interface LogoProps {
  variant?: "compact" | "stacked";
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Logo({
  variant = "compact",
  size = "md",
  className = "",
}: LogoProps) {
  const dimensions = {
    sm: { mark: "h-7 w-7", icon: "h-3.5 w-3.5", text: "text-sm" },
    md: { mark: "h-9 w-9", icon: "h-4.5 w-4.5", text: "text-lg" },
    lg: { mark: "h-14 w-14", icon: "h-7 w-7", text: "text-3xl" },
  }[size];

  if (variant === "stacked") {
    return (
      <div className={`flex flex-col items-center gap-3 ${className}`}>
        <div
          className={`flex ${dimensions.mark} items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-500/20`}
        >
          <PlayMark className={dimensions.icon} />
        </div>
        <span className={`font-semibold tracking-tight text-gray-900 ${dimensions.text}`}>
          VideoIA Agency
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div
        className={`flex ${dimensions.mark} items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-sm`}
      >
        <PlayMark className={dimensions.icon} />
      </div>
      <span className={`font-semibold tracking-tight text-gray-900 ${dimensions.text}`}>
        VideoIA
      </span>
    </div>
  );
}

function PlayMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}
