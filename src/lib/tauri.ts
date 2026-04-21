import { invoke } from '@tauri-apps/api/core';
import type {
  WhisperModelInfo,
  TranscriptionResult,
  TranslationResult,
  AppSettings,
  TranslationProvider,
  ProviderInfo,
  OllamaStatus,
} from '../types';

// Audio commands
export async function startRecording(): Promise<string> {
  return invoke<string>('start_recording');
}

export async function stopRecording(): Promise<string> {
  return invoke<string>('stop_recording');
}

// Keychain commands
export type ApiKeyType = 'anthropic' | 'openai' | 'google';

export async function saveApiKey(keyType: ApiKeyType, apiKey: string): Promise<void> {
  return invoke('save_api_key', { keyType, apiKey });
}

export async function getApiKey(keyType: ApiKeyType): Promise<string | null> {
  return invoke<string | null>('get_api_key', { keyType });
}

export async function deleteApiKey(keyType: ApiKeyType): Promise<void> {
  return invoke('delete_api_key', { keyType });
}

export async function validateApiKey(keyType: ApiKeyType, apiKey: string): Promise<boolean> {
  return invoke<boolean>('validate_api_key', { keyType, apiKey });
}

// Whisper commands
export async function transcribeAudio(
  audioPath: string,
  modelName: string,
  removeFillerWords?: boolean
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>('transcribe_audio', { audioPath, modelName, removeFillerWords });
}

export async function downloadWhisperModel(modelName: string): Promise<string> {
  return invoke<string>('download_whisper_model', { modelName });
}

export async function getWhisperModelStatus(): Promise<WhisperModelInfo[]> {
  return invoke<WhisperModelInfo[]>('get_whisper_model_status');
}

// Translation commands
export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  provider: TranslationProvider,
  model?: string,
  apiKey?: string,
): Promise<TranslationResult> {
  return invoke<TranslationResult>('translate_text', {
    text,
    sourceLanguage,
    targetLanguage,
    provider,
    model,
    apiKey,
  });
}

export async function getProviderInfo(provider: TranslationProvider): Promise<ProviderInfo> {
  return invoke<ProviderInfo>('get_provider_info', { provider });
}

export async function checkOllamaStatus(): Promise<OllamaStatus> {
  return invoke<OllamaStatus>('check_ollama_status');
}

// Settings commands
export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_settings');
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke('save_settings', { settings });
}

// Utility: Get the API key type for a provider
export function getApiKeyTypeForProvider(provider: TranslationProvider): ApiKeyType | null {
  switch (provider) {
    case 'anthropic':
      return 'anthropic';
    case 'openai':
      return 'openai';
    case 'google':
      return 'google';
    case 'ollama':
      return null; // Ollama doesn't need an API key
  }
}

// Clipboard commands
export async function copyAndPaste(text: string): Promise<void> {
  return invoke('copy_and_paste', { text });
}

// Focus management
export async function saveFrontmostApp(): Promise<void> {
  return invoke('save_frontmost_app');
}

// Overlay commands
export async function showOverlay(): Promise<void> {
  return invoke('show_overlay');
}

export async function hideOverlay(): Promise<void> {
  return invoke('hide_overlay');
}

// Tray sync commands
export async function updateTrayHotkey(hotkey: string | null): Promise<void> {
  return invoke('update_tray_hotkey', { hotkey });
}

export async function updateTrayAutoPaste(enabled: boolean): Promise<void> {
  return invoke('update_tray_auto_paste', { enabled });
}

export async function updateTrayTranslation(enabled: boolean): Promise<void> {
  return invoke('update_tray_translation', { enabled });
}

export async function updateTrayRecordLabel(isRecording: boolean): Promise<void> {
  return invoke('update_tray_record_label', { isRecording });
}
