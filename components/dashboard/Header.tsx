interface HeaderProps {
  title: string;
  description?: string;
  /** Slot opcional para botones/CTAs alineados a la derecha. */
  actions?: React.ReactNode;
}

/**
 * Header de pagina — alto generoso (no es navbar), tipografia destacada
 * y opcionalmente una linea de contexto secundaria + actions a la derecha.
 *
 * Logout vive en el sidebar (seccion de usuario). El boton anterior aca
 * sobraba y consumia foco visual.
 */
export const Header = ({ title, description, actions }: HeaderProps) => (
  <header className="flex flex-col gap-1 border-b border-gray-200 bg-white px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-6 lg:px-8">
    <div className="min-w-0">
      <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
        {title}
      </h1>
      {description && (
        <p className="mt-0.5 text-sm text-gray-500">{description}</p>
      )}
    </div>
    {actions && (
      <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
    )}
  </header>
);
