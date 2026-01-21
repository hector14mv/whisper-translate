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
    // Only handle click-to-record mode via click
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
    // Stop recording if mouse leaves the button while holding in push-to-talk mode
    if (isPushToTalk && isRecording) {
      onStopRecording();
    }
  }, [isPushToTalk, isRecording, onStopRecording]);

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        disabled={disabled || isProcessing}
        className={`
          relative w-24 h-24 rounded-full transition-all duration-300
          flex items-center justify-center select-none
          ${isRecording
            ? 'bg-red-500 hover:bg-red-600 scale-110'
            : 'bg-primary-600 hover:bg-primary-700'
          }
          ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
          disabled:opacity-50 disabled:cursor-not-allowed
          focus:outline-none focus:ring-4 focus:ring-primary-300
          shadow-lg hover:shadow-xl
        `}
      >
        {/* Recording animation rings */}
        {isRecording && (
          <>
            <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-20" />
            <span className="absolute inset-2 rounded-full bg-red-400 animate-ping opacity-30 animation-delay-150" />
          </>
        )}

        {/* Icon */}
        <span className="relative z-10">
          {isProcessing ? (
            <svg className="w-10 h-10 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : isRecording ? (
            <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </span>
      </button>

      {/* Status text */}
      <span className="text-sm font-medium text-gray-600">
        {isProcessing && 'Processing...'}
        {isRecording && (isPushToTalk ? 'Recording... Release to stop' : 'Recording... Click to stop')}
        {recordingState === 'idle' && (isPushToTalk ? 'Hold to record' : 'Click to record')}
      </span>

      {/* Waveform visualization */}
      {isRecording && (
        <div className="flex items-center gap-1 h-8">
          {[...Array(7)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-red-500 rounded-full waveform-bar"
              style={{
                animationDelay: `${i * 0.1}s`,
                height: '100%',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
