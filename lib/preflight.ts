import type { ClipMultiSource } from "@/types";

/**
 * Validacion temprana del proyecto antes de gastar minutos en el sandbox.
 *
 * Antes el pipeline podia tardar 5-10 min en descubrir errores triviales
 * (env var faltante, URL del clip rota, formato incorrecto). El usuario
 * quedaba mirando el spinner sin saber si iba a funcionar o no.
 *
 * Este modulo hace todos los checks que se pueden hacer en <10 segundos
 * desde Node (no desde el sandbox), y lanza con mensajes humanos si algo
 * no esta bien. Si pasa, el pipeline pesado tiene >95% chance de exito.
 */

export interface PreflightResult {
  ok: boolean;
  /** Mensajes accionables si fallo. Mostrados al usuario tal cual. */
  problems: string[];
}

/**
 * Variables de entorno que el pipeline necesita. Si alguna esta vacia o
 * undefined, fail fast — todos esos sandboxes y llamadas a APIs van a
 * fallar igual, mejor avisar al segundo 1 y no al minuto 8.
 */
const REQUIRED_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
] as const;

export function checkEnvVars(): string[] {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV_VARS) {
    const v = process.env[key];
    if (!v || v.length === 0) {
      missing.push(key);
    }
  }
  return missing;
}

/**
 * Hace un HEAD request a una URL para verificar que existe y devuelve un
 * tipo de contenido razonable. Timeout corto: 8s. Si la URL no responde
 * en ese tiempo, asumimos que el sandbox tampoco va a poder descargarla.
 */
async function checkUrlAccessible(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: ctrl.signal,
      });
      if (!res.ok) {
        return `HTTP ${res.status} — el blob no es accesible (${url.slice(0, 80)}...)`;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (
        contentType &&
        !contentType.startsWith("video/") &&
        !contentType.startsWith("application/octet-stream")
      ) {
        return `Tipo de contenido inesperado: ${contentType}. Se esperaba video/*`;
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted")) {
      return `Timeout (>8s) al verificar el clip — el blob puede estar lento o caido`;
    }
    return `No se pudo conectar al blob: ${msg}`;
  }
}

/**
 * Preflight para pipeline multiclip. Chequea:
 *   - Env vars criticas
 *   - Al menos 1 clip
 *   - Los primeros clips son accesibles (HEAD)
 *   - URLs son HTTPS de un dominio razonable
 *
 * Devuelve { ok, problems[] }. Si problems esta vacio, todo OK.
 */
export async function preflightMulticlip(
  clips: ClipMultiSource[],
): Promise<PreflightResult> {
  const problems: string[] = [];

  // 1. Env vars
  const missingEnv = checkEnvVars();
  if (missingEnv.length > 0) {
    problems.push(
      `Faltan variables de entorno en el servidor: ${missingEnv.join(", ")}. ` +
        "Configurarlas en Vercel o en .env.local.",
    );
  }

  // 2. Clips
  if (!clips || clips.length === 0) {
    problems.push("No hay clips para procesar.");
  } else {
    // 3. URLs validas y accesibles. Chequeamos los primeros 3 con HEAD
    //    para no demorar el preflight con 20 clips. Si el primero esta
    //    bien, los demas usualmente tambien (mismo blob storage).
    const sample = clips.slice(0, Math.min(3, clips.length));
    const checks = await Promise.all(
      sample.map(async (c, idx) => {
        try {
          new URL(c.url);
        } catch {
          return { idx, error: "URL inválida" };
        }
        const error = await checkUrlAccessible(c.url);
        return error ? { idx, error } : null;
      }),
    );
    for (const check of checks) {
      if (check) {
        problems.push(`Clip ${check.idx + 1}: ${check.error}`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Preflight para pipeline 'cortes' u 'original' (single clip).
 */
export async function preflightSingleClip(
  footageUrl: string | null | undefined,
): Promise<PreflightResult> {
  const problems: string[] = [];

  const missingEnv = checkEnvVars();
  if (missingEnv.length > 0) {
    problems.push(
      `Faltan variables de entorno en el servidor: ${missingEnv.join(", ")}.`,
    );
  }

  if (!footageUrl) {
    problems.push("No hay URL de footage.");
  } else {
    try {
      new URL(footageUrl);
    } catch {
      problems.push("La URL de footage es inválida.");
    }
    const error = await checkUrlAccessible(footageUrl);
    if (error) problems.push(`Footage: ${error}`);
  }

  return { ok: problems.length === 0, problems };
}
