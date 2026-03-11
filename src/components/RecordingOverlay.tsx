import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAudioLevel } from '../hooks/useAudioLevel';
import { useRecordingTimer } from '../hooks/useRecordingTimer';
import type { OverlayState } from '../types';

export function RecordingOverlay() {
  const [state, setState] = useState<OverlayState>('recording');
  const { levels } = useAudioLevel();
  const { formatted } = useRecordingTimer(state === 'recording');

  useEffect(() => {
    const unlisten = listen<string>('recording-state-change', (event) => {
      const newState = event.payload;
      if (newState === 'recording') {
        setState('recording');
      } else if (newState === 'processing') {
        setState('processing');
      } else if (newState === 'idle') {
        setState('hidden');
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (state === 'hidden') return null;

  return (
    <div className="overlay-pill">
      {state === 'recording' ? (
        <>
          <div className="flex items-center gap-2.5 mr-3 flex-shrink-0">
            <div className="recording-dot" />
            <span className="overlay-timer">{formatted}</span>
          </div>

          <div className="overlay-waveform">
            {levels.map((level, i) => (
              <div
                key={i}
                className="overlay-bar"
                style={{ height: `${Math.max(3, level * 36)}px` }}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="overlay-processing">
          <div className="overlay-spinner" />
          <span className="text-[13px] text-text-secondary font-medium">Processing...</span>
        </div>
      )}
    </div>
  );
}
