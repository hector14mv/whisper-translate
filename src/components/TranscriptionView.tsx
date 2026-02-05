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
  ar: 'Arabic',
  hi: 'Hindi',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  uk: 'Ukrainian',
};

export function TranscriptionView({
  transcription,
  translation,
  isProcessing,
}: TranscriptionViewProps) {
  const [showOriginal, setShowOriginal] = useState(true);
  const [copiedTranslation, setCopiedTranslation] = useState(false);
  const [copiedOriginal, setCopiedOriginal] = useState(false);

  const handleCopyTranslation = async () => {
    if (translation?.translated_text) {
      await navigator.clipboard.writeText(translation.translated_text);
      setCopiedTranslation(true);
      setTimeout(() => setCopiedTranslation(false), 2000);
    }
  };

  const handleCopyOriginal = async () => {
    if (transcription?.text) {
      await navigator.clipboard.writeText(transcription.text);
      setCopiedOriginal(true);
      setTimeout(() => setCopiedOriginal(false), 2000);
    }
  };

  const handleExport = () => {
    if (!transcription && !translation) return;

    let content = '';
    const timestamp = new Date().toLocaleString();

    content += `Whisper Translate Export\n`;
    content += `Date: ${timestamp}\n`;
    content += `${'='.repeat(50)}\n\n`;

    if (transcription) {
      const sourceLang = languageNames[transcription.detected_language] || transcription.detected_language;
      content += `ORIGINAL (${sourceLang}):\n`;
      content += `${transcription.text}\n\n`;
    }

    if (translation?.translated_text) {
      const targetLang = languageNames[translation.target_language] || translation.target_language;
      content += `TRANSLATION (${targetLang}):\n`;
      content += `${translation.translated_text}\n`;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `translation-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isProcessing) {
    return (
      <div className="result-card p-8 flex flex-col items-center justify-center">
        <div className="relative w-16 h-16 mb-6">
          {/* Prismatic spinner */}
          <div className="absolute inset-0 rounded-full border-2 border-glass-border" />
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-prism-violet border-r-prism-blue animate-spin"
            style={{ animationDuration: '1s' }}
          />
          <div
            className="absolute inset-2 rounded-full border-2 border-transparent border-b-prism-cyan border-l-prism-pink animate-spin"
            style={{ animationDuration: '1.5s', animationDirection: 'reverse' }}
          />
        </div>
        <p className="text-cloud font-medium">Processing your speech</p>
        {transcription && (
          <p className="text-sm text-mist mt-2">Translating...</p>
        )}
      </div>
    );
  }

  if (!transcription && !translation) {
    return (
      <div className="result-card p-10 flex flex-col items-center justify-center text-center">
        {/* Elegant empty state */}
        <div className="relative mb-6">
          {/* Prismatic glow behind icon */}
          <div className="absolute inset-0 bg-gradient-to-br from-prism-violet/20 via-prism-blue/10 to-prism-cyan/20 rounded-full blur-xl" />
          <svg
            className="relative w-20 h-20 text-smoke"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
        </div>
        <p className="text-mist text-lg mb-2">Ready to translate</p>
        <p className="text-smoke text-sm">
          Tap the crystal to start recording
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Translation result */}
      {translation && translation.translated_text && (
        <div className="result-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="lang-badge">
              <span>{languageNames[translation.source_language] || translation.source_language}</span>
              <span className="arrow">→</span>
              <span className="text-snow">{languageNames[translation.target_language] || translation.target_language}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopyTranslation}
                className="icon-btn w-9 h-9"
                title="Copy translation"
              >
                {copiedTranslation ? (
                  <svg className="w-4 h-4 text-prism-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </button>
              <button
                onClick={handleExport}
                className="icon-btn w-9 h-9"
                title="Export to file"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </button>
            </div>
          </div>
          <p className="text-xl text-snow leading-relaxed font-display">
            {translation.translated_text}
          </p>
        </div>
      )}

      {/* Original transcription (collapsible) */}
      {transcription && (
        <div className="glass-panel-sm p-4">
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className="flex items-center justify-between w-full text-left group"
          >
            <span className="text-xs font-medium text-smoke uppercase tracking-wider group-hover:text-mist transition-colors">
              Original · {languageNames[transcription.detected_language] || transcription.detected_language}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyOriginal();
                }}
                className="p-1.5 rounded hover:bg-glass-border/50 transition-colors"
                title="Copy original"
              >
                {copiedOriginal ? (
                  <svg className="w-3.5 h-3.5 text-prism-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-smoke group-hover:text-mist" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </button>
              {!translation?.translated_text && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExport();
                  }}
                  className="p-1.5 rounded hover:bg-glass-border/50 transition-colors"
                  title="Export to file"
                >
                  <svg className="w-3.5 h-3.5 text-smoke group-hover:text-mist" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                </button>
              )}
              <svg
                className={`w-4 h-4 text-smoke group-hover:text-mist transition-all ${showOriginal ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
          <div
            className={`overflow-hidden transition-all duration-300 ${
              showOriginal ? 'max-h-96 opacity-100 mt-3' : 'max-h-0 opacity-0'
            }`}
          >
            <p className="text-mist text-sm leading-relaxed">
              {transcription.text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
