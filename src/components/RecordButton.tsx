import { useCallback } from 'react';
import type { RecordingState } from '../types';

interface RecordButtonProps {
  recordingState: RecordingState;
  recordingMode: 'push_to_talk' | 'click_to_record';
  onStartRecording: () => void;
  onStopRecording: () => void;
  disabled?: boolean;
}

export function RecordButton({
  recordingState,
  recordingMode,
  onStartRecording,
  onStopRecording,
  disabled = false,
}: RecordButtonProps) {
  const isRecording = recordingState === 'recording';
  const isProcessing = recordingState === 'processing' || recordingState === 'translating';
  const isPushToTalk = recordingMode === 'push_to_talk';

  const handleClick = useCallback(() => {
    if (!isPushToTalk) {
      if (isRecording) {
        onStopRecording();
      } else if (recordingState === 'idle') {
        onStartRecording();
      }
    }
  }, [isPushToTalk, isRecording, recordingState, onStartRecording, onStopRecording]);

  const handleMouseDown = useCallback(() => {
    if (isPushToTalk && recordingState === 'idle' && !disabled) {
      onStartRecording();
    }
  }, [isPushToTalk, recordingState, disabled, onStartRecording]);

  const handleMouseUp = useCallback(() => {
    if (isPushToTalk && isRecording) {
      onStopRecording();
    }
  }, [isPushToTalk, isRecording, onStopRecording]);

  const handleMouseLeave = useCallback(() => {
    if (isPushToTalk && isRecording) {
      onStopRecording();
    }
  }, [isPushToTalk, isRecording, onStopRecording]);

  const getStateClass = () => {
    if (isRecording) return 'recording';
    if (isProcessing) return 'processing';
    return '';
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Crystal Button Container */}
      <div className="crystal-container">
        {/* Ambient glow */}
        <div className="crystal-glow" />

        {/* Recording pulse rings */}
        {isRecording && (
          <>
            <div className="recording-ring" />
            <div className="recording-ring" />
            <div className="recording-ring" />
          </>
        )}

        {/* Main crystal button */}
        <button
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          disabled={disabled || isProcessing}
          className={`crystal-button ${getStateClass()} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {/* Crystal inner layers */}
          <div className="crystal-inner">
            <div className="crystal-facet" />
            <div className="crystal-refraction" />

            {/* Icon */}
            <span className="relative z-10">
              {isProcessing ? (
                <svg className="w-12 h-12 text-prism-violet animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : isRecording ? (
                // Waveform inside crystal when recording
                <div className="waveform">
                  {[...Array(7)].map((_, i) => (
                    <div key={i} className="wave-bar" />
                  ))}
                </div>
              ) : (
                // Microphone icon
                <svg className="w-12 h-12 text-cloud" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              )}
            </span>
          </div>
        </button>
      </div>

      {/* Status text */}
      <span className="text-sm font-medium text-mist">
        {isProcessing && (
          <span className="flex items-center gap-2">
            <span className="text-prism-violet">Processing</span>
            <span className="flex gap-1">
              <span className="w-1 h-1 bg-prism-violet rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 bg-prism-violet rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 bg-prism-violet rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          </span>
        )}
        {isRecording && (
          <span className="text-recording">
            {isPushToTalk ? 'Release to stop' : 'Tap to stop'}
          </span>
        )}
        {recordingState === 'idle' && !disabled && (
          <span className="text-cloud">
            {isPushToTalk ? 'Hold to speak' : 'Tap to speak'}
          </span>
        )}
        {disabled && recordingState === 'idle' && (
          <span className="text-smoke">Setup required</span>
        )}
      </span>
    </div>
  );
}
