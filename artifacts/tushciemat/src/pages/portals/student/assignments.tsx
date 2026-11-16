import { useState, useMemo } from 'react';
import { Upload, Calendar, AlertCircle, CheckCircle, Clock, ChevronRight } from 'lucide-react';
import {
  useListAssignments,
  useSubmitAssignment,
  type LearnerSummary,
  type Assignment,
} from '@workspace/api-client-react';
import { Card, Select, Button, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, Textarea } from '@/components/ui';
import { formatDate } from '@/lib/api';
import { AssignmentCard } from '@/components/portals/student/AssignmentCard';

interface AssignmentsHubProps {
  studentData: LearnerSummary;
}

type AssignmentStatus = 'not-started' | 'in-progress' | 'submitted' | 'graded' | 'overdue';

const STATUS_COLORS: Record<AssignmentStatus, string> = {
  'not-started': 'bg-gray-100 text-gray-900',
  'in-progress': 'bg-blue-100 text-blue-900',
  'submitted': 'bg-yellow-100 text-yellow-900',
  'graded': 'bg-green-100 text-green-900',
  'overdue': 'bg-red-100 text-red-900',
};

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

export default function AssignmentsHub({ studentData }: AssignmentsHubProps) {
  const [statusFilter, setStatusFilter] = useState('All');
  const [subjectFilter, setSubjectFilter] = useState('All');
  const [dueFilter, setDueFilter] = useState('All');
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: assignments, isLoading, isError, refetch } = useListAssignments();
  const submitAssignment = useSubmitAssignment();

  // Get unique subjects
  const subjects = useMemo(() => {
    if (!assignments) return [];
    const uniqueSubjects = Array.from(new Set(assignments.map(a => a.subject)));
    return ['All', ...uniqueSubjects.sort()];
  }, [assignments]);

  // Calculate categories
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextWeek = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

  // Filter assignments
  const filteredAssignments = useMemo(() => {
    if (!assignments) return [];

    let result = assignments;

    // Status filter
    if (statusFilter !== 'All') {
      result = result.filter(a => {
        const deadline = new Date(a.deadlineDate);
        if (statusFilter === 'Not Started' && !a.submission?.submissionText && !a.submission?.submissionFiles?.length) return true;
        if (statusFilter === 'In Progress' && (a.submission?.submissionText || a.submission?.submissionFiles?.length) && !a.submission?.submitted) return true;
        if (statusFilter === 'Submitted' && a.submission?.submitted && a.submission?.status !== 'graded') return true;
        if (statusFilter === 'Graded' && a.submission?.status === 'graded') return true;
        if (statusFilter === 'Overdue' && now > deadline && !a.submission?.submitted) return true;
        return false;
      });
    }

    // Subject filter
    if (subjectFilter !== 'All') {
      result = result.filter(a => a.subject === subjectFilter);
    }

    // Due filter
    if (dueFilter !== 'All') {
      result = result.filter(a => {
        const deadline = new Date(a.deadlineDate);
        const deadlineDate = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
        
        if (dueFilter === 'This Week' && deadlineDate <= weekFromNow && deadlineDate >= today) return true;
        if (dueFilter === 'Next Week' && deadlineDate > weekFromNow && deadlineDate <= nextWeek) return true;
        if (dueFilter === 'Overdue' && deadline < now && !a.submission?.submitted) return true;
        return false;
      });
    }

    // Sort by due date
    return result.sort((a, b) =>
      new Date(a.deadlineDate).getTime() - new Date(b.deadlineDate).getTime()
    );
  }, [assignments, statusFilter, subjectFilter, dueFilter, now, today, weekFromNow, nextWeek]);

  // Count assignments by status for UI feedback
  const statusCounts = useMemo(() => {
    if (!assignments) return {};
    return {
      notStarted: assignments.filter(a => !a.submission?.submissionText && !a.submission?.submissionFiles?.length).length,
      inProgress: assignments.filter(a => (a.submission?.submissionText || a.submission?.submissionFiles?.length) && !a.submission?.submitted).length,
      submitted: assignments.filter(a => a.submission?.submitted && a.submission?.status !== 'graded').length,
      graded: assignments.filter(a => a.submission?.status === 'graded').length,
      overdue: assignments.filter(a => new Date(a.deadlineDate) < now && !a.submission?.submitted).length,
    };
  }, [assignments, now]);

  const handleSubmit = async () => {
    if (!selectedAssignment || (!submissionText && !selectedAssignment.submission?.submissionFiles?.length)) {
      alert('Please enter a submission or upload a file.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitAssignment.mutateAsync({
        assignmentId: selectedAssignment.id,
        submissionText: submissionText || undefined,
      });
      
      setSelectedAssignment(null);
      setSubmissionText('');
      refetch();
    } catch (error) {
      alert('Failed to submit assignment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="assignments-hub space-y-6">
      {/* Header */}
      <div className="hub-header">
        <h2 className="text-2xl font-bold text-gray-900">Assignments</h2>
        <p className="text-gray-600 mt-1">Track and submit your class assignments</p>
      </div>

      {/* Filter Controls */}
      <Card title="Filter" className="filter-card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                'All',
                'Not Started',
                'In Progress',
                'Submitted',
                'Graded',
                'Overdue'
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
            <Select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              options={subjects}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Due</label>
            <Select
              value={dueFilter}
              onChange={(e) => setDueFilter(e.target.value)}
              options={['All', 'This Week', 'Next Week', 'Overdue']}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => {
                setStatusFilter('All');
                setSubjectFilter('All');
                setDueFilter('All');
              }}
              className="w-full"
            >
              Reset
            </Button>
          </div>
        </div>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
          <div className="text-2xl font-bold text-blue-900">{statusCounts.notStarted}</div>
          <div className="text-sm text-blue-700">Not Started</div>
        </div>
        <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
          <div className="text-2xl font-bold text-yellow-900">{statusCounts.inProgress}</div>
          <div className="text-sm text-yellow-700">In Progress</div>
        </div>
        <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
          <div className="text-2xl font-bold text-purple-900">{statusCounts.submitted}</div>
          <div className="text-sm text-purple-700">Submitted</div>
        </div>
        <div className="bg-green-50 rounded-lg p-4 border border-green-200">
          <div className="text-2xl font-bold text-green-900">{statusCounts.graded}</div>
          <div className="text-sm text-green-700">Graded</div>
        </div>
        <div className="bg-red-50 rounded-lg p-4 border border-red-200">
          <div className="text-2xl font-bold text-red-900">{statusCounts.overdue}</div>
          <div className="text-sm text-red-700">Overdue</div>
        </div>
      </div>

      {/* Assignments List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-gray-500 text-center">
            <div className="animate-spin">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <p className="mt-3">Loading assignments...</p>
          </div>
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-800">
          <p className="font-semibold">Could not load assignments</p>
          <p className="text-sm mt-1">There was an error loading your assignments.</p>
          <Button onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </div>
      ) : filteredAssignments.length === 0 ? (
        <div className="bg-gray-50 rounded-lg p-12 text-center">
          <CheckCircle size={48} className="mx-auto text-gray-400 mb-3" />
          <p className="text-gray-900 font-semibold">No assignments found</p>
          <p className="text-gray-600 text-sm mt-1">
            {statusFilter !== 'All' || subjectFilter !== 'All' || dueFilter !== 'All'
              ? 'Try adjusting your filters.'
              : 'Check back soon for assignments.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAssignments.map((assignment) => (
            <AssignmentCard
              key={assignment.id}
              assignment={assignment}
              onView={() => setSelectedAssignment(assignment)}
            />
          ))}
        </div>
      )}

      {/* Assignment Detail Modal */}
      {selectedAssignment && (
        <Dialog open={!!selectedAssignment} onOpenChange={() => setSelectedAssignment(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedAssignment.title}</DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {/* Meta Information */}
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-blue-600 uppercase font-semibold">Subject</p>
                    <p className="text-gray-900 font-medium mt-1">{selectedAssignment.subject}</p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 uppercase font-semibold">Marks</p>
                    <p className="text-gray-900 font-medium mt-1">{selectedAssignment.marksAllocated}</p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 uppercase font-semibold">Deadline</p>
                    <p className="text-gray-900 font-medium mt-1">
                      {formatDate(new Date(selectedAssignment.deadlineDate))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 uppercase font-semibold">Status</p>
                    <p className="text-gray-900 font-medium mt-1">
                      <Badge className={STATUS_COLORS[calculateStatus(selectedAssignment, selectedAssignment.submission)]}>
                        {calculateStatus(selectedAssignment, selectedAssignment.submission).toUpperCase()}
                      </Badge>
                    </p>
                  </div>
                </div>
              </div>

              {/* Instructions */}
              {selectedAssignment.instructions && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Instructions</h3>
                  <div className="bg-gray-50 rounded-lg p-4 text-gray-700 whitespace-pre-wrap">
                    {selectedAssignment.instructions}
                  </div>
                </div>
              )}

              {/* Attached Resources */}
              {selectedAssignment.attachedResourceIds && selectedAssignment.attachedResourceIds.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Attached Resources</h3>
                  <div className="space-y-2">
                    {selectedAssignment.attachedResourceIds.map((resourceId, idx) => (
                      <a
                        key={idx}
                        href={`#resource-${resourceId}`}
                        className="flex items-center gap-2 text-blue-600 hover:text-blue-900 transition-colors"
                      >
                        <ChevronRight size={16} />
                        Resource {idx + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Submission Section */}
              <div className="border-t pt-6">
                {selectedAssignment.submission?.status === 'graded' ? (
                  <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                    <h3 className="font-semibold text-green-900 mb-3">Your Submission - Graded</h3>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-green-700">Grade</p>
                        <p className="text-lg font-semibold text-green-900">
                          {selectedAssignment.submission.marksObtained}/{selectedAssignment.marksAllocated}
                        </p>
                      </div>
                      {selectedAssignment.submission.feedback && (
                        <div>
                          <p className="text-sm text-green-700">Feedback</p>
                          <p className="text-gray-900 mt-1">
                            {selectedAssignment.submission.feedback}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : new Date() > new Date(selectedAssignment.deadlineDate) && !selectedAssignment.submission?.submitted ? (
                  <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                    <p className="text-red-800 font-semibold">Deadline has passed</p>
                    <p className="text-red-700 text-sm mt-1">No further submissions are allowed.</p>
                  </div>
                ) : (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-3">Your Submission</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Your Response
                        </label>
                        <Textarea
                          value={submissionText}
                          onChange={(e) => setSubmissionText(e.target.value)}
                          placeholder="Enter your response..."
                          rows={6}
                          className="w-full"
                        />
                      </div>

                      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <p className="text-sm text-gray-600 mb-3">
                          <Upload size={16} className="inline mr-2" />
                          File upload coming soon
                        </p>
                      </div>

                      <div className="flex gap-3">
                        <Button
                          onClick={handleSubmit}
                          disabled={isSubmitting || (!submissionText && !selectedAssignment.submission?.submissionFiles?.length)}
                          className="flex-1"
                        >
                          {isSubmitting ? 'Submitting...' : 'Submit for Grading'}
                        </Button>
                        <Button
                          onClick={() => setSelectedAssignment(null)}
                          className="flex-1"
                        >
                          Close
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
