import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  current: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ current, total, onChange }: PaginationProps) {
  const pages = Array.from({ length: total }, (_, i) => i + 1);
  const maxVisible = 5;
  const startPage = Math.max(1, current - Math.floor(maxVisible / 2));
  const endPage = Math.min(total, startPage + maxVisible - 1);
  const visiblePages = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i
  );

  return (
    <div className="flex items-center justify-center gap-2 py-6">
      <button
        onClick={() => onChange(Math.max(1, current - 1))}
        disabled={current === 1}
        className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={20} className="text-gray-600" />
      </button>

      {startPage > 1 && (
        <>
          <button
            onClick={() => onChange(1)}
            className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors text-gray-900"
          >
            1
          </button>
          {startPage > 2 && (
            <span className="px-2 text-gray-600">...</span>
          )}
        </>
      )}

      {visiblePages.map(page => (
        <button
          key={page}
          onClick={() => onChange(page)}
          className={`px-3 py-2 rounded-lg transition-colors ${
            page === current
              ? 'bg-blue-600 text-white border border-blue-600'
              : 'border border-gray-300 text-gray-900 hover:bg-gray-100'
          }`}
        >
          {page}
        </button>
      ))}

      {endPage < total && (
        <>
          {endPage < total - 1 && (
            <span className="px-2 text-gray-600">...</span>
          )}
          <button
            onClick={() => onChange(total)}
            className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors text-gray-900"
          >
            {total}
          </button>
        </>
      )}

      <button
        onClick={() => onChange(Math.min(total, current + 1))}
        disabled={current === total}
        className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={20} className="text-gray-600" />
      </button>
    </div>
  );
}
