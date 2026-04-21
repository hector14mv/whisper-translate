import { useState, useCallback, useEffect, useRef } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { SettingsPanel } from './components/SettingsPanel';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useTranslation } from './hooks/useTranslation';
import { useGlobalHotkey } from './hooks/useGlobalHotkey';
import { getApiKey, getWhisperModelStatus, checkOllamaStatus, getApiKeyTypeForProvider, getSettings, saveSettings, copyAndPaste, showOverlay, hideOverlay, saveFrontmostApp, updateTrayHotkey, updateTrayFillerWords, updateTrayAutoPaste, updateTrayTranslation, updateTraySoundFeedback, updateTrayRecordLabel, playSound } from './lib/tauri';
import type { TranslationEntry, AppSettings } from './types';
import { PROVIDER_DISPLAY_INFO, GLOBAL_HOTKEY_OPTIONS } from './types';
import './index.css';

const MAX_HISTORY_ENTRIES = 50;
const HISTORY_STORAGE_KEY = 'whisper-translate-history';

function loadHistory(): TranslationEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function persistHistory(entries: TranslationEntry[]) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore storage errors */ }
}

const languageNames: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  nl: 'Dutch', pl: 'Polish', tr: 'Turkish', vi: 'Vietnamese',
  th: 'Thai', id: 'Indonesian', uk: 'Ukrainian',
};

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'record' | 'translate'>('record');
  const [history, setHistory] = useState<TranslationEntry[]>(loadHistory);
  // Aligned with Rust AppSettings::default() — any drift here causes a flash
  // between mount-time values and the ones returned by getSettings(), during
  // which hooks like useGlobalHotkey could bind to the wrong hotkey.
  const [settings, setSettings] = useState<AppSettings>({
    recording_mode: 'click_to_record',
    whisper_model: 'large-v3-turbo',
    source_language: 'auto',
    target_language: 'en',
    translation_provider: 'openai',
    translation_model: undefined,
    translation_enabled: true,
    remove_filler_words: false,
    global_hotkey_enabled: false,
    global_hotkey: 'CommandOrControl+Shift+Space',
    double_tap_interval: 400,
    auto_paste_enabled: false,
    sound_feedback: false,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState<string | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const isHotkeyRecordingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const {
    recordingState,
    error: recordingError,
    startRecording,
    stopRecording: stopAudioRecording,
  } = useAudioRecorder();

  const {
    error: translationError,
    processAudio,
  } = useTranslation();

  // Load settings
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

  // Save settings with debounce
  useEffect(() => {
    if (!settingsLoaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(async () => {
      try { await saveSettings(settings); } catch (err) { console.error(err); }
    }, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [settings, settingsLoaded]);

  // Close AudioContext singleton only on unmount (not on every settings change)
  useEffect(() => () => { audioCtxRef.current?.close(); }, []);

  // Sync tray hotkey
  useEffect(() => {
    if (!settingsLoaded) return;
    const hotkey = settings.global_hotkey_enabled ? settings.global_hotkey : null;
    updateTrayHotkey(hotkey).catch(console.error);
  }, [settings.global_hotkey_enabled, settings.global_hotkey, settingsLoaded]);

  // Sync tray filler words
  useEffect(() => {
    if (!settingsLoaded) return;
    updateTrayFillerWords(settings.remove_filler_words).catch(console.error);
  }, [settings.remove_filler_words, settingsLoaded]);

  // Sync tray auto-paste
  useEffect(() => {
    if (!settingsLoaded) return;
    updateTrayAutoPaste(settings.auto_paste_enabled).catch(console.error);
  }, [settings.auto_paste_enabled, settingsLoaded]);

  // Sync tray translation
  useEffect(() => {
    if (!settingsLoaded) return;
    updateTrayTranslation(settings.translation_enabled).catch(console.error);
  }, [settings.translation_enabled, settingsLoaded]);

  // Sync tray sound feedback
  useEffect(() => {
    if (!settingsLoaded) return;
    updateTraySoundFeedback(settings.sound_feedback).catch(console.error);
  }, [settings.sound_feedback, settingsLoaded]);

  // Check setup
  useEffect(() => { checkSetup(); }, []);
  useEffect(() => { if (!showSettings) checkSetup(); }, [showSettings, settings.translation_provider, settings.translation_enabled]);

  const checkSetup = async () => {
    try {
      if (settings.translation_enabled) {
        const apiKeyType = getApiKeyTypeForProvider(settings.translation_provider);
        if (apiKeyType) {
          const apiKey = await getApiKey(apiKeyType);
          if (!apiKey) {
            setSetupNeeded(`Configure your ${PROVIDER_DISPLAY_INFO[settings.translation_provider].name} API key in Settings`);
            return;
          }
        } else if (settings.translation_provider === 'ollama') {
          const status = await checkOllamaStatus();
          if (!status.is_running) { setSetupNeeded('Ollama is not running'); return; }
          if (status.models.length === 0) { setSetupNeeded('No Ollama models installed'); return; }
        }
      }
      const models = await getWhisperModelStatus();
      const hasModel = models.some((m) => m.downloaded);
      if (!hasModel) { setSetupNeeded('Download a Whisper model in Settings'); return; }
      const selectedModel = models.find((m) => m.name === settings.whisper_model && m.downloaded);
      if (!selectedModel) {
        const anyDownloaded = models.find((m) => m.downloaded);
        if (anyDownloaded) {
          setSettings((prev) => ({ ...prev, whisper_model: anyDownloaded.name as AppSettings['whisper_model'] }));
        }
      }
      setSetupNeeded(null);
    } catch (err) { console.error('Setup check failed:', err); }
  };

  // Recording handlers
  const handleStopRecording = useCallback(async (fromHotkey = false) => {
    updateTrayRecordLabel(false).catch(() => {});
    if (fromHotkey) emit('recording-state-change', 'processing');
    const audioPath = await stopAudioRecording();
    if (audioPath) {
      const entry = await processAudio(audioPath, settings.whisper_model, settings.target_language, settings.translation_provider, settings.translation_model, settings.translation_enabled, settings.remove_filler_words);
      if (entry) {
        setHistory((prev) => {
          const updated = [entry, ...prev].slice(0, MAX_HISTORY_ENTRIES);
          persistHistory(updated);
          return updated;
        });

        // Completion "plim" (880 → 1174Hz) — reuse singleton AudioContext
        try {
          if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioContext();
          }
          const ctx = audioCtxRef.current;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.08);
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.25);
        } catch { /* ignore audio errors */ }

        const textToPaste = entry.translated_text || entry.original_text;
        if (textToPaste) {
          if (settings.auto_paste_enabled) {
            // Copy + paste at cursor
            try { await copyAndPaste(textToPaste); } catch (err) { console.error(err); }
          } else {
            // Just copy to clipboard
            try { await navigator.clipboard.writeText(textToPaste); } catch (err) { console.error(err); }
          }
        }
      }
      if (fromHotkey) { try { await hideOverlay(); } catch {} }
    } else if (fromHotkey) { try { await hideOverlay(); } catch {} }
  }, [stopAudioRecording, processAudio, settings.whisper_model, settings.target_language, settings.translation_provider, settings.translation_model, settings.translation_enabled, settings.remove_filler_words, settings.auto_paste_enabled]);

  const handleToggleRecording = useCallback(async () => {
    if (setupNeeded) return;
    if (recordingState === 'idle') {
      isHotkeyRecordingRef.current = true;
      saveFrontmostApp().catch(() => {});
      if (settings.sound_feedback) playSound('Tink').catch(() => {});
      startRecording();
      updateTrayRecordLabel(true).catch(() => {});
      showOverlay().catch(console.error);
    } else if (recordingState === 'recording') {
      if (settings.sound_feedback) playSound('Glass').catch(() => {});
      updateTrayRecordLabel(false).catch(() => {});
      const wasHotkey = isHotkeyRecordingRef.current;
      isHotkeyRecordingRef.current = false;
      handleStopRecording(wasHotkey);
    }
  }, [setupNeeded, recordingState, startRecording, handleStopRecording, settings.sound_feedback]);

  const handleGlobalHotkeyPressed = useCallback(async () => {
    if (setupNeeded || recordingState !== 'idle') return;
    isHotkeyRecordingRef.current = true;
    saveFrontmostApp().catch(() => {});
    if (settings.sound_feedback) playSound('Tink').catch(() => {});
    startRecording();
    updateTrayRecordLabel(true).catch(() => {});
  }, [setupNeeded, recordingState, startRecording, settings.sound_feedback]);

  const handleGlobalHotkeyReleased = useCallback(() => {
    if (recordingState !== 'recording') return;
    if (settings.sound_feedback) playSound('Glass').catch(() => {});
    updateTrayRecordLabel(false).catch(() => {});
    const wasHotkey = isHotkeyRecordingRef.current;
    isHotkeyRecordingRef.current = false;
    handleStopRecording(wasHotkey);
  }, [recordingState, handleStopRecording, settings.sound_feedback]);

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

  // Tray events
  useEffect(() => {
    const u1 = listen('tray-record-toggle', () => { handleToggleRecording(); });
    const u2 = listen('tray-open-settings', () => { setShowSettings(true); });
    const u3 = listen('tray-open-history', () => { setShowSettings(false); });
    const u5 = listen('tray-open-settings-translate', () => { setShowSettings(true); setSettingsTab('translate'); });
    const u4 = listen('tray-settings-changed', async () => {
      // Tray changed a setting in settings.json — reload
      try {
        const fresh = await getSettings();
        setSettings(fresh);
      } catch (err) { console.error(err); }
    });
    return () => { [u1, u2, u3, u4, u5].forEach(u => u.then(f => f())); };
  }, [handleToggleRecording]);

  // Entry interactions
  const handleCopy = useCallback(async (entry: TranslationEntry) => {
    const text = entry.translated_text || entry.original_text;
    await navigator.clipboard.writeText(text);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedEntry((prev) => prev === id ? null : id);
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    persistHistory([]);
    setExpandedEntry(null);
  }, []);

  const error = recordingError || translationError;
  const hotkeyLabel = GLOBAL_HOTKEY_OPTIONS.find(o => o.id === settings.global_hotkey)?.label || settings.global_hotkey;

  return (
    <div className="h-screen flex flex-col bg-bg">
      {/* Title bar */}
      <div
        className="h-12 flex items-center justify-between px-5 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[17px] font-light text-text-primary tracking-wide" style={{ fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif", letterSpacing: '0.04em' }}>
            History
          </h1>
          {history.length > 0 && (
            <span className="text-[11px] text-text-ghost font-medium tabular-nums">
              {history.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {history.length > 0 && (
            <button onClick={handleClearHistory} className="icon-btn" title="Clear history">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button onClick={() => setShowSettings(true)} className="settings-btn" title="Settings">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Setup/Error banners */}
      {setupNeeded && (
        <div className="mx-4 mt-1 banner-warning">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="flex-1 text-[13px]">{setupNeeded}</p>
            <button onClick={() => setShowSettings(true)} className="text-[13px] font-medium hover:underline whitespace-nowrap">Fix</button>
          </div>
        </div>
      )}
      {error && (
        <div className="mx-4 mt-1 banner-error">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-[13px]">{error}</p>
          </div>
        </div>
      )}

      {/* Main content — History */}
      <main className="flex-1 overflow-y-auto">
        {history.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full px-8">
            <div className="history-empty-icon">
              <svg className="w-8 h-8 text-text-ghost" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-[14px] text-text-secondary font-medium mt-5 mb-1.5">No transcriptions yet</p>
            <p className="text-[12px] text-text-tertiary text-center leading-relaxed max-w-[240px]">
              {settings.global_hotkey_enabled ? (
                <>Use <span className="kbd">{hotkeyLabel}</span> to record and your transcriptions will appear here</>
              ) : (
                <>Click Record from the menu bar to start. Your transcriptions will appear here.</>
              )}
            </p>
          </div>
        ) : (
          /* History entries */
          <div className="p-3 space-y-1">
            {history.map((entry) => {
              const isExpanded = expandedEntry === entry.id;
              const isCopied = copiedId === entry.id;
              const displayText = entry.translated_text || entry.original_text;
              const hasTranslation = !!entry.translated_text;
              const srcLang = languageNames[entry.source_language] || entry.source_language;
              const tgtLang = languageNames[entry.target_language] || entry.target_language;

              return (
                <div
                  key={entry.id}
                  className={`history-entry ${isExpanded ? 'expanded' : ''}`}
                >
                  {/* Entry header — always visible */}
                  <button
                    className="history-entry-header"
                    onClick={() => handleToggleExpand(entry.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] text-text-primary leading-snug ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {displayText}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      <span className="text-[10px] text-text-ghost tabular-nums whitespace-nowrap">
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                      <svg
                        className={`w-3.5 h-3.5 text-text-ghost transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="history-entry-body">
                      {/* Language badge */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className="badge badge-accent">
                          {srcLang}
                          {hasTranslation && (
                            <>
                              <svg className="w-2.5 h-2.5 mx-0.5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                              </svg>
                              {tgtLang}
                            </>
                          )}
                        </span>
                      </div>

                      {/* Full translated text */}
                      {hasTranslation && (
                        <div className="mb-3">
                          <p className="text-[11px] text-text-ghost font-medium uppercase tracking-wider mb-1">Translation</p>
                          <p className="text-[13px] text-text-primary leading-relaxed">{entry.translated_text}</p>
                        </div>
                      )}

                      {/* Original text */}
                      <div className="mb-3">
                        <p className="text-[11px] text-text-ghost font-medium uppercase tracking-wider mb-1">
                          {hasTranslation ? 'Original' : 'Transcription'}
                        </p>
                        <p className="text-[13px] text-text-secondary leading-relaxed">{entry.original_text}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopy(entry); }}
                          className="btn-ghost text-[12px]"
                        >
                          {isCopied ? (
                            <>
                              <svg className="w-3.5 h-3.5 text-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Copied
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSettingsChange={setSettings}
        initialTab={settingsTab}
      />
    </div>
  );
}

export default App;
