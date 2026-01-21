import { useState, useCallback, useRef } from 'react';
import { startRecording, stopRecording } from '../lib/tauri';
import type { RecordingState } from '../types';

interface UseAudioRecorderReturn {
  recordingState: RecordingState;
  audioPath: string | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  clearError: () => void;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isRecordingRef = useRef(false);

  const handleStartRecording = useCallback(async () => {
    if (isRecordingRef.current) return;

    try {
      setError(null);
      setRecordingState('recording');
      isRecordingRef.current = true;
      const path = await startRecording();
      setAudioPath(path);
    } catch (err) {
      setRecordingState('idle');
      isRecordingRef.current = false;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleStopRecording = useCallback(async (): Promise<string | null> => {
    if (!isRecordingRef.current) return null;

    try {
      isRecordingRef.current = false;
      const path = await stopRecording();
      setAudioPath(path);
      setRecordingState('idle');
      return path;
    } catch (err) {
      setRecordingState('idle');
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    recordingState,
    audioPath,
    error,
    startRecording: handleStartRecording,
    stopRecording: handleStopRecording,
    clearError,
  };
}
