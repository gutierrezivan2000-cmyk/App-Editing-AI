/**
 * Marker usado para identificar proyectos cancelados por el usuario.
 *
 * Se guarda en `proyectos.error_message` cuando el usuario cancela un
 * pipeline. Otros modulos lo usan para:
 *   - Diferenciar visualmente "cancelado" (amber) vs "error" (rojo) en la UI
 *   - Evitar que updateProject sobrescriba el status con 'completed' cuando
 *     el pipeline termine eventualmente
 *
 * Lo mantenemos en un archivo aparte porque las API routes de Next.js NO
 * permiten exportar nada que no sea un handler HTTP (GET, POST, etc.) —
 * tener el marker en el route.ts del cancel rompe el type-checking del build.
 */
export const CANCEL_MARKER = "Cancelado por el usuario";

/**
 * Detecta si un `errorMessage` corresponde a una cancelacion del usuario.
 * Tolera variantes (espacios, capitalizacion) para que un retry/edit manual
 * del mensaje en DB tambien se reconozca.
 */
export function isCancelled(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  return errorMessage.startsWith("Cancelado");
}
