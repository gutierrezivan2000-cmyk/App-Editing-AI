import { sql } from "@vercel/postgres";

/**
 * Estructura del campo `progress` en proyectos. La pipeline lo actualiza
 * con cada step para que la UI muestre el avance real en vivo.
 */
export interface PipelineProgress {
  /** Indice 0-based del step segun el modo del pipeline. */
  step: number;
  /** Label corto del step (ej. "Transcripcion Whisper de cada clip"). */
  label: string;
  /** Sub-paso opcional (ej. "Procesando clip 3 de 6"). */
  detail?: string;
  /** Timestamp ISO del momento que arranco el step — para cronometro. */
  startedAt: string;
  /** Porcentaje 0-100 si el step puede estimarse (ej. iteracion en loop). */
  percent?: number;
}

/**
 * Update directo SOLO del campo `progress`. Esquivamos `updateProject`
 * porque ese pasa por mas validaciones (no overwrite de cancelacion, etc.)
 * que no aplican aca — el progress es metadata pura, no afecta el status.
 *
 * Es seguro hacer fire-and-forget: si la DB esta lenta, el pipeline no
 * deberia bloquearse esperando confirmacion del update de progreso.
 */
export async function updateProgress(
  projectId: string,
  progress: PipelineProgress,
): Promise<void> {
  try {
    await sql`
      UPDATE proyectos
      SET progress = ${JSON.stringify(progress)}::jsonb,
          updated_at = NOW()
      WHERE id = ${projectId}
    `;
  } catch (err) {
    // Loguear pero NO propagar — un fallo de progreso no debe romper el pipeline.
    console.warn("[updateProgress] DB update fallo, sigo:", err);
  }
}

/**
 * Marca el step actual como completado, deja `progress` apuntando al
 * proximo. Asi la UI ya muestra el siguiente step iluminado mientras
 * la network/IO esta entre steps.
 */
export async function advanceToStep(
  projectId: string,
  step: number,
  label: string,
  detail?: string,
): Promise<void> {
  await updateProgress(projectId, {
    step,
    label,
    detail,
    startedAt: new Date().toISOString(),
  });
}

/**
 * Heartbeat: actualiza `updated_at` del proyecto cada N segundos mientras
 * el step esta corriendo. Sirve para que un watchdog server-side detecte
 * que el step esta VIVO aunque el `progress` no haya cambiado en minutos
 * (caso tipico: render Remotion de 10+ min sin updates intermedios).
 *
 * Devuelve un callback `stop()` que el caller DEBE invocar en un `finally`
 * para detener el intervalo (sino el proceso queda con un timer huerfano).
 *
 * Uso:
 *   const stop = startHeartbeat(projectId);
 *   try {
 *     await stepLargo();
 *   } finally {
 *     stop();
 *   }
 *
 * Si el step termina con error, el heartbeat se detiene igual. Si el
 * sandbox muere y la promise nunca resuelve, el heartbeat NO ayuda (no
 * llegamos al finally) — pero ese caso lo cubre el watchdog externo via
 * el `updated_at` que dejo de moverse.
 */
export function startHeartbeat(
  projectId: string,
  intervalMs = 30_000,
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await sql`
        UPDATE proyectos
        SET updated_at = NOW()
        WHERE id = ${projectId}
      `;
    } catch {
      // Silencioso — el heartbeat es opportunistico, no critico.
    }
  };
  // No esperamos al primer tick para que el step arranque rapido.
  const intervalId = setInterval(() => {
    void tick();
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}
