import { useState, useCallback, useEffect, useRef } from 'react';
import { emit } from '@tauri-apps/api/event';
import { TranscriptionView } from './components/TranscriptionView';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryList } from './components/HistoryList';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useTranslation } from './hooks/useTranslation';
import { useGlobalHotkey } from './hooks/useGlobalHotkey';
import { getApiKey, getWhisperModelStatus, checkOllamaStatus, getApiKeyTypeForProvider, getSettings, saveSettings, copyAndPaste, showOverlay, hideOverlay, saveFrontmostApp, checkAccessibilityPermission, requestAccessibilityPermission } from './lib/tauri';
import type { TranslationEntry, AppSettings, TranscriptionResult, TranslationResult } from './types';
import { PROVIDER_DISPLAY_INFO, GLOBAL_HOTKEY_OPTIONS } from './types';
import './index.css';

const MAX_HISTORY_ENTRIES = 50;

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState<TranslationEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    recording_mode: 'double_tap',
    whisper_model: 'large-v3-turbo',
    source_language: 'auto',
    target_language: 'en',
    translation_provider: 'openai',
    translation_model: undefined,
    translation_enabled: true,
    remove_filler_words: false,
    global_hotkey_enabled: false,
    global_hotkey: 'Alt+Space',
    double_tap_interval: 400,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState<string | null>(null);
  const [accessibilityMissing, setAccessibilityMissing] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<{
    transcription: TranscriptionResult;
    translation: TranslationResult;
  } | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const isHotkeyRecordingRef = useRef(false);

  const {
    recordingState,
    error: recordingError,
    startRecording,
    stopRecording: stopAudioRecording,
  } = useAudioRecorder();

  const {
    transcription,
    translation,
    isProcessing,
    error: translationError,
    processAudio,
    clearResults,
  } = useTranslation();

  // Load settings from persistent storage on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedSettings = await getSettings();
        setSettings(savedSettings);
        setSettingsLoaded(true);
      } catch (err) {
        console.error('Failed to load settings:', err);
        setSettingsLoaded(true);
      }
    };
    loadSettings();
  }, []);

  // Save settings with debounce when they change
  useEffect(() => {
    if (!settingsLoaded) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await saveSettings(settings);
      } catch (err) {
        console.error('Failed to save settings:', err);
      }
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [settings, settingsLoaded]);

  // Check accessibility permission on mount and when window regains focus
  useEffect(() => {
    const checkPermission = async () => {
      try {
        const granted = await checkAccessibilityPermission();
        setAccessibilityMissing(!granted);
      } catch {
        // Not on macOS or plugin not available — ignore
      }
    };

    checkPermission();

    const onFocus = () => { checkPermission(); };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); };
  }, []);

  // Check setup on mount
  useEffect(() => {
    checkSetup();
  }, []);

  const checkSetup = async () => {
    try {
      if (settings.translation_enabled) {
        const apiKeyType = getApiKeyTypeForProvider(settings.translation_provider);

        if (apiKeyType) {
          const apiKey = await getApiKey(apiKeyType);
          if (!apiKey) {
            const providerName = PROVIDER_DISPLAY_INFO[settings.translation_provider].name;
            setSetupNeeded(`Configure your ${providerName} API key in Settings`);
            return;
          }
        } else if (settings.translation_provider === 'ollama') {
          const status = await checkOllamaStatus();
          if (!status.is_running) {
            setSetupNeeded('Ollama is not running. Start Ollama or choose a different provider.');
            return;
          }
          if (status.models.length === 0) {
            setSetupNeeded('No Ollama models installed. Run `ollama pull llama3.2` to get started.');
            return;
          }
        }
      }

      const models = await getWhisperModelStatus();
      const hasModel = models.some((m) => m.downloaded);
      if (!hasModel) {
        setSetupNeeded('Download a Whisper model in Settings');
        return;
      }

      const selectedModel = models.find((m) => m.name === settings.whisper_model && m.downloaded);
      if (!selectedModel) {
        const anyDownloaded = models.find((m) => m.downloaded);
        if (anyDownloaded) {
          setSettings((prev) => ({
            ...prev,
            whisper_model: anyDownloaded.name as AppSettings['whisper_model'],
          }));
        }
      }

      setSetupNeeded(null);
    } catch (err) {
      console.error('Setup check failed:', err);
    }
  };

  useEffect(() => {
    if (!showSettings) {
      checkSetup();
    }
  }, [showSettings, settings.translation_provider, settings.translation_enabled]);

  const handleStopRecording = useCallback(async (fromHotkey = false) => {
    if (fromHotkey) {
      emit('recording-state-change', 'processing');
    }

    const audioPath = await stopAudioRecording();
    if (audioPath) {
      const entry = await processAudio(
        audioPath,
        settings.whisper_model,
        settings.target_language,
        settings.translation_provider,
        settings.translation_model,
        settings.translation_enabled,
        settings.remove_filler_words
      );
      if (entry) {
        setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY_ENTRIES));
        setSelectedEntry(null);

        // Always auto-paste result at cursor
        const textToPaste = entry.translated_text || entry.original_text;
        if (textToPaste) {
          try {
            await copyAndPaste(textToPaste);
          } catch (err) {
            console.error('Failed to auto-paste:', err);
          }
        }
      }

      if (fromHotkey) {
        try {
          await hideOverlay();
        } catch (err) {
          console.error('Failed to hide overlay:', err);
        }
      }
    } else if (fromHotkey) {
      try {
        await hideOverlay();
      } catch (err) {
        console.error('Failed to hide overlay:', err);
      }
    }
  }, [stopAudioRecording, processAudio, settings.whisper_model, settings.target_language, settings.translation_provider, settings.translation_model, settings.translation_enabled, settings.remove_filler_words]);

  const handleToggleRecording = useCallback(() => {
    if (setupNeeded) return;

    if (recordingState === 'idle') {
      isHotkeyRecordingRef.current = true;
      saveFrontmostApp().catch(() => {});
      startRecording();
      showOverlay().catch((err) => console.error('Failed to show overlay:', err));
    } else if (recordingState === 'recording') {
      const wasHotkeyRecording = isHotkeyRecordingRef.current;
      isHotkeyRecordingRef.current = false;
      handleStopRecording(wasHotkeyRecording);
    }
  }, [setupNeeded, recordingState, startRecording, handleStopRecording]);

  const handleGlobalHotkeyPressed = useCallback(() => {
    if (setupNeeded) return;
    if (recordingState === 'idle') {
      isHotkeyRecordingRef.current = true;
      saveFrontmostApp().catch(() => {});
      startRecording();
    }
  }, [setupNeeded, recordingState, startRecording]);

  const handleGlobalHotkeyReleased = useCallback(() => {
    if (recordingState === 'recording') {
      const wasHotkeyRecording = isHotkeyRecordingRef.current;
      isHotkeyRecordingRef.current = false;
      handleStopRecording(wasHotkeyRecording);
    }
  }, [recordingState, handleStopRecording]);

  const isDoubleTapMode = settings.recording_mode === 'double_tap';

  useGlobalHotkey({
    enabled: settings.global_hotkey_enabled && !setupNeeded,
    hotkey: settings.global_hotkey,
    mode: isDoubleTapMode ? 'double_tap' : 'push_to_talk',
    doubleTapInterval: settings.double_tap_interval,
    onPressed: handleGlobalHotkeyPressed,
    onReleased: handleGlobalHotkeyReleased,
    onToggleRecording: handleToggleRecording,
  });

  const handleSelectHistoryEntry = useCallback((entry: TranslationEntry) => {
    setSelectedEntry({
      transcription: {
        text: entry.original_text,
        detected_language: entry.source_language,
      },
      translation: {
        translated_text: entry.translated_text,
        source_language: entry.source_language,
        target_language: entry.target_language,
      },
    });
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const handleNewRecording = useCallback(() => {
    clearResults();
    setSelectedEntry(null);
  }, [clearResults]);

  const handleManualRecord = useCallback(() => {
    if (setupNeeded) return;
    if (recordingState === 'idle') {
      saveFrontmostApp().catch(() => {});
      startRecording();
    } else if (recordingState === 'recording') {
      handleStopRecording(false);
    }
  }, [setupNeeded, recordingState, startRecording, handleStopRecording]);

  const error = recordingError || translationError;
  const displayTranscription = selectedEntry?.transcription || transcription;
  const displayTranslation = selectedEntry?.translation || translation;
  const hasResults = displayTranscription || displayTranslation;
  const hotkeyLabel = GLOBAL_HOTKEY_OPTIONS.find(o => o.id === settings.global_hotkey)?.label || settings.global_hotkey;

  return (
    <div className="h-screen flex flex-col bg-bg">
      {/* Title bar drag region */}
      <div
        className="h-12 flex items-center justify-between px-4 border-b border-border flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-[13px] font-medium text-text-secondary">
          Whisper Translate
        </span>

        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Record button */}
          <button
            onClick={handleManualRecord}
            disabled={!!setupNeeded || isProcessing}
            className={`icon-btn ${recordingState === 'recording' ? 'active' : ''}`}
            title={recordingState === 'recording' ? 'Stop recording' : 'Start recording'}
          >
            {recordingState === 'recording' ? (
              <div className="w-2.5 h-2.5 bg-red rounded-sm" />
            ) : isProcessing ? (
              <div className="spinner" />
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>

          {/* Settings button */}
          <button
            onClick={() => setShowSettings(true)}
            className="icon-btn"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Setup Warning */}
      {setupNeeded && (
        <div className="mx-4 mt-3 banner-warning">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="flex-1 text-[13px]">{setupNeeded}</p>
            <button
              onClick={() => setShowSettings(true)}
              className="text-[13px] font-medium hover:underline whitespace-nowrap"
            >
              Settings
            </button>
          </div>
        </div>
      )}

      {/* Accessibility Permission Banner */}
      {accessibilityMissing && (
        <div className="mx-4 mt-3 banner-warning">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <p className="flex-1 text-[13px]">Enable Accessibility permission for auto-paste to work</p>
            <button
              onClick={async () => {
                try {
                  await requestAccessibilityPermission();
                } catch {
                  // ignore
                }
              }}
              className="text-[13px] font-medium hover:underline whitespace-nowrap"
            >
              Open Settings
            </button>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-3 banner-error">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-[13px]">{error}</p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Latest result */}
        {hasResults && (
          <div className="p-4">
            {selectedEntry && (
              <button
                onClick={handleNewRecording}
                className="btn-ghost mb-3 text-[13px]"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to latest
              </button>
            )}
            <TranscriptionView
              transcription={displayTranscription}
              translation={displayTranslation}
              isProcessing={isProcessing}
            />
          </div>
        )}

        {/* Empty state */}
        {!hasResults && !setupNeeded && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-20">
            <div className="w-12 h-12 rounded-full bg-surface-2 border border-border flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-text-tertiary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </div>
            {settings.global_hotkey_enabled && isDoubleTapMode ? (
              <>
                <p className="text-text-secondary text-[13px] font-medium mb-1">
                  Double-tap <span className="kbd">{hotkeyLabel}</span> to start recording
                </p>
                <p className="text-[12px] text-text-tertiary">Text will be auto-pasted at your cursor</p>
              </>
            ) : settings.global_hotkey_enabled ? (
              <>
                <p className="text-text-secondary text-[13px] font-medium mb-1">
                  Hold <span className="kbd">{hotkeyLabel}</span> to record
                </p>
                <p className="text-[12px] text-text-tertiary">Release to stop and auto-paste</p>
              </>
            ) : (
              <>
                <p className="text-text-secondary text-[13px] font-medium mb-1">Click the mic button to record</p>
                <p className="text-[12px] text-text-tertiary">Or enable a global hotkey in settings</p>
              </>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="px-4 pb-4">
            {hasResults && <div className="divider mb-3" />}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-medium text-text-tertiary uppercase tracking-wider">History</span>
              <button
                onClick={handleClearHistory}
                className="text-[12px] text-text-ghost hover:text-text-tertiary transition-colors"
              >
                Clear
              </button>
            </div>
            <HistoryList
              entries={history}
              onSelectEntry={handleSelectHistoryEntry}
              onClearHistory={handleClearHistory}
            />
          </div>
        )}
      </main>

      {/* Footer status bar */}
      <div className="px-4 py-2.5 border-t border-border flex-shrink-0">
        <p className="text-[11px] text-text-ghost text-center">
          {settings.translation_enabled ? (
            <>
              {PROVIDER_DISPLAY_INFO[settings.translation_provider].name}
              {' · '}
              {settings.target_language === 'en' ? 'English' : settings.target_language}
            </>
          ) : (
            'Transcription only'
          )}
          {settings.global_hotkey_enabled && (
            <>
              {' · '}
              {hotkeyLabel}
              {isDoubleTapMode ? ' (double-tap)' : ' (hold)'}
            </>
          )}
        </p>
      </div>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSettingsChange={setSettings}
      />
    </div>
  );
}

export default App;
