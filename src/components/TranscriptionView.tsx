import { useState } from 'react';
import type { TranscriptionResult, TranslationResult } from '../types';

interface TranscriptionViewProps {
  transcription: TranscriptionResult | null;
  translation: TranslationResult | null;
  isProcessing: boolean;
}

const languageNames: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
};

export function TranscriptionView({
  transcription,
  translation,
  isProcessing,
}: TranscriptionViewProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (translation?.translated_text) {
      await navigator.clipboard.writeText(translation.translated_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isProcessing) {
    return (
      <div className="card flex flex-col items-center justify-center py-12">
        <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mb-4" />
        <p className="text-gray-600">Processing your speech...</p>
        {transcription && (
          <p className="text-sm text-gray-500 mt-2">Translating to English...</p>
        )}
      </div>
    );
  }

  if (!transcription && !translation) {
    return (
      <div className="card flex flex-col items-center justify-center py-12 text-center">
        <svg
          className="w-16 h-16 text-gray-300 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
          />
        </svg>
        <p className="text-gray-500">
          Press the record button and speak.
          <br />
          Your translation will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Translation result */}
      {translation && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-primary-600 uppercase tracking-wider">
              {languageNames[translation.target_language] || translation.target_language}
            </span>
            <button
              onClick={handleCopy}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1"
              title="Copy to clipboard"
            >
              {copied ? (
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              )}
            </button>
          </div>
          <p className="text-lg text-gray-900 leading-relaxed">
            {translation.translated_text}
          </p>
        </div>
      )}

      {/* Original transcription (collapsible) */}
      {transcription && (
        <div className="card">
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Original ({languageNames[transcription.detected_language] || transcription.detected_language})
            </span>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${showOriginal ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showOriginal && (
            <p className="mt-2 text-gray-600 text-sm leading-relaxed">
              {transcription.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
