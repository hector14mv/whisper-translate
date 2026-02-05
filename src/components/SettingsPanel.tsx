import { useState, useEffect } from 'react';
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
import { PROVIDER_DISPLAY_INFO, estimateCostPerMinute, getCostBreakdown, GLOBAL_HOTKEY_OPTIONS } from '../types';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

const PROVIDERS: TranslationProvider[] = ['ollama', 'openai', 'anthropic', 'google'];

// Cost Info Tooltip Component
function CostInfoTooltip({ provider }: { provider: TranslationProvider }) {
  const [isVisible, setIsVisible] = useState(false);
  const breakdown = getCostBreakdown(provider);

  if (provider === 'ollama') return null;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="ml-1.5 text-smoke hover:text-mist transition-colors"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsVisible(!isVisible);
        }}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      {isVisible && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-4 glass-panel text-xs">
          <div className="font-semibold text-cloud mb-3">Cost Calculation</div>

          <div className="space-y-2 text-mist">
            <div className="flex justify-between">
              <span>Speech rate:</span>
              <span className="text-cloud">{breakdown.wordsPerMinute} words/min</span>
            </div>
            <div className="flex justify-between">
              <span>Tokens per word:</span>
              <span className="text-cloud">~{breakdown.tokensPerWord}</span>
            </div>
            <div className="flex justify-between">
              <span>Speech tokens:</span>
              <span className="text-cloud">{breakdown.speechTokensPerMinute}/min</span>
            </div>
            <div className="flex justify-between">
              <span>Prompt overhead:</span>
              <span className="text-cloud">+{breakdown.promptOverheadTokens} tokens</span>
            </div>

            <div className="border-t border-glass-border my-2" />

            <div className="flex justify-between">
              <span>Input tokens:</span>
              <span className="text-cloud">{breakdown.totalInputTokens}</span>
            </div>
            <div className="flex justify-between">
              <span>Output tokens:</span>
              <span className="text-cloud">{breakdown.totalOutputTokens}</span>
            </div>

            <div className="border-t border-glass-border my-2" />

            <div className="flex justify-between text-[10px]">
              <span>Input price:</span>
              <span className="text-cloud">${breakdown.inputPricePerMillion}/M</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span>Output price:</span>
              <span className="text-cloud">${breakdown.outputPricePerMillion}/M</span>
            </div>

            <div className="border-t border-glass-border my-2" />

            <div className="flex justify-between font-medium">
              <span>Total:</span>
              <span className="text-prism-green">${breakdown.totalCost.toFixed(6)}/min</span>
            </div>

            {breakdown.hasCaching && breakdown.cachedCost && (
              <div className="flex justify-between text-[10px] text-prism-cyan">
                <span>With caching:</span>
                <span>${breakdown.cachedCost.toFixed(6)}/min</span>
              </div>
            )}
          </div>

          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-obsidian" />
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
}: SettingsPanelProps) {
  const [apiKeys, setApiKeys] = useState<Record<ApiKeyType, string>>({
    anthropic: '',
    openai: '',
    google: '',
  });
  const [hasApiKey, setHasApiKey] = useState<Record<ApiKeyType, boolean>>({
    anthropic: false,
    openai: false,
    google: false,
  });
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
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
        anthropic: anthropicKey ? '••••••••••••••••' + anthropicKey.slice(-4) : '',
        openai: openaiKey ? '••••••••••••••••' + openaiKey.slice(-4) : '',
        google: googleKey ? '••••••••••••••••' + googleKey.slice(-4) : '',
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
    if (!apiKey || apiKey.includes('•')) return;

    setIsValidating(true);
    setValidationError(null);

    try {
      const isValid = await validateApiKey(keyType, apiKey);
      if (!isValid) {
        const formatHint = getKeyFormatHint(keyType);
        setValidationError(`Invalid API key format. ${formatHint}`);
        setIsValidating(false);
        return;
      }

      await saveApiKey(keyType, apiKey);
      setHasApiKey((prev) => ({ ...prev, [keyType]: true }));
      setApiKeys((prev) => ({ ...prev, [keyType]: '••••••••••••••••' + apiKey.slice(-4) }));
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
    try {
      await downloadWhisperModel(modelName);
      const modelStatus = await getWhisperModelStatus();
      setModels(modelStatus);
    } catch (err) {
      console.error('Failed to download model:', err);
    } finally {
      setDownloadingModel(null);
    }
  };

  const openExternalLink = (url: string) => {
    window.open(url, '_blank');
  };

  const getKeyFormatHint = (keyType: ApiKeyType): string => {
    switch (keyType) {
      case 'anthropic':
        return 'Key should start with "sk-ant-"';
      case 'openai':
        return 'Key should start with "sk-"';
      case 'google':
        return 'Key should start with "AIza"';
    }
  };

  const getKeyPlaceholder = (keyType: ApiKeyType): string => {
    switch (keyType) {
      case 'anthropic':
        return 'sk-ant-...';
      case 'openai':
        return 'sk-...';
      case 'google':
        return 'AIza...';
    }
  };

  if (!isOpen) return null;

  const currentKeyType = getCurrentApiKeyType();
  const currentApiKey = currentKeyType ? apiKeys[currentKeyType] : '';
  const currentHasKey = currentKeyType ? hasApiKey[currentKeyType] : false;

  return (
    <div className="modal-overlay fixed inset-0 flex items-center justify-center z-50">
      <div className="modal-content w-full max-w-md max-h-[90vh] overflow-y-auto m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-glass-border">
          <h2 className="text-lg font-semibold text-snow font-display">Settings</h2>
          <button
            onClick={onClose}
            className="icon-btn w-8 h-8"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Translation Provider Section */}
          <section>
            <h3 className="text-sm font-semibold text-cloud mb-3">Translation Provider</h3>
            <div className="space-y-2">
              {PROVIDERS.map((provider) => {
                const info = PROVIDER_DISPLAY_INFO[provider];
                const costPerMinute = estimateCostPerMinute(provider);
                const isSelected = settings.translation_provider === provider;
                const isOllama = provider === 'ollama';

                return (
                  <div
                    key={provider}
                    onClick={() => handleProviderChange(provider)}
                    className={`provider-card ${isSelected ? 'selected' : ''} ${isOllama ? 'border-prism-green/30 hover:border-prism-green/50' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${isSelected ? (isOllama ? 'bg-prism-green' : 'bg-prism-violet') : 'bg-smoke'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-cloud">{info.name}</p>
                            {isOllama && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-prism-green/20 text-prism-green rounded">
                                FREE
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-smoke">{info.description}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-medium flex items-center ${isOllama ? 'text-prism-green' : 'text-mist'}`}>
                        {isOllama
                          ? '$0.00/min'
                          : `~$${costPerMinute.toFixed(4)}/min`}
                        <CostInfoTooltip provider={provider} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-smoke mt-3">
              Based on ~150 words/min + prompt overhead
            </p>
          </section>

          {/* API Key Section */}
          {currentKeyType && providerInfo && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-cloud">
                  {PROVIDER_DISPLAY_INFO[settings.translation_provider].name} API Key
                </h3>
                <button
                  onClick={() => openExternalLink(providerInfo.api_key_url)}
                  className="text-xs text-prism-violet hover:text-prism-pink transition-colors font-medium"
                >
                  Get API Key →
                </button>
              </div>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type={currentApiKey.includes('•') ? 'text' : 'password'}
                    value={currentApiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder={getKeyPlaceholder(currentKeyType)}
                    className="input-field flex-1"
                  />
                  {currentHasKey ? (
                    <button
                      onClick={handleDeleteApiKey}
                      className="btn-secondary text-prism-red"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={handleSaveApiKey}
                      disabled={isValidating || !currentApiKey}
                      className="btn-primary disabled:opacity-50"
                    >
                      {isValidating ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </div>
                {validationError && (
                  <p className="text-sm text-prism-red">{validationError}</p>
                )}
                <p className="text-xs text-smoke">
                  Stored securely in macOS Keychain
                </p>
              </div>
            </section>
          )}

          {/* Ollama Status Section */}
          {settings.translation_provider === 'ollama' && (
            <section>
              <h3 className="text-sm font-semibold text-cloud mb-3">Ollama Status</h3>
              {ollamaStatus ? (
                ollamaStatus.is_running ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-prism-green">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-medium">Ollama is running</span>
                    </div>

                    {/* Recommended Models Section */}
                    <div className="glass-panel-sm p-3 space-y-2">
                      <p className="text-xs font-semibold text-cloud mb-2">Recommended for Translation</p>
                      {[
                        { id: 'qwen2.5', name: 'Qwen 2.5', badge: 'BEST', desc: 'Excellent multilingual support', badgeColor: 'bg-prism-green/20 text-prism-green' },
                        { id: 'llama3.2', name: 'Llama 3.2', badge: null, desc: 'Fast, good for European languages', badgeColor: '' },
                        { id: 'mistral', name: 'Mistral', badge: null, desc: 'Balanced quality and speed', badgeColor: '' },
                      ].map((model) => {
                        const isInstalled = ollamaStatus.models.some(m => m.startsWith(model.id));
                        return (
                          <div key={model.id} className="flex items-center justify-between py-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-mist">{model.name}</span>
                              {model.badge && (
                                <span className={`px-1.5 py-0.5 text-[9px] font-bold ${model.badgeColor} rounded`}>
                                  {model.badge}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-smoke">{model.desc}</span>
                              {isInstalled ? (
                                <span className="text-[10px] text-prism-green font-medium">Installed</span>
                              ) : (
                                <span className="text-[10px] text-smoke">ollama pull {model.id}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {ollamaStatus.models.length > 0 ? (
                      <div>
                        <p className="text-xs text-smoke mb-2">Your models:</p>
                        <div className="flex flex-wrap gap-1">
                          {ollamaStatus.models.map((model) => (
                            <span
                              key={model}
                              className="px-2 py-1 glass-panel-sm text-xs text-mist"
                            >
                              {model}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-prism-yellow">
                        No models installed. Run `ollama pull qwen2.5` to get started with the best translation model.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-prism-red">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-medium">Ollama is not running</span>
                    </div>
                    <p className="text-xs text-smoke">
                      Run `ollama serve` in your terminal
                    </p>
                    <button
                      onClick={() => openExternalLink('https://ollama.com/download')}
                      className="text-xs text-prism-violet hover:text-prism-pink font-medium transition-colors"
                    >
                      Download Ollama →
                    </button>
                  </div>
                )
              ) : (
                <p className="text-sm text-smoke">Checking status...</p>
              )}
            </section>
          )}

          {/* Whisper Model Section */}
          <section>
            <h3 className="text-sm font-semibold text-cloud mb-3">Whisper Model</h3>
            <div className="space-y-2">
              {models.map((model) => {
                const isSelected = settings.whisper_model === model.name;
                return (
                  <div
                    key={model.name}
                    onClick={() => model.downloaded && onSettingsChange({ ...settings, whisper_model: model.name as AppSettings['whisper_model'] })}
                    className={`provider-card ${isSelected ? 'selected' : ''} ${!model.downloaded ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${isSelected && model.downloaded ? 'bg-prism-violet' : 'bg-smoke'}`} />
                        <div>
                          <p className="font-medium text-cloud capitalize">{model.name}</p>
                          <p className="text-xs text-smoke">
                            {model.size_mb >= 1000
                              ? `${(model.size_mb / 1000).toFixed(1)} GB`
                              : `${model.size_mb} MB`}
                            {' · '}
                            {model.name === 'small' && 'Good · Fast'}
                            {model.name === 'medium' && 'Better · Medium'}
                            {model.name === 'large' && 'Best · Slower'}
                          </p>
                        </div>
                      </div>
                      {model.downloaded ? (
                        <span className="text-xs text-prism-green font-medium">Ready</span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadModel(model.name);
                          }}
                          disabled={downloadingModel !== null}
                          className="text-xs btn-primary py-1.5 px-3"
                        >
                          {downloadingModel === model.name ? 'Loading...' : 'Download'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Recording Mode Section */}
          <section>
            <h3 className="text-sm font-semibold text-cloud mb-3">Recording Mode</h3>
            <div className="space-y-2">
              <div
                onClick={() => onSettingsChange({ ...settings, recording_mode: 'click_to_record' })}
                className={`provider-card ${settings.recording_mode === 'click_to_record' ? 'selected' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${settings.recording_mode === 'click_to_record' ? 'bg-prism-violet' : 'bg-smoke'}`} />
                  <div>
                    <p className="font-medium text-cloud">Click to Record</p>
                    <p className="text-xs text-smoke">Tap to start, tap again to stop</p>
                  </div>
                </div>
              </div>
              <div
                onClick={() => onSettingsChange({ ...settings, recording_mode: 'push_to_talk' })}
                className={`provider-card ${settings.recording_mode === 'push_to_talk' ? 'selected' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${settings.recording_mode === 'push_to_talk' ? 'bg-prism-violet' : 'bg-smoke'}`} />
                  <div>
                    <p className="font-medium text-cloud">Push to Talk</p>
                    <p className="text-xs text-smoke">Hold to record, release to stop</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Translation Toggle Section */}
          <section>
            <div className="flex items-center justify-between p-4 glass-panel-sm">
              <div>
                <h3 className="text-sm font-semibold text-cloud">Enable Translation</h3>
                <p className="text-xs text-smoke">When off, shows transcription only</p>
              </div>
              <div
                onClick={() => onSettingsChange({ ...settings, translation_enabled: !settings.translation_enabled })}
                className={`toggle-switch ${settings.translation_enabled ? 'active' : ''}`}
              />
            </div>
          </section>

          {/* Filler Word Removal Section */}
          <section>
            <div className="flex items-center justify-between p-4 glass-panel-sm">
              <div>
                <h3 className="text-sm font-semibold text-cloud">Remove Filler Words</h3>
                <p className="text-xs text-smoke">Clean up um, uh, like, you know, etc.</p>
              </div>
              <div
                onClick={() => onSettingsChange({ ...settings, remove_filler_words: !settings.remove_filler_words })}
                className={`toggle-switch ${settings.remove_filler_words ? 'active' : ''}`}
              />
            </div>
          </section>

          {/* Target Language Section */}
          {settings.translation_enabled && (
            <section>
              <h3 className="text-sm font-semibold text-cloud mb-3">Target Language</h3>
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
            </section>
          )}

          {/* Global Hotkey Section */}
          <section>
            <h3 className="text-sm font-semibold text-cloud mb-3">Global Hotkey</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 glass-panel-sm">
                <div>
                  <p className="font-medium text-cloud">Enable Global Hotkey</p>
                  <p className="text-xs text-smoke">Record from anywhere with a keyboard shortcut</p>
                </div>
                <div
                  onClick={() => onSettingsChange({ ...settings, global_hotkey_enabled: !settings.global_hotkey_enabled })}
                  className={`toggle-switch ${settings.global_hotkey_enabled ? 'active' : ''}`}
                />
              </div>

              {settings.global_hotkey_enabled && (
                <>
                  <div className="space-y-2">
                    {GLOBAL_HOTKEY_OPTIONS.map((option) => (
                      <div
                        key={option.id}
                        onClick={() => onSettingsChange({ ...settings, global_hotkey: option.id })}
                        className={`provider-card ${settings.global_hotkey === option.id ? 'selected' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${settings.global_hotkey === option.id ? 'bg-prism-violet' : 'bg-smoke'}`} />
                            <div>
                              <p className="font-medium text-cloud">{option.label}</p>
                              <p className="text-xs text-smoke">{option.description}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-smoke">
                    Hold the hotkey to record, release to stop. Works system-wide when app is running.
                  </p>
                  <p className="text-[10px] text-prism-yellow">
                    Note: You may need to grant Accessibility permissions in System Settings → Privacy & Security → Accessibility.
                  </p>
                </>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-glass-border">
          <button onClick={onClose} className="btn-primary w-full">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
