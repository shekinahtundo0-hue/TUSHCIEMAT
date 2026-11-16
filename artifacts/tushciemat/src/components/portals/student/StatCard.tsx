import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
  onClick?: () => void;
}

const colorClasses = {
  blue: 'bg-blue-50 border-blue-200 text-blue-900',
  green: 'bg-green-50 border-green-200 text-green-900',
  yellow: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  red: 'bg-red-50 border-red-200 text-red-900',
  purple: 'bg-purple-50 border-purple-200 text-purple-900',
};

const iconColorClasses = {
  blue: 'text-blue-600',
  green: 'text-green-600',
  yellow: 'text-yellow-600',
  red: 'text-red-600',
  purple: 'text-purple-600',
};

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  trendValue,
  color = 'blue',
  onClick,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-lg p-4 border transition-all ${colorClasses[color]} ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase opacity-75">{label}</p>
          <p className="text-2xl font-bold mt-2">{value}</p>
          {trendValue && (
            <p className={`text-xs font-medium mt-2 ${
              trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-600'
            }`}>
              {trendValue}
            </p>
          )}
        </div>
        {Icon && (
          <Icon size={32} className={`opacity-50 ${iconColorClasses[color]}`} />
        )}
      </div>
    </div>
  );
}
