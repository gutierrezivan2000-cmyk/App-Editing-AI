"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseEditorHistoryOptions<T> {
  initial: T;
  /**
   * Tiempo que esperamos sin cambios antes de pushear un snapshot al stack.
   * Si el usuario sigue editando, el snapshot anterior se reemplaza por el
   * nuevo — así un input de texto no genera 30 entradas de historia (una
   * por keystroke) sino UNA por "sesión de edición".
   */
  debounceMs?: number;
  /** Máximo de snapshots en el stack. Más antiguos se descartan. */
  maxHistorySize?: number;
}

interface UseEditorHistoryResult<T> {
  /** Estado actual (lo que la UI debe mostrar). */
  state: T;
  /** Cambia el estado. El debounce decide cuándo se commitea al stack. */
  setState: (next: T | ((prev: T) => T)) => void;
  /** Fuerza commit inmediato — útil antes de Save / Regenerate / unmount. */
  commit: () => void;
  /** Deshace al último snapshot del past. */
  undo: () => void;
  /** Rehace el último snapshot del future. */
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Cantidad de snapshots disponibles en past (sin contar el actual). */
  pastSize: number;
  /** Cantidad en future. */
  futureSize: number;
}

/**
 * Sistema de undo/redo basado en snapshots completos del estado.
 *
 * Diseño:
 *  - `state` siempre refleja el último valor (incluso si todavía no fue
 *    commiteado al stack).
 *  - Cada `setState` schedula un commit con debounce. Si el usuario sigue
 *    editando dentro del debounceMs, el commit se posterga — así una serie
 *    de keystrokes consecutivos forman UNA entrada de historia.
 *  - `undo` mueve el último snapshot de past → state actual, y empuja el
 *    state actual a future. `redo` hace lo inverso.
 *  - Cualquier nuevo `setState` borra el future (rama nueva de historia).
 *
 * El snapshot es el objeto T entero (shallow copy del state). Para
 * proyectos típicos del editor (transcripción + snippets + énfasis) son
 * unos KB por snapshot — 50 entradas = ~200KB max. Acceptable en browser.
 */
export function useEditorHistory<T>({
  initial,
  debounceMs = 800,
  maxHistorySize = 50,
}: UseEditorHistoryOptions<T>): UseEditorHistoryResult<T> {
  // `state` es la fuente de verdad UI.
  const [state, setStateInternal] = useState<T>(initial);
  // `past` / `future` son los snapshots ya committeados.
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  // `lastCommitted` es el último valor que YA está en el stack. Cuando
  // hacemos commit, push de lastCommitted a past y update lastCommitted al
  // state actual.
  const lastCommittedRef = useRef<T>(initial);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setStateInternal((curr) => {
      // No commitear si nada cambió.
      if (Object.is(curr, lastCommittedRef.current)) return curr;
      setPast((p) => {
        const next = [...p, lastCommittedRef.current];
        return next.length > maxHistorySize
          ? next.slice(next.length - maxHistorySize)
          : next;
      });
      setFuture([]);
      lastCommittedRef.current = curr;
      return curr;
    });
  }, [maxHistorySize]);

  const setState = useCallback(
    (next: T | ((prev: T) => T)) => {
      setStateInternal((prev) => {
        const computed =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        return computed;
      });
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      commitTimerRef.current = setTimeout(commit, debounceMs);
    },
    [commit, debounceMs],
  );

  const undo = useCallback(() => {
    // Si hay cambios pendientes de commit, los commiteamos primero.
    commit();
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => {
        const next = [lastCommittedRef.current, ...f];
        return next.length > maxHistorySize
          ? next.slice(0, maxHistorySize)
          : next;
      });
      lastCommittedRef.current = prev;
      setStateInternal(prev);
      return p.slice(0, -1);
    });
  }, [commit, maxHistorySize]);

  const redo = useCallback(() => {
    commit();
    setFuture((f) => {
      if (f.length === 0) return f;
      const nextState = f[0];
      setPast((p) => {
        const updated = [...p, lastCommittedRef.current];
        return updated.length > maxHistorySize
          ? updated.slice(updated.length - maxHistorySize)
          : updated;
      });
      lastCommittedRef.current = nextState;
      setStateInternal(nextState);
      return f.slice(1);
    });
  }, [commit, maxHistorySize]);

  useEffect(() => {
    return () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    };
  }, []);

  return {
    state,
    setState,
    commit,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    pastSize: past.length,
    futureSize: future.length,
  };
}
