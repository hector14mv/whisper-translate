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
import { PROVIDER_DISPLAY_INFO, estimateCostPerMinute } from '../types';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

const PROVIDERS: TranslationProvider[] = ['openai', 'anthropic', 'google', 'ollama'];

export function SettingsPanel({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
}: SettingsPanelProps) {
  // API Key states for each provider
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

  // Whisper model states
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);

  // Provider states
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen, settings.translation_provider]);

  const loadSettings = async () => {
    try {
      // Load API keys for all providers
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

      // Load Whisper model status
      const modelStatus = await getWhisperModelStatus();
      setModels(modelStatus);

      // Load provider info
      const info = await getProviderInfo(settings.translation_provider);
      setProviderInfo(info);

      // Load Ollama status if Ollama is selected
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
      // Validate the key format
      const isValid = await validateApiKey(keyType, apiKey);
      if (!isValid) {
        const formatHint = getKeyFormatHint(keyType);
        setValidationError(`Invalid API key format. ${formatHint}`);
        setIsValidating(false);
        return;
      }

      // Save to keychain
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

    // Load provider info
    const info = await getProviderInfo(provider);
    setProviderInfo(info);

    // Load Ollama status if switching to Ollama
    if (provider === 'ollama') {
      const status = await checkOllamaStatus();
      setOllamaStatus(status);
    }
  };

  const handleDownloadModel = async (modelName: string) => {
    setDownloadingModel(modelName);
    try {
      await downloadWhisperModel(modelName);
      // Reload model status
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Translation Provider Section */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Translation Provider</h3>
            <div className="space-y-2">
              {PROVIDERS.map((provider) => {
                const info = PROVIDER_DISPLAY_INFO[provider];
                const costPerMinute = estimateCostPerMinute(provider);
                const isSelected = settings.translation_provider === provider;

                return (
                  <label
                    key={provider}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="translation_provider"
                      checked={isSelected}
                      onChange={() => handleProviderChange(provider)}
                      className="w-4 h-4 text-primary-600"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-gray-900">{info.name}</p>
                        <span className={`text-xs font-medium ${provider === 'ollama' ? 'text-green-600' : 'text-gray-500'}`}>
                          {provider === 'ollama'
                            ? 'Free (local)'
                            : `~$${costPerMinute.toFixed(4)}/min`}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">{info.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Cost estimates based on ~150 words per minute of speech
            </p>
          </section>

          {/* API Key Section (for providers that need it) */}
          {currentKeyType && providerInfo && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">
                  {PROVIDER_DISPLAY_INFO[settings.translation_provider].name} API Key
                </h3>
                <button
                  onClick={() => openExternalLink(providerInfo.api_key_url)}
                  className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  Get API Key →
                </button>
              </div>
              <div className="space-y-2">
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
                      className="btn-secondary text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={handleSaveApiKey}
                      disabled={isValidating || !currentApiKey}
                      className="btn-primary"
                    >
                      {isValidating ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </div>
                {validationError && (
                  <p className="text-sm text-red-600">{validationError}</p>
                )}
                <p className="text-xs text-gray-500">
                  Your API key is stored securely in the macOS Keychain.
                </p>
              </div>
            </section>
          )}

          {/* Ollama Status Section */}
          {settings.translation_provider === 'ollama' && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Ollama Status</h3>
              {ollamaStatus ? (
                ollamaStatus.is_running ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-green-600">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-medium">Ollama is running</span>
                    </div>
                    {ollamaStatus.models.length > 0 ? (
                      <div>
                        <p className="text-xs text-gray-500 mb-2">Available models:</p>
                        <div className="flex flex-wrap gap-1">
                          {ollamaStatus.models.map((model) => (
                            <span
                              key={model}
                              className="px-2 py-1 bg-gray-100 rounded text-xs text-gray-700"
                            >
                              {model}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-600">
                        No models installed. Run `ollama pull llama3.2` to get started.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-red-600">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-medium">Ollama is not running</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Start Ollama by running `ollama serve` in your terminal.
                    </p>
                    <button
                      onClick={() => openExternalLink('https://ollama.com/download')}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Download Ollama →
                    </button>
                  </div>
                )
              ) : (
                <p className="text-sm text-gray-500">Checking Ollama status...</p>
              )}
            </section>
          )}

          {/* Whisper Model Section */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Whisper Model</h3>
            <div className="space-y-2">
              {models.map((model) => (
                <div
                  key={model.name}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    settings.whisper_model === model.name
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="whisper_model"
                      checked={settings.whisper_model === model.name}
                      onChange={() => onSettingsChange({ ...settings, whisper_model: model.name as AppSettings['whisper_model'] })}
                      disabled={!model.downloaded}
                      className="w-4 h-4 text-primary-600"
                    />
                    <div>
                      <p className="font-medium text-gray-900 capitalize">{model.name}</p>
                      <p className="text-xs text-gray-500">
                        {model.size_mb >= 1000
                          ? `${(model.size_mb / 1000).toFixed(1)} GB`
                          : `${model.size_mb} MB`}
                        {' · '}
                        {model.name === 'small' && 'Good quality · Fast'}
                        {model.name === 'medium' && 'Better quality · Medium speed'}
                        {model.name === 'large' && 'Best quality · Slower'}
                      </p>
                    </div>
                  </div>
                  {model.downloaded ? (
                    <span className="text-xs text-green-600 font-medium">Downloaded</span>
                  ) : (
                    <button
                      onClick={() => handleDownloadModel(model.name)}
                      disabled={downloadingModel !== null}
                      className="text-xs btn-primary py-1 px-2"
                    >
                      {downloadingModel === model.name ? 'Downloading...' : 'Download'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Recording Mode Section */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Recording Mode</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="recording_mode"
                  checked={settings.recording_mode === 'click_to_record'}
                  onChange={() => onSettingsChange({ ...settings, recording_mode: 'click_to_record' })}
                  className="w-4 h-4 text-primary-600"
                />
                <div>
                  <p className="font-medium text-gray-900">Click to Record</p>
                  <p className="text-xs text-gray-500">Click once to start, click again to stop</p>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="recording_mode"
                  checked={settings.recording_mode === 'push_to_talk'}
                  onChange={() => onSettingsChange({ ...settings, recording_mode: 'push_to_talk' })}
                  className="w-4 h-4 text-primary-600"
                />
                <div>
                  <p className="font-medium text-gray-900">Push to Talk</p>
                  <p className="text-xs text-gray-500">Hold button to record, release to stop</p>
                </div>
              </label>
            </div>
          </section>

          {/* Translation Toggle Section */}
          <section>
            <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Enable Translation</h3>
                <p className="text-xs text-gray-500">When disabled, shows transcription only</p>
              </div>
              <button
                onClick={() => onSettingsChange({ ...settings, translation_enabled: !settings.translation_enabled })}
                className={`
                  relative w-11 h-6 rounded-full transition-colors duration-200
                  ${settings.translation_enabled ? 'bg-primary-600' : 'bg-gray-300'}
                `}
              >
                <span
                  className={`
                    absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
                    ${settings.translation_enabled ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>
          </section>

          {/* Target Language Section - only show when translation enabled */}
          {settings.translation_enabled && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Target Language</h3>
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
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-primary w-full">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
