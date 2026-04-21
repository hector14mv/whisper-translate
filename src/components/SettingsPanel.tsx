import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  saveApiKey,
  getApiKey,
  deleteApiKey,
  validateApiKey,
  getWhisperModelStatus,
  downloadWhisperModel,
  getProviderInfo,
  checkOllamaStatus,
  getApiKeyTypeForProvider,
  type ApiKeyType,
} from '../lib/tauri';
import type { WhisperModelInfo, AppSettings, TranslationProvider, OllamaStatus, ProviderInfo } from '../types';
import { PROVIDER_DISPLAY_INFO, estimateCostPerMinute, GLOBAL_HOTKEY_OPTIONS } from '../types';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  initialTab?: 'record' | 'translate';
}

const PROVIDERS: TranslationProvider[] = ['ollama', 'openai', 'anthropic', 'google'];

type SettingsTab = 'record' | 'translate';

interface DownloadProgress {
  model: string;
  downloaded: number;
  total: number;
  percent: number;
}

export function SettingsPanel({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  initialTab = 'record',
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [apiKeys, setApiKeys] = useState<Record<ApiKeyType, string>>({
    anthropic: '', openai: '', google: '',
  });
  const [hasApiKey, setHasApiKey] = useState<Record<ApiKeyType, boolean>>({
    anthropic: false, openai: false, google: false,
  });
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  // Sync tab when opened from tray
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    const unlisten = listen<DownloadProgress>('download-progress', (event) => {
      setDownloadProgress(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (isOpen) loadSettings();
  }, [isOpen, settings.translation_provider]);

  const loadSettings = async () => {
    try {
      const anthropicKey = await getApiKey('anthropic');
      const openaiKey = await getApiKey('openai');
      const googleKey = await getApiKey('google');

      setHasApiKey({
        anthropic: !!anthropicKey,
        openai: !!openaiKey,
        google: !!googleKey,
      });

      setApiKeys({
        anthropic: anthropicKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + anthropicKey.slice(-4) : '',
        openai: openaiKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + openaiKey.slice(-4) : '',
        google: googleKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + googleKey.slice(-4) : '',
      });

      const modelStatus = await getWhisperModelStatus();
      setModels(modelStatus);

      const info = await getProviderInfo(settings.translation_provider);
      setProviderInfo(info);

      if (settings.translation_provider === 'ollama') {
        const status = await checkOllamaStatus();
        setOllamaStatus(status);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const getCurrentApiKeyType = (): ApiKeyType | null => {
    return getApiKeyTypeForProvider(settings.translation_provider);
  };

  const handleSaveApiKey = async () => {
    const keyType = getCurrentApiKeyType();
    if (!keyType) return;
    const apiKey = apiKeys[keyType];
    if (!apiKey || apiKey.includes('\u2022')) return;

    setIsValidating(true);
    setValidationError(null);

    try {
      const isValid = await validateApiKey(keyType, apiKey);
      if (!isValid) {
        setValidationError(`Invalid API key format. ${getKeyFormatHint(keyType)}`);
        setIsValidating(false);
        return;
      }
      await saveApiKey(keyType, apiKey);
      setHasApiKey((prev) => ({ ...prev, [keyType]: true }));
      setApiKeys((prev) => ({ ...prev, [keyType]: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + apiKey.slice(-4) }));
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsValidating(false);
    }
  };

  const handleDeleteApiKey = async () => {
    const keyType = getCurrentApiKeyType();
    if (!keyType) return;
    try {
      await deleteApiKey(keyType);
      setHasApiKey((prev) => ({ ...prev, [keyType]: false }));
      setApiKeys((prev) => ({ ...prev, [keyType]: '' }));
    } catch (err) {
      console.error('Failed to delete API key:', err);
    }
  };

  const handleApiKeyChange = (value: string) => {
    const keyType = getCurrentApiKeyType();
    if (!keyType) return;
    setApiKeys((prev) => ({ ...prev, [keyType]: value }));
    setValidationError(null);
  };

  const handleProviderChange = async (provider: TranslationProvider) => {
    onSettingsChange({ ...settings, translation_provider: provider, translation_model: undefined });
    const info = await getProviderInfo(provider);
    setProviderInfo(info);
    if (provider === 'ollama') {
      const status = await checkOllamaStatus();
      setOllamaStatus(status);
    }
  };

  const handleDownloadModel = async (modelName: string) => {
    setDownloadingModel(modelName);
    setDownloadProgress(null);
    try {
      await downloadWhisperModel(modelName);
      const modelStatus = await getWhisperModelStatus();
      setModels(modelStatus);
    } catch (err) {
      console.error('Failed to download model:', err);
    } finally {
      setDownloadingModel(null);
      setDownloadProgress(null);
    }
  };

  const getKeyFormatHint = (keyType: ApiKeyType): string => {
    switch (keyType) {
      case 'anthropic': return 'Key should start with "sk-ant-"';
      case 'openai': return 'Key should start with "sk-"';
      case 'google': return 'Key should start with "AIza"';
    }
  };

  const getKeyPlaceholder = (keyType: ApiKeyType): string => {
    switch (keyType) {
      case 'anthropic': return 'sk-ant-...';
      case 'openai': return 'sk-...';
      case 'google': return 'AIza...';
    }
  };

  if (!isOpen) return null;

  const currentKeyType = getCurrentApiKeyType();
  const currentApiKey = currentKeyType ? apiKeys[currentKeyType] : '';
  const currentHasKey = currentKeyType ? hasApiKey[currentKeyType] : false;

  return (
    <div className="absolute inset-0 flex flex-col bg-bg z-50">
      {/* Header */}
      <div
        className="flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Top bar with back + title */}
        <div className="h-12 flex items-center px-3">
          <button
            onClick={onClose}
            className="btn-ghost text-[13px]"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            History
          </button>
          <h1
            className="flex-1 text-center text-[17px] font-light text-text-primary tracking-wide"
            style={{ fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif", letterSpacing: '0.04em' }}
          >
            Settings
          </h1>
          <div className="w-[72px]" />
        </div>

        {/* Segmented control */}
        <div className="px-5 pb-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="segmented-control">
            <div
              className="segmented-indicator"
              style={{ transform: activeTab === 'record' ? 'translateX(0)' : 'translateX(100%)' }}
            />
            <button
              className={`segmented-btn ${activeTab === 'record' ? 'active' : ''}`}
              onClick={() => setActiveTab('record')}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
              Record
            </button>
            <button
              className={`segmented-btn ${activeTab === 'translate' ? 'active' : ''}`}
              onClick={() => setActiveTab('translate')}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
              </svg>
              Translate
            </button>
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 pt-0 space-y-6">
          {activeTab === 'record' ? (
            /* ================================ */
            /* RECORD TAB                       */
            /* ================================ */
            <>
              {/* Whisper Model */}
              <Section title="Whisper Model">
                <div className="space-y-1.5">
                  {models.map((model) => {
                    const isSelected = settings.whisper_model === model.name;
                    const isDownloading = downloadingModel === model.name;
                    const progress = isDownloading && downloadProgress?.model === model.name ? downloadProgress : null;

                    return (
                      <div
                        key={model.name}
                        onClick={() => model.downloaded && onSettingsChange({ ...settings, whisper_model: model.name as AppSettings['whisper_model'] })}
                        className={`card-interactive px-3 py-2.5 ${isSelected && model.downloaded ? 'selected' : ''} ${!model.downloaded && !isDownloading ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${isSelected && model.downloaded ? 'bg-accent' : 'bg-text-ghost'}`} />
                            <div>
                              <span className="text-[13px] font-medium text-text-primary capitalize">{model.name}</span>
                              <div className="text-[11px] text-text-tertiary">
                                {model.size_mb >= 1000 ? `${(model.size_mb / 1000).toFixed(1)} GB` : `${model.size_mb} MB`}
                                {' \u00b7 '}
                                {model.name === 'large-v3-turbo' && 'Fast & accurate \u00b7 Recommended'}
                                {model.name === 'large-v3' && 'Highest accuracy \u00b7 Slower'}
                              </div>
                            </div>
                          </div>
                          {model.downloaded ? (
                            <span className="badge badge-green">Ready</span>
                          ) : isDownloading ? (
                            <span className="text-[11px] text-accent font-medium tabular-nums">
                              {progress ? `${Math.round(progress.percent)}%` : 'Starting...'}
                            </span>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDownloadModel(model.name); }}
                              disabled={downloadingModel !== null}
                              className="btn-primary text-[12px] py-1.5 px-3"
                            >
                              Download
                            </button>
                          )}
                        </div>
                        {isDownloading && progress && (
                          <div className="mt-2.5 ml-4">
                            <div className="progress-bar">
                              <div className="progress-bar-fill" style={{ width: `${progress.percent}%` }} />
                            </div>
                            <div className="flex justify-between mt-1">
                              <span className="text-[10px] text-text-ghost">
                                {(progress.downloaded / 1024 / 1024).toFixed(0)} / {(progress.total / 1024 / 1024).toFixed(0)} MB
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* Recording Mode */}
              <Section title="Recording Mode">
                <div className="space-y-1.5">
                  {([
                    { id: 'click_to_record' as const, name: 'Click to Record', desc: 'Tap to start, tap again to stop' },
                    { id: 'push_to_talk' as const, name: 'Push to Talk', desc: 'Hold to record, release to stop' },
                    { id: 'double_tap' as const, name: 'Double Tap', desc: 'Double-tap hotkey to start/stop' },
                  ]).map((mode) => (
                    <div
                      key={mode.id}
                      onClick={() => onSettingsChange({ ...settings, recording_mode: mode.id })}
                      className={`card-interactive px-3 py-2.5 ${settings.recording_mode === mode.id ? 'selected' : ''}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${settings.recording_mode === mode.id ? 'bg-accent' : 'bg-text-ghost'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-text-primary">{mode.name}</span>
                          </div>
                          <span className="text-[11px] text-text-tertiary">{mode.desc}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Global Hotkey */}
              <Section title="Global Hotkey">
                <ToggleRow
                  label="Enable Global Hotkey"
                  description="Record from any app"
                  checked={settings.global_hotkey_enabled}
                  onChange={() => onSettingsChange({ ...settings, global_hotkey_enabled: !settings.global_hotkey_enabled })}
                />
                {settings.global_hotkey_enabled && (
                  <div className="mt-3 space-y-1.5">
                    {GLOBAL_HOTKEY_OPTIONS.map((option) => (
                      <div
                        key={option.id}
                        onClick={() => onSettingsChange({ ...settings, global_hotkey: option.id })}
                        className={`card-interactive px-3 py-2.5 ${settings.global_hotkey === option.id ? 'selected' : ''}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${settings.global_hotkey === option.id ? 'bg-accent' : 'bg-text-ghost'}`} />
                          <div>
                            <span className="text-[13px] font-medium text-text-primary">{option.label}</span>
                            <span className="text-[11px] text-text-tertiary ml-2">{option.description}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    <p className="text-[11px] text-text-ghost mt-2">
                      {settings.recording_mode === 'double_tap'
                        ? 'Double-tap to start, double-tap again to stop.'
                        : 'Hold to record, release to stop. Works system-wide.'}
                    </p>
                  </div>
                )}
              </Section>

              {/* Options */}
              <Section title="Options">
                <ToggleRow
                  label="Auto-paste"
                  description="Paste transcription at cursor automatically"
                  checked={settings.auto_paste_enabled}
                  onChange={() => onSettingsChange({ ...settings, auto_paste_enabled: !settings.auto_paste_enabled })}
                />
                <ToggleRow
                  label="Remove Filler Words"
                  description="Clean up um, uh, like, etc."
                  checked={settings.remove_filler_words}
                  onChange={() => onSettingsChange({ ...settings, remove_filler_words: !settings.remove_filler_words })}
                />
                <ToggleRow
                  label="Sound Feedback"
                  description="Play sound on start/stop recording"
                  checked={settings.sound_feedback}
                  onChange={() => onSettingsChange({ ...settings, sound_feedback: !settings.sound_feedback })}
                />
              </Section>
            </>
          ) : (
            /* ================================ */
            /* TRANSLATE TAB                    */
            /* ================================ */
            <>
              {/* Enable Translation */}
              <Section title="Translation">
                <ToggleRow
                  label="Enable Translation"
                  description="When off, transcription only"
                  checked={settings.translation_enabled}
                  onChange={() => onSettingsChange({ ...settings, translation_enabled: !settings.translation_enabled })}
                />
              </Section>

              {settings.translation_enabled && (
                <>
                  {/* Translation Provider */}
                  <Section title="Provider">
                    <div className="space-y-1.5">
                      {PROVIDERS.map((provider) => {
                        const info = PROVIDER_DISPLAY_INFO[provider];
                        const costPerMinute = estimateCostPerMinute(provider);
                        const isSelected = settings.translation_provider === provider;
                        const isOllama = provider === 'ollama';
                        const keyType = getApiKeyTypeForProvider(provider);
                        const needsKey = keyType !== null;
                        const missingKey = needsKey && !hasApiKey[keyType];
                        const ollamaDown = isOllama && ollamaStatus && !ollamaStatus.is_running;

                        return (
                          <div
                            key={provider}
                            onClick={() => handleProviderChange(provider)}
                            className={`card-interactive px-3 py-2.5 ${isSelected ? 'selected' : ''}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-accent' : 'bg-text-ghost'}`} />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-medium text-text-primary">{info.name}</span>
                                    {isOllama && <span className="badge badge-green">FREE</span>}
                                    {missingKey && <span className="badge badge-yellow">No key</span>}
                                    {ollamaDown && <span className="badge badge-red">Offline</span>}
                                  </div>
                                  <span className="text-[11px] text-text-tertiary">{info.description}</span>
                                </div>
                              </div>
                              <span className="text-[11px] font-medium text-text-tertiary">
                                {isOllama ? '$0/min' : `~$${costPerMinute.toFixed(4)}/min`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Section>

                  {/* API Key */}
                  {currentKeyType && providerInfo && (
                    <Section
                      title={`${PROVIDER_DISPLAY_INFO[settings.translation_provider].name} API Key`}
                      action={
                        <button
                          onClick={() => window.open(providerInfo.api_key_url, '_blank')}
                          className="text-[11px] text-accent hover:text-accent-hover transition-colors font-medium"
                        >
                          Get key
                        </button>
                      }
                    >
                      <div className="flex gap-2">
                        <input
                          type={currentApiKey.includes('\u2022') ? 'text' : 'password'}
                          value={currentApiKey}
                          onChange={(e) => handleApiKeyChange(e.target.value)}
                          placeholder={getKeyPlaceholder(currentKeyType)}
                          className="input-field flex-1"
                        />
                        {currentHasKey ? (
                          <button onClick={handleDeleteApiKey} className="btn-secondary text-red text-[13px]">
                            Remove
                          </button>
                        ) : (
                          <button
                            onClick={handleSaveApiKey}
                            disabled={isValidating || !currentApiKey}
                            className="btn-primary text-[13px]"
                          >
                            {isValidating ? 'Saving...' : 'Save'}
                          </button>
                        )}
                      </div>
                      {validationError && (
                        <p className="text-[12px] text-red mt-2">{validationError}</p>
                      )}
                      <p className="text-[11px] text-text-ghost mt-2">Stored in macOS Keychain</p>
                    </Section>
                  )}

                  {/* Ollama Status */}
                  {settings.translation_provider === 'ollama' && (
                    <Section title="Ollama Status">
                      {ollamaStatus ? (
                        ollamaStatus.is_running ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-green">
                              <div className="w-1.5 h-1.5 rounded-full bg-green" />
                              <span className="text-[13px] font-medium">Running</span>
                            </div>
                            {ollamaStatus.models.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {ollamaStatus.models.map((model) => (
                                  <span key={model} className="badge badge-accent">{model}</span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[12px] text-yellow">
                                No models. Run <code className="bg-surface-2 px-1 py-0.5 rounded text-text-secondary">ollama pull qwen2.5</code>
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-red">
                              <div className="w-1.5 h-1.5 rounded-full bg-red" />
                              <span className="text-[13px] font-medium">Not running</span>
                            </div>
                            <p className="text-[12px] text-text-tertiary">
                              Run <code className="bg-surface-2 px-1 py-0.5 rounded text-text-secondary">ollama serve</code> in your terminal
                            </p>
                          </div>
                        )
                      ) : (
                        <p className="text-[13px] text-text-tertiary">Checking...</p>
                      )}
                    </Section>
                  )}

                  {/* Target Language */}
                  <Section title="Target Language">
                    <select
                      value={settings.target_language}
                      onChange={(e) => onSettingsChange({ ...settings, target_language: e.target.value })}
                      className="input-field"
                    >
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="it">Italian</option>
                      <option value="pt">Portuguese</option>
                      <option value="zh">Chinese</option>
                      <option value="ja">Japanese</option>
                      <option value="ko">Korean</option>
                      <option value="ru">Russian</option>
                      <option value="ar">Arabic</option>
                      <option value="hi">Hindi</option>
                      <option value="nl">Dutch</option>
                      <option value="pl">Polish</option>
                      <option value="tr">Turkish</option>
                      <option value="vi">Vietnamese</option>
                      <option value="th">Thai</option>
                      <option value="id">Indonesian</option>
                      <option value="uk">Ukrainian</option>
                    </select>
                  </Section>
                </>
              )}

              {/* Empty state when translation is off */}
              {!settings.translation_enabled && (
                <div className="flex flex-col items-center justify-center py-12 px-6">
                  <div className="history-empty-icon mb-4">
                    <svg className="w-7 h-7 text-text-ghost" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                    </svg>
                  </div>
                  <p className="text-[13px] text-text-tertiary text-center">
                    Translation is disabled. Enable it above to configure providers and languages.
                  </p>
                </div>
              )}
            </>
          )}

          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[12px] font-medium text-text-tertiary uppercase tracking-wider">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div>
        <p className="text-[13px] font-medium text-text-primary">{label}</p>
        <p className="text-[11px] text-text-tertiary">{description}</p>
      </div>
      <div
        onClick={onChange}
        className={`toggle-switch ${checked ? 'active' : ''}`}
      />
    </div>
  );
}
