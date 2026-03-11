import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

const WAVEFORM_BARS = 24;

export function useAudioLevel() {
  const [level, setLevel] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array(WAVEFORM_BARS).fill(0));
  const levelsRef = useRef<number[]>(new Array(WAVEFORM_BARS).fill(0));

  useEffect(() => {
    const unlisten = listen<number>('audio-level', (event) => {
      const newLevel = event.payload;
      setLevel(newLevel);

      const next = [...levelsRef.current.slice(1), newLevel];
      levelsRef.current = next;
      setLevels(next);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return { level, levels };
}
