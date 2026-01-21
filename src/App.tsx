import { useState, useCallback, useEffect, useRef } from 'react';
import { RecordButton } from './components/RecordButton';
import { TranscriptionView } from './components/TranscriptionView';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryList } from './components/HistoryList';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useTranslation } from './hooks/useTranslation';
import { getApiKey, getWhisperModelStatus, checkOllamaStatus, getApiKeyTypeForProvider, getSettings, saveSettings } from './lib/tauri';
import type { TranslationEntry, AppSettings, TranscriptionResult, TranslationResult } from './types';
import { PROVIDER_DISPLAY_INFO } from './types';
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
    translation_provider: 'openai', // Default to GPT-4o-mini (best value)
    translation_model: undefined,
    translation_enabled: true,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<{
    transcription: TranscriptionResult;
    translation: TranslationResult;
  } | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

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
    if (!settingsLoaded) return; // Don't save until initial load is complete

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await saveSettings(settings);
      } catch (err) {
        console.error('Failed to save settings:', err);
      }
    }, 500); // 500ms debounce

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
      // Check for API key only if translation is enabled
      if (settings.translation_enabled) {
        const apiKeyType = getApiKeyTypeForProvider(settings.translation_provider);

        if (apiKeyType) {
          const apiKey = await getApiKey(apiKeyType);
          if (!apiKey) {
            const providerName = PROVIDER_DISPLAY_INFO[settings.translation_provider].name;
            setSetupNeeded(`Please configure your ${providerName} API key in Settings.`);
            return;
          }
        } else if (settings.translation_provider === 'ollama') {
          // Check Ollama status
          const status = await checkOllamaStatus();
          if (!status.is_running) {
            setSetupNeeded('Ollama is not running. Please start Ollama or choose a different provider in Settings.');
            return;
          }
          if (status.models.length === 0) {
            setSetupNeeded('No Ollama models installed. Run `ollama pull llama3.2` to get started.');
            return;
          }
        }
      }

      // Check for Whisper model
      const models = await getWhisperModelStatus();
      const hasModel = models.some((m) => m.downloaded);
      if (!hasModel) {
        setSetupNeeded('Please download a Whisper model in Settings.');
        return;
      }

      // Find the selected model or any downloaded model
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

  // Re-check setup when settings panel closes or provider/translation changes
  useEffect(() => {
    if (!showSettings) {
      checkSetup();
    }
  }, [showSettings, settings.translation_provider, settings.translation_enabled]);

  const handleStopRecording = useCallback(async () => {
    const audioPath = await stopAudioRecording();
    if (audioPath) {
      const entry = await processAudio(
        audioPath,
        settings.whisper_model,
        settings.target_language,
        settings.translation_provider,
        settings.translation_model,
        settings.translation_enabled
      );
      if (entry) {
        setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY_ENTRIES));
        setSelectedEntry(null);
      }
    }
  }, [stopAudioRecording, processAudio, settings.whisper_model, settings.target_language, settings.translation_provider, settings.translation_model, settings.translation_enabled]);

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
    <div className="min-h-screen bg-gray-50 flex">
      {/* History Sidebar */}
      <div
        className={`
          fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-100 transform transition-transform duration-300 z-40
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
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Header */}
        <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="History"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>

          <h1 className="text-lg font-semibold text-gray-900">Whisper Translate</h1>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </header>

        {/* Setup Warning */}
        {setupNeeded && (
          <div className="mx-4 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-sm text-amber-800">{setupNeeded}</p>
                <button
                  onClick={() => setShowSettings(true)}
                  className="text-sm text-amber-600 hover:text-amber-700 font-medium mt-1"
                >
                  Open Settings →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mx-4 mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col p-4">
          {/* Transcription View */}
          <div className="flex-1 mb-4">
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
              className="mb-4 text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              ← New Recording
            </button>
          )}

          {/* Record Button */}
          <div className="flex justify-center py-4">
            <RecordButton
              recordingState={currentState}
              recordingMode={settings.recording_mode}
              onStartRecording={startRecording}
              onStopRecording={handleStopRecording}
              disabled={!!setupNeeded}
            />
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-100 px-4 py-2">
          <p className="text-xs text-gray-400 text-center">
            {settings.translation_enabled ? (
              <>
                Speak in any language → Translated to{' '}
                {settings.target_language === 'en' ? 'English' : settings.target_language}
                {' via '}
                {PROVIDER_DISPLAY_INFO[settings.translation_provider].name}
              </>
            ) : (
              'Transcription only mode (translation disabled)'
            )}
          </p>
        </footer>
      </div>

      {/* History Overlay (click to close) */}
      {showHistory && (
        <div
          className="fixed inset-0 bg-black/20 z-30"
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
