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
  recording_mode: 'push_to_talk' | 'click_to_record';
  whisper_model: 'small' | 'medium' | 'large';
  source_language: string;
  target_language: string;
  translation_provider: TranslationProvider;
  translation_model?: string;
  translation_enabled: boolean;
}

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
  anthropic: { name: 'Claude (Anthropic)', description: 'Best quality translations' },
  openai: { name: 'GPT-4o (OpenAI)', description: 'Great price/performance' },
  google: { name: 'Gemini (Google)', description: 'Fast and affordable' },
  ollama: { name: 'Ollama (Local)', description: 'Free, runs locally' },
};

// Provider pricing information (per million tokens)
export interface ProviderPricing {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
}

export const PROVIDER_PRICING: Record<TranslationProvider, ProviderPricing> = {
  openai: { model: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.60 },
  anthropic: { model: 'claude-3-5-haiku', inputPerMillion: 0.80, outputPerMillion: 4.00 },
  google: { model: 'gemini-1.5-flash', inputPerMillion: 0.075, outputPerMillion: 0.30 },
  ollama: { model: 'llama3.2', inputPerMillion: 0, outputPerMillion: 0 },
};

// Estimation: ~150 words per minute * 1.3 tokens per word = ~195 tokens/minute
// We estimate similar output tokens for translation
export const TOKENS_PER_MINUTE = 195;

export function estimateCostPerMinute(provider: TranslationProvider): number {
  const pricing = PROVIDER_PRICING[provider];
  const inputCost = (TOKENS_PER_MINUTE / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (TOKENS_PER_MINUTE / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}
