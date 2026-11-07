import { useCallback, useEffect, useRef } from "react";

/**
 * Saves text once the user pauses typing: schedule(text) restarts the wait,
 * flush() saves at once. What still waits saves as the component unmounts.
 */
export function useDebouncedSave(save: (text: string) => void, delay = 500) {
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const pending = useRef<string | null>(null);
  const timer = useRef(0);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const text = pending.current;
    pending.current = null;
    if (text !== null) saveRef.current(text);
  }, []);

  const schedule = useCallback(
    (text: string) => {
      pending.current = text;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    [flush, delay],
  );

  useEffect(() => flush, [flush]);
  return { schedule, flush };
}
