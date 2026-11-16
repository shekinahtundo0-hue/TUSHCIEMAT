import { TrendingUp, FileText, Megaphone, AlertCircle } from 'lucide-react';
import { formatDate } from '@/lib/api';

interface Activity {
  id: string;
  type: 'results' | 'announcement' | 'overdue' | 'submission';
  title: string;
  description: string;
  timestamp: Date;
}

interface ActivityFeedProps {
  activities: Activity[];
}

const getActivityIcon = (type: string) => {
  switch (type) {
    case 'results':
      return <TrendingUp size={20} className="text-green-600" />;
    case 'announcement':
      return <Megaphone size={20} className="text-blue-600" />;
    case 'overdue':
      return <AlertCircle size={20} className="text-red-600" />;
    case 'submission':
      return <FileText size={20} className="text-purple-600" />;
    default:
      return <FileText size={20} className="text-gray-600" />;
  }
};

const getActivityColor = (type: string) => {
  switch (type) {
    case 'results':
      return 'bg-green-100 text-green-900';
    case 'announcement':
      return 'bg-blue-100 text-blue-900';
    case 'overdue':
      return 'bg-red-100 text-red-900';
    case 'submission':
      return 'bg-purple-100 text-purple-900';
    default:
      return 'bg-gray-100 text-gray-900';
  }
};

export function ActivityFeed({ activities }: ActivityFeedProps) {
  if (!activities || activities.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activities.map((activity, idx) => (
        <div key={activity.id} className="flex gap-4">
          {/* Timeline line */}
          {idx !== activities.length - 1 && (
            <div className="w-1 bg-gray-200 transform translate-x-2.5"></div>
          )}

          {/* Activity node */}
          <div className="flex-1 relative">
            <div className="absolute w-6 h-6 bg-white border-2 border-gray-300 rounded-full top-1 transform -translate-x-2.5"></div>

            <div className="ml-4">
              <div className={`p-3 rounded-lg ${getActivityColor(activity.type)}`}>
                <div className="flex items-start gap-2">
                  {getActivityIcon(activity.type)}
                  <div className="flex-1">
                    <p className="font-semibold">{activity.title}</p>
                    <p className="text-sm opacity-75">{activity.description}</p>
                    <p className="text-xs opacity-60 mt-2">
                      {formatDate(activity.timestamp, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
