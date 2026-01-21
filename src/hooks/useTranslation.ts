import { useState, useCallback } from 'react';
import { transcribeAudio, translateText, getApiKey, getApiKeyTypeForProvider } from '../lib/tauri';
import type { TranscriptionResult, TranslationResult, TranslationEntry, TranslationProvider } from '../types';

interface UseTranslationReturn {
  transcription: TranscriptionResult | null;
  translation: TranslationResult | null;
  isProcessing: boolean;
  error: string | null;
  processAudio: (
    audioPath: string,
    whisperModel: string,
    targetLanguage: string,
    provider: TranslationProvider,
    model?: string,
    translationEnabled?: boolean
  ) => Promise<TranslationEntry | null>;
  clearResults: () => void;
}

export function useTranslation(): UseTranslationReturn {
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processAudio = useCallback(async (
    audioPath: string,
    whisperModel: string,
    targetLanguage: string,
    provider: TranslationProvider,
    model?: string,
    translationEnabled: boolean = true
  ): Promise<TranslationEntry | null> => {
    setIsProcessing(true);
    setError(null);
    setTranslation(null); // Clear previous translation

    try {
      // Step 1: Transcribe the audio
      const transcriptionResult = await transcribeAudio(audioPath, whisperModel);
      setTranscription(transcriptionResult);

      if (!transcriptionResult.text.trim()) {
        setError('No speech detected in the recording');
        setIsProcessing(false);
        return null;
      }

      // If translation is disabled, return transcription-only entry
      if (!translationEnabled) {
        const entry: TranslationEntry = {
          id: crypto.randomUUID(),
          original_text: transcriptionResult.text,
          translated_text: '', // No translation
          source_language: transcriptionResult.detected_language,
          target_language: targetLanguage,
          timestamp: new Date().toISOString(),
        };
        setIsProcessing(false);
        return entry;
      }

      // Step 2: Get the API key (if needed for this provider)
      let apiKey: string | undefined;
      const apiKeyType = getApiKeyTypeForProvider(provider);

      if (apiKeyType) {
        const key = await getApiKey(apiKeyType);
        if (!key) {
          const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
          setError(`${providerName} API key not configured. Please add it in Settings.`);
          setIsProcessing(false);
          return null;
        }
        apiKey = key;
      }

      // Step 3: Translate the text
      const translationResult = await translateText(
        transcriptionResult.text,
        transcriptionResult.detected_language,
        targetLanguage,
        provider,
        model,
        apiKey
      );
      setTranslation(translationResult);

      // Create a history entry
      const entry: TranslationEntry = {
        id: crypto.randomUUID(),
        original_text: transcriptionResult.text,
        translated_text: translationResult.translated_text,
        source_language: transcriptionResult.detected_language,
        target_language: targetLanguage,
        timestamp: new Date().toISOString(),
      };

      setIsProcessing(false);
      return entry;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsProcessing(false);
      return null;
    }
  }, []);

  const clearResults = useCallback(() => {
    setTranscription(null);
    setTranslation(null);
    setError(null);
  }, []);

  return {
    transcription,
    translation,
    isProcessing,
    error,
    processAudio,
    clearResults,
  };
}
