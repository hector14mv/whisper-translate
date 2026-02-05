import { useState, useCallback, useEffect, useRef } from 'react';
import { RecordButton } from './components/RecordButton';
import { TranscriptionView } from './components/TranscriptionView';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryList } from './components/HistoryList';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useTranslation } from './hooks/useTranslation';
import { useGlobalHotkey } from './hooks/useGlobalHotkey';
import { getApiKey, getWhisperModelStatus, checkOllamaStatus, getApiKeyTypeForProvider, getSettings, saveSettings, copyAndPaste } from './lib/tauri';
import type { TranslationEntry, AppSettings, TranscriptionResult, TranslationResult } from './types';
import { PROVIDER_DISPLAY_INFO, GLOBAL_HOTKEY_OPTIONS } from './types';
import './index.css';

const MAX_HISTORY_ENTRIES = 10;

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TranslationEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    recording_mode: 'click_to_record',
    whisper_model: 'small',
    source_language: 'auto',
    target_language: 'en',
    translation_provider: 'openai',
    translation_model: undefined,
    translation_enabled: true,
    remove_filler_words: false,
    global_hotkey_enabled: false,
    global_hotkey: 'CommandOrControl+Shift+Space',
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState<string | null>(null);
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

        // Auto-paste if triggered by global hotkey
        if (fromHotkey) {
          const textToPaste = entry.translated_text || entry.original_text;
          if (textToPaste) {
            try {
              await copyAndPaste(textToPaste);
            } catch (err) {
              console.error('Failed to auto-paste:', err);
            }
          }
        }
      }
    }
  }, [stopAudioRecording, processAudio, settings.whisper_model, settings.target_language, settings.translation_provider, settings.translation_model, settings.translation_enabled, settings.remove_filler_words]);

  // Global hotkey for system-wide recording (push-to-talk behavior)
  const handleGlobalHotkeyPressed = useCallback(() => {
    if (setupNeeded) return;
    if (recordingState === 'idle') {
      isHotkeyRecordingRef.current = true;
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

  useGlobalHotkey({
    enabled: settings.global_hotkey_enabled && !setupNeeded,
    hotkey: settings.global_hotkey,
    onPressed: handleGlobalHotkeyPressed,
    onReleased: handleGlobalHotkeyReleased,
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
    setShowHistory(false);
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const handleNewRecording = useCallback(() => {
    clearResults();
    setSelectedEntry(null);
  }, [clearResults]);

  const error = recordingError || translationError;
  const displayTranscription = selectedEntry?.transcription || transcription;
  const displayTranslation = selectedEntry?.translation || translation;
  const currentState = isProcessing ? 'processing' : recordingState;

  return (
    <div className="min-h-screen bg-void flex relative overflow-hidden">
      {/* Ambient background orbs */}
      <div className="ambient-orb ambient-orb-1" />
      <div className="ambient-orb ambient-orb-2" />
      <div className="ambient-orb ambient-orb-3" />

      {/* History Sidebar */}
      <div
        className={`
          fixed inset-y-0 left-0 w-72 sidebar transform transition-transform duration-300 z-40
          ${showHistory ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <HistoryList
          entries={history}
          onSelectEntry={handleSelectHistoryEntry}
          onClearHistory={handleClearHistory}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen relative z-10">
        {/* Header */}
        <header className="px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="icon-btn"
            title="History"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>

          <h1 className="font-display text-xl font-semibold text-prismatic">
            Whisper Translate
          </h1>

          <button
            onClick={() => setShowSettings(true)}
            className="icon-btn"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </header>

        {/* Setup Warning */}
        {setupNeeded && (
          <div className="mx-6 mt-2 banner-warning">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="flex-1 flex items-center justify-between">
                <p className="text-sm">{setupNeeded}</p>
                <button
                  onClick={() => setShowSettings(true)}
                  className="text-sm font-medium hover:underline ml-4"
                >
                  Open Settings →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mx-6 mt-2 banner-error">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col px-6 py-4">
          {/* Transcription View */}
          <div className="flex-1 mb-6 max-w-xl mx-auto w-full">
            <TranscriptionView
              transcription={displayTranscription}
              translation={displayTranslation}
              isProcessing={isProcessing}
            />
          </div>

          {/* New Recording Button (when showing history entry) */}
          {selectedEntry && (
            <button
              onClick={handleNewRecording}
              className="mb-4 text-sm text-prism-violet hover:text-prism-pink font-medium text-center transition-colors"
            >
              ← New Recording
            </button>
          )}

          {/* Record Button */}
          <div className="flex justify-center py-6">
            <RecordButton
              recordingState={currentState}
              recordingMode={settings.recording_mode}
              onStartRecording={startRecording}
              onStopRecording={() => handleStopRecording(false)}
              disabled={!!setupNeeded}
            />
          </div>
        </main>

        {/* Footer */}
        <footer className="px-6 py-4">
          <p className="text-xs text-smoke text-center">
            {settings.translation_enabled ? (
              <>
                Speak any language → Translated to{' '}
                <span className="text-mist">{settings.target_language === 'en' ? 'English' : settings.target_language}</span>
                {' · '}
                <span className="text-mist">{PROVIDER_DISPLAY_INFO[settings.translation_provider].name}</span>
              </>
            ) : (
              'Transcription mode · Translation disabled'
            )}
          </p>
          {settings.global_hotkey_enabled && (
            <p className="text-[10px] text-smoke/70 text-center mt-1">
              <span className="inline-flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                Global hotkey:{' '}
                <span className="text-prism-cyan font-medium">
                  {GLOBAL_HOTKEY_OPTIONS.find(o => o.id === settings.global_hotkey)?.label || settings.global_hotkey}
                </span>
              </span>
            </p>
          )}
        </footer>
      </div>

      {/* History Overlay */}
      {showHistory && (
        <div
          className="modal-overlay fixed inset-0 z-30"
          onClick={() => setShowHistory(false)}
        />
      )}

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
