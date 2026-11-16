import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface CardWrapperProps {
  title?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function Card({ title, icon: Icon, children, className = '', action }: CardWrapperProps) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
            {Icon && <Icon size={24} className="text-gray-700" />}
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="px-6 py-4">
        {children}
      </div>
    </div>
  );
}
