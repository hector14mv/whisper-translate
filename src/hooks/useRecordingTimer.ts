import { useState, useEffect, useRef, useCallback } from 'react';

export function useRecordingTimer(isRunning: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    if (startTimeRef.current !== null) {
      setElapsed(Date.now() - startTimeRef.current);
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now();
      setElapsed(0);
      rafRef.current = requestAnimationFrame(tick);
    } else {
      startTimeRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setElapsed(0);
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isRunning, tick]);

  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return { elapsed, formatted };
}
