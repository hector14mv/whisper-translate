export interface TranslationEntry {
  id: string;
  original_text: string;
  translated_text: string;
  source_language: string;
  target_language: string;
  timestamp: string;
}

export type TranslationProvider = 'anthropic' | 'openai' | 'google' | 'ollama';

export interface AppSettings {
  recording_mode: 'push_to_talk' | 'click_to_record' | 'double_tap';
  whisper_model: 'large-v3-turbo' | 'large-v3';
  source_language: string;
  target_language: string;
  translation_provider: TranslationProvider;
  translation_model?: string;
  translation_enabled: boolean;
  remove_filler_words: boolean;
  global_hotkey_enabled: boolean;
  global_hotkey: string;
  double_tap_interval: number;
}

export type OverlayState = 'recording' | 'processing' | 'hidden';

// Available global hotkey options
export const GLOBAL_HOTKEY_OPTIONS = [
  { id: 'CommandOrControl+Shift+Space', label: '⌘ + Shift + Space', description: 'Default' },
  { id: 'CommandOrControl+Shift+R', label: '⌘ + Shift + R', description: 'Record shortcut' },
  { id: 'Alt+Space', label: '⌥ + Space', description: 'Like Wispr Flow' },
] as const;

export interface AudioDeviceInfo {
  name: string;
  is_default: boolean;
}

export interface WhisperModelInfo {
  name: string;
  size_mb: number;
  downloaded: boolean;
  path: string | null;
}

export interface TranscriptionResult {
  text: string;
  detected_language: string;
}

export interface TranslationResult {
  translated_text: string;
  source_language: string;
  target_language: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
}

export interface ProviderInfo {
  api_key_url: string;
  requires_api_key: boolean;
  default_model: string;
}

export interface OllamaStatus {
  is_running: boolean;
  models: string[];
  error?: string;
}

export type RecordingState = 'idle' | 'recording' | 'processing' | 'translating';

// Provider display information
export const PROVIDER_DISPLAY_INFO: Record<TranslationProvider, { name: string; description: string }> = {
  ollama: { name: 'Ollama (Local)', description: 'Free forever, runs on your Mac' },
  openai: { name: 'GPT-4o (OpenAI)', description: 'Great price/performance' },
  anthropic: { name: 'Claude (Anthropic)', description: 'Best quality translations' },
  google: { name: 'Gemini (Google)', description: 'Fast and affordable' },
};

// Provider pricing information (per million tokens)
export interface ProviderPricing {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  // Cached input pricing (for providers that support it)
  cachedInputPerMillion?: number;
}

export const PROVIDER_PRICING: Record<TranslationProvider, ProviderPricing> = {
  ollama: { model: 'qwen2.5', inputPerMillion: 0, outputPerMillion: 0 },
  openai: { model: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.60 },
  anthropic: {
    model: 'claude-3-5-haiku',
    inputPerMillion: 0.80,
    outputPerMillion: 4.00,
    cachedInputPerMillion: 0.08, // 90% cheaper for cached prompts
  },
  google: { model: 'gemini-1.5-flash', inputPerMillion: 0.075, outputPerMillion: 0.30 },
};

// Cost estimation constants
export const COST_ESTIMATION = {
  // Average speaking rate for humans
  wordsPerMinute: 150,
  // Average tokens per word (English). Other languages may vary (2-4x for CJK)
  tokensPerWord: 1.3,
  // System prompt overhead (~50 words of instructions)
  promptOverheadTokens: 65,
  // Calculated: speech tokens per minute
  get speechTokensPerMinute() {
    return Math.round(this.wordsPerMinute * this.tokensPerWord);
  },
  // Total input tokens (prompt + speech)
  get totalInputTokensPerMinute() {
    return this.promptOverheadTokens + this.speechTokensPerMinute;
  },
};

// For backwards compatibility
export const TOKENS_PER_MINUTE = COST_ESTIMATION.speechTokensPerMinute;

export function estimateCostPerMinute(provider: TranslationProvider, useCaching = false): number {
  const pricing = PROVIDER_PRICING[provider];

  // Input: prompt overhead + speech tokens
  const inputTokens = COST_ESTIMATION.totalInputTokensPerMinute;
  // Output: roughly same as speech (translation length ≈ original)
  const outputTokens = COST_ESTIMATION.speechTokensPerMinute;

  // Use cached pricing if available and caching is enabled
  const inputPrice = useCaching && pricing.cachedInputPerMillion
    ? pricing.cachedInputPerMillion
    : pricing.inputPerMillion;

  const inputCost = (inputTokens / 1_000_000) * inputPrice;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return inputCost + outputCost;
}

export function getCostBreakdown(provider: TranslationProvider) {
  const pricing = PROVIDER_PRICING[provider];
  const inputTokens = COST_ESTIMATION.totalInputTokensPerMinute;
  const outputTokens = COST_ESTIMATION.speechTokensPerMinute;

  return {
    wordsPerMinute: COST_ESTIMATION.wordsPerMinute,
    tokensPerWord: COST_ESTIMATION.tokensPerWord,
    promptOverheadTokens: COST_ESTIMATION.promptOverheadTokens,
    speechTokensPerMinute: COST_ESTIMATION.speechTokensPerMinute,
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    inputPricePerMillion: pricing.inputPerMillion,
    outputPricePerMillion: pricing.outputPerMillion,
    inputCost: (inputTokens / 1_000_000) * pricing.inputPerMillion,
    outputCost: (outputTokens / 1_000_000) * pricing.outputPerMillion,
    totalCost: estimateCostPerMinute(provider),
    hasCaching: !!pricing.cachedInputPerMillion,
    cachedCost: pricing.cachedInputPerMillion
      ? estimateCostPerMinute(provider, true)
      : undefined,
  };
}
