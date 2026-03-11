import { useState } from 'react';
import type { TranscriptionResult, TranslationResult } from '../types';

interface TranscriptionViewProps {
  transcription: TranscriptionResult | null;
  translation: TranslationResult | null;
  isProcessing: boolean;
}

const languageNames: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  nl: 'Dutch', pl: 'Polish', tr: 'Turkish', vi: 'Vietnamese',
  th: 'Thai', id: 'Indonesian', uk: 'Ukrainian',
};

export function TranscriptionView({
  transcription,
  translation,
  isProcessing,
}: TranscriptionViewProps) {
  const [showOriginal, setShowOriginal] = useState(true);
  const [copiedTranslation, setCopiedTranslation] = useState(false);
  const [copiedOriginal, setCopiedOriginal] = useState(false);

  const handleCopy = async (text: string, setCopied: (v: boolean) => void) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isProcessing) {
    return (
      <div className="card p-8 flex flex-col items-center justify-center">
        <div className="spinner w-5 h-5 mb-4" style={{ borderWidth: '2px' }} />
        <p className="text-[13px] text-text-secondary">
          {transcription ? 'Translating...' : 'Transcribing...'}
        </p>
      </div>
    );
  }

  if (!transcription && !translation) return null;

  return (
    <div className="space-y-3">
      {/* Translation result */}
      {translation && translation.translated_text && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
              <span>{languageNames[translation.source_language] || translation.source_language}</span>
              <svg className="w-3 h-3 text-text-ghost" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-text-primary">{languageNames[translation.target_language] || translation.target_language}</span>
            </div>
            <button
              onClick={() => handleCopy(translation.translated_text, setCopiedTranslation)}
              className="icon-btn w-7 h-7"
              title="Copy translation"
            >
              {copiedTranslation ? (
                <svg className="w-3.5 h-3.5 text-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-[15px] text-text-primary leading-relaxed">
            {translation.translated_text}
          </p>
        </div>
      )}

      {/* Original transcription */}
      {transcription && (
        <div className="card overflow-hidden">
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className="flex items-center justify-between w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors"
          >
            <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
              Original · {languageNames[transcription.detected_language] || transcription.detected_language}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopy(transcription.text, setCopiedOriginal);
                }}
                className="icon-btn w-7 h-7"
                title="Copy original"
              >
                {copiedOriginal ? (
                  <svg className="w-3.5 h-3.5 text-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
              <svg
                className={`w-3.5 h-3.5 text-text-ghost transition-transform ${showOriginal ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
          <div
            className={`overflow-hidden transition-all duration-200 ${
              showOriginal ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <p className="px-4 pb-3 text-[13px] text-text-secondary leading-relaxed">
              {transcription.text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
