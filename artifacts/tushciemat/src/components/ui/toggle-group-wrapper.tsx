import { ReactNode } from 'react';

interface ToggleGroupProps {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}

export function ToggleGroup({ value, onChange, children }: ToggleGroupProps) {
  return (
    <div className="flex gap-2">
      {children}
    </div>
  );
}

interface ToggleOptionProps {
  value: string;
  children: ReactNode;
  onClick?: () => void;
}

export function ToggleOption({ value, children }: ToggleOptionProps) {
  // This component is designed to be used within ToggleGroup
  // The parent will handle the logic
  return (
    <div data-value={value} className="flex-1">
      {children}
    </div>
  );
}

// Alternative standalone version
interface SimpleToggleGroupProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}

export function SimpleToggleGroup({ value, onChange, options }: SimpleToggleGroupProps) {
  return (
    <div className="flex gap-2 rounded-lg bg-gray-100 p-1 inline-flex">
      {options.map(option => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            value === option.value
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-700 hover:text-gray-900'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
