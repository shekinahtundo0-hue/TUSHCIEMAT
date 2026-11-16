import { ChangeEvent } from 'react';

interface SelectProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  options: string[] | Array<{ value: string; label: string }>;
  disabled?: boolean;
  className?: string;
}

export function Select({ value, onChange, options, disabled, className = '' }: SelectProps) {
  const isStringArray = Array.isArray(options) && typeof options[0] === 'string';

  return (
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={`w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
    >
      {isStringArray
        ? (options as string[]).map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))
        : (options as Array<{ value: string; label: string }>).map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
    </select>
  );
}
