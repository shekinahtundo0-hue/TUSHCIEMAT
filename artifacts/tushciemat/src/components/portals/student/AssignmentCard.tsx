import { Calendar, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { formatDate } from '@/lib/api';

interface Assignment {
  id: string;
  title: string;
  subject: string;
  deadlineDate: string;
  deadlineTime?: string;
  marksAllocated: number;
  submission?: {
    status: string;
    submitted: boolean;
    marksObtained?: number;
    feedback?: string;
  };
}

interface AssignmentCardProps {
  assignment: Assignment;
  onView: () => void;
}

type AssignmentStatus = 'not-started' | 'in-progress' | 'submitted' | 'graded' | 'overdue';

const calculateStatus = (assignment: Assignment, submission: any): AssignmentStatus => {
  const deadline = new Date(assignment.deadlineDate);
  const now = new Date();

  if (now > deadline && !submission?.submitted) {
    return 'overdue';
  }
  if (submission?.status === 'graded') {
    return 'graded';
  }
  if (submission?.submitted) {
    return 'submitted';
  }
  if (submission?.submissionText || submission?.submissionFiles?.length) {
    return 'in-progress';
  }
  return 'not-started';
};

const statusColors: Record<AssignmentStatus, string> = {
  'not-started': 'bg-gray-100 text-gray-900',
  'in-progress': 'bg-blue-100 text-blue-900',
  'submitted': 'bg-yellow-100 text-yellow-900',
  'graded': 'bg-green-100 text-green-900',
  'overdue': 'bg-red-100 text-red-900',
};

const statusIcons: Record<AssignmentStatus, React.ReactNode> = {
  'not-started': <Clock size={16} />,
  'in-progress': <Clock size={16} />,
  'submitted': <CheckCircle size={16} />,
  'graded': <CheckCircle size={16} />,
  'overdue': <AlertCircle size={16} />,
};

export function AssignmentCard({ assignment, onView }: AssignmentCardProps) {
  const submission = assignment.submission;
  const status = calculateStatus(assignment, submission);
  const deadline = new Date(assignment.deadlineDate);
  const now = new Date();
  const daysUntilDue = Math.ceil(
    (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  const getProgressText = () => {
    if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)} days overdue`;
    if (daysUntilDue === 0) return 'Due today';
    if (daysUntilDue === 1) return 'Due tomorrow';
    return `${daysUntilDue} days to go`;
  };

  return (
    <div className={`assignment-card p-5 rounded-lg border transition-all hover:shadow-md ${
      status === 'overdue'
        ? 'bg-red-50 border-red-200'
        : status === 'graded'
          ? 'bg-green-50 border-green-200'
          : status === 'submitted'
            ? 'bg-yellow-50 border-yellow-200'
            : status === 'in-progress'
              ? 'bg-blue-50 border-blue-200'
              : 'bg-gray-50 border-gray-200'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Badge className={`${statusColors[status]} flex items-center gap-1`}>
              {statusIcons[status]}
              <span className="capitalize">{status.replace('-', ' ')}</span>
            </Badge>
            <span className="text-sm font-medium text-gray-600">{assignment.subject}</span>
          </div>
          <h3 className="text-lg font-semibold text-gray-900">{assignment.title}</h3>
        </div>
      </div>

      {/* Meta Information */}
      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
        <div>
          <p className="text-gray-600 font-medium">Marks</p>
          <p className="text-gray-900 font-semibold">{assignment.marksAllocated}</p>
        </div>
        <div>
          <p className="text-gray-600 font-medium">Deadline</p>
          <p className="text-gray-900 font-semibold">{formatDate(deadline.toISOString())}</p>
        </div>
        <div>
          <p className="text-gray-600 font-medium">Time Left</p>
          <p className={`font-semibold ${
            status === 'overdue' ? 'text-red-900' :
            daysUntilDue <= 2 ? 'text-orange-900' :
            'text-gray-900'
          }`}>
            {getProgressText()}
          </p>
        </div>
      </div>

      {/* Grade Display (if graded) */}
      {status === 'graded' && submission?.marksObtained !== undefined && (
        <div className="bg-white rounded-lg p-3 mb-4 border border-green-200">
          <p className="text-sm text-green-700 font-medium">Your Grade</p>
          <p className="text-xl font-bold text-green-900">
            {submission.marksObtained}/{assignment.marksAllocated}
            <span className="text-sm text-green-700 ml-2">
              ({Math.round((submission.marksObtained / assignment.marksAllocated) * 100)}%)
            </span>
          </p>
          {submission.feedback && (
            <p className="text-sm text-green-800 mt-2">
              <span className="font-medium">Feedback:</span> {submission.feedback}
            </p>
          )}
        </div>
      )}

      {/* Action Button */}
      <Button
        onClick={onView}
        className="w-full flex items-center justify-center gap-2"
      >
        View Details
      </Button>
    </div>
  );
}
