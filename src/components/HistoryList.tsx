import { useMemo } from 'react';
import type { TranslationEntry } from '../types';

interface HistoryListProps {
  entries: TranslationEntry[];
  onSelectEntry: (entry: TranslationEntry) => void;
  onClearHistory: () => void;
}

const langCodes: Record<string, string> = {
  en: 'EN', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT',
  zh: 'ZH', ja: 'JA', ko: 'KO', ru: 'RU', ar: 'AR', hi: 'HI',
  nl: 'NL', pl: 'PL', tr: 'TR', vi: 'VI', th: 'TH', id: 'ID', uk: 'UK',
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function HistoryList({
  entries,
  onSelectEntry,
}: HistoryListProps) {
  const displayEntries = useMemo(() => entries, [entries]);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-1">
      {displayEntries.map((entry) => (
        <button
          key={entry.id}
          onClick={() => onSelectEntry(entry)}
          className="history-item w-full text-left"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-text-ghost font-medium">
              {langCodes[entry.source_language] || entry.source_language}
              {entry.translated_text && (
                <>
                  {' \u2192 '}
                  {langCodes[entry.target_language] || entry.target_language}
                </>
              )}
            </span>
            <span className="text-[11px] text-text-ghost">
              {formatTime(entry.timestamp)}
            </span>
          </div>
          <p className="text-[13px] text-text-secondary line-clamp-2 leading-snug">
            {entry.translated_text || entry.original_text}
          </p>
          {entry.translated_text && (
            <p className="text-[12px] text-text-ghost line-clamp-1 mt-1">
              {entry.original_text}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}
