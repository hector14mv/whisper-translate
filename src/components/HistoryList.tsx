import { useState, useMemo } from 'react';
import type { TranslationEntry } from '../types';

interface HistoryListProps {
  entries: TranslationEntry[];
  onSelectEntry: (entry: TranslationEntry) => void;
  onClearHistory: () => void;
}

const languageNames: Record<string, string> = {
  en: 'EN',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  it: 'IT',
  pt: 'PT',
  zh: 'ZH',
  ja: 'JA',
  ko: 'KO',
  ru: 'RU',
  ar: 'AR',
  hi: 'HI',
  nl: 'NL',
  pl: 'PL',
  tr: 'TR',
  vi: 'VI',
  th: 'TH',
  id: 'ID',
  uk: 'UK',
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

export function HistoryList({
  entries,
  onSelectEntry,
  onClearHistory,
}: HistoryListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const query = searchQuery.toLowerCase();
    return entries.filter(
      (entry) =>
        entry.original_text.toLowerCase().includes(query) ||
        entry.translated_text.toLowerCase().includes(query)
    );
  }, [entries, searchQuery]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-4 border-b border-glass-border">
          <h3 className="text-sm font-semibold text-cloud font-display">History</h3>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="relative mb-4">
            <div className="absolute inset-0 bg-gradient-to-br from-prism-violet/10 to-prism-blue/10 rounded-full blur-xl" />
            <svg
              className="relative w-14 h-14 text-smoke"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-sm text-mist">No history yet</p>
          <p className="text-xs text-smoke mt-1">Your translations will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-4 border-b border-glass-border">
        <h3 className="text-sm font-semibold text-cloud font-display">History</h3>
        <button
          onClick={onClearHistory}
          className="text-xs text-smoke hover:text-prism-red transition-colors"
        >
          Clear all
        </button>
      </div>

      {/* Search Input */}
      <div className="px-3 py-2 border-b border-glass-border">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-smoke"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search history..."
            className="w-full pl-8 pr-8 py-2 text-sm bg-obsidian/50 border border-glass-border rounded-lg text-cloud placeholder-smoke focus:outline-none focus:border-prism-violet/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-smoke hover:text-mist transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <svg
              className="w-10 h-10 text-smoke mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm text-smoke">No results found</p>
            <p className="text-xs text-smoke/70 mt-1">Try a different search term</p>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onSelectEntry(entry)}
              className="history-item w-full text-left mb-1"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="lang-badge text-[10px] py-1 px-2">
                  <span>{languageNames[entry.source_language] || entry.source_language}</span>
                  <span className="arrow">→</span>
                  <span>{languageNames[entry.target_language] || entry.target_language}</span>
                </span>
                <span className="text-[10px] text-smoke">
                  {formatTime(entry.timestamp)}
                </span>
              </div>
              <p className="text-sm text-cloud line-clamp-2 leading-relaxed">
                {entry.translated_text || entry.original_text}
              </p>
              {entry.translated_text && (
                <p className="text-xs text-smoke line-clamp-1 mt-2">
                  {entry.original_text}
                </p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
