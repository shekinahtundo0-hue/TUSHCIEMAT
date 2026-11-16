import { AlertCircle, AlertTriangle, Info, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AlertItemProps {
  type: 'overdue' | 'due-soon' | 'results' | 'announcement';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const severityStyles = {
  critical: 'bg-red-50 border-red-200 text-red-900',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  info: 'bg-blue-50 border-blue-200 text-blue-900',
};

const iconStyles = {
  critical: 'text-red-600',
  warning: 'text-yellow-600',
  info: 'text-blue-600',
};

const getIcon = (type: string, severity: string) => {
  if (severity === 'critical') return <AlertTriangle size={24} />;
  if (severity === 'warning') return <AlertCircle size={24} />;
  return <Info size={24} />;
};

export function AlertItem({ type, severity, message, action }: AlertItemProps) {
  const severityClass = severityStyles[severity];
  const iconClass = iconStyles[severity];

  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border ${severityClass}`}>
      <div className={`flex-shrink-0 mt-0.5 ${iconClass}`}>
        {getIcon(type, severity)}
      </div>
      <div className="flex-1">
        <p className="font-medium">{message}</p>
      </div>
      {action && (
        <div className="flex-shrink-0">
          <button
            onClick={action.onClick}
            className="text-sm font-medium underline hover:opacity-80 transition-opacity"
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}
