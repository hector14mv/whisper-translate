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
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <svg
          className="w-12 h-12 mx-auto mb-3 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-sm">No history yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-600">History</h3>
        <button
          onClick={onClearHistory}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Clear all
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.map((entry) => (
          <button
            key={entry.id}
            onClick={() => onSelectEntry(entry)}
            className="w-full text-left p-3 border-b border-gray-50 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">
                {languageNames[entry.source_language] || entry.source_language} →{' '}
                {languageNames[entry.target_language] || entry.target_language}
              </span>
              <span className="text-xs text-gray-400">
                {formatTime(entry.timestamp)}
              </span>
            </div>
            <p className="text-sm text-gray-900 line-clamp-2">
              {entry.translated_text}
            </p>
            <p className="text-xs text-gray-500 line-clamp-1 mt-1">
              {entry.original_text}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
