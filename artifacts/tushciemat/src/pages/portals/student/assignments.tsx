import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  downloadAssignmentFile,
  useCreateSubmissionUploadTargets,
  useListAssignments,
  useGetAssignmentDetail,
  useSubmitAssignment,
  getListAssignmentsQueryKey,
  getGetAssignmentDetailQueryKey,
  type AssignmentStatus,
  type AssignmentSubmission,
  type AssignmentSummary,
  type FileDeclaration,
  type StoredFileInput,
} from '@workspace/api-client-react';
import { FileDrop } from '@/components/portals/FileDrop';
import { FileLinks } from '@/components/portals/file-links';
import { apiMessage } from '@/lib/api';
import { formatBytes } from '@/lib/uploads';
import './assignments.css';

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  graded: 'Graded',
  overdue: 'Overdue',
};

const SubmittedFiles = ({ submission }: { submission: AssignmentSubmission }) => {
  if (submission.submittedFiles.length === 0) return null;
  return (
    <div className="description">
      <h4>Files you handed in</h4>
      <ul className="instruction-content">
        {submission.submittedFiles.map((file) => (
          <li key={file.id}>{file.name} — {formatBytes(file.size)}</li>
        ))}
      </ul>
      <p className="instruction-content">Ask your teacher for a copy — the portal keeps your upload for marking, but it is not downloadable from here.</p>
    </div>
  );
};

export const AssignmentsHub = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | 'all'>('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [dueFilter, setDueFilter] = useState('all');
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [files, setFiles] = useState<StoredFileInput[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const assignmentsQuery = useListAssignments(
    statusFilter !== 'all' ? { status: statusFilter } : undefined,
  );
  const assignments: AssignmentSummary[] = assignmentsQuery.data?.data ?? [];

  const detail = useGetAssignmentDetail(
    selectedAssignment ?? '',
    { query: { enabled: !!selectedAssignment } },
  );
  const assignment = detail.data;
  const submitAssignment = useSubmitAssignment();
  const uploadTargets = useCreateSubmissionUploadTargets();

  const getTargets = useMemo(() => (declared: FileDeclaration[]) =>
    uploadTargets.mutateAsync({ assignmentId: selectedAssignment ?? '', data: { files: declared } }),
    [selectedAssignment, uploadTargets]);

  const filteredAssignments = assignments.filter((a) => {
    if (subjectFilter !== 'all' && a.subject !== subjectFilter) return false;
    const deadline = new Date(`${a.deadlineDate}T${a.deadlineTime || '23:59:59'}`);
    if (dueFilter === 'overdue') return deadline < new Date() && a.status !== 'submitted' && a.status !== 'graded';
    if (dueFilter === 'this-week') {
      const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      return deadline <= weekEnd && deadline > new Date();
    }
    return true;
  });

  const getDaysUntilDue = (deadlineDate: string, deadlineTime: string | null) => {
    const deadline = new Date(`${deadlineDate}T${deadlineTime || '23:59:59'}`);
    return Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const handleSubmit = async () => {
    if (!selectedAssignment || (!submissionText.trim() && files.length === 0)) return;
    setSubmitError('');
    try {
      await submitAssignment.mutateAsync({
        assignmentId: selectedAssignment,
        data: {
          submissionText: submissionText.trim() || undefined,
          files: files.length ? files : undefined,
        },
      });
      setSubmissionText('');
      setFiles([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAssignmentsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAssignmentDetailQueryKey(selectedAssignment) }),
      ]);
    } catch (err) {
      setSubmitError(apiMessage(err, 'Submission failed. Please try again.'));
    }
  };

  const subjects = Array.from(new Set(assignments.map((a) => a.subject)));

  return (
    <div className="assignments-hub">
      <div className="page-header">
        <h1>Assignments &amp; Homework</h1>
        <p>Track and submit your assignments</p>
      </div>

      <div className="filter-bar">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AssignmentStatus | 'all')}
          className="filter-select"
        >
          <option value="all">All Statuses</option>
          {(Object.keys(STATUS_LABELS) as AssignmentStatus[]).map((status) => (
            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
          ))}
        </select>

        <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} className="filter-select">
          <option value="all">All Subjects</option>
          {subjects.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value)} className="filter-select">
          <option value="all">All Due Dates</option>
          <option value="overdue">Overdue</option>
          <option value="this-week">This Week</option>
        </select>
      </div>

      <div className="assignments-layout">
        <div className="assignments-list">
          {assignmentsQuery.isLoading ? (
            <div className="empty-state"><p>Loading assignments…</p></div>
          ) : assignmentsQuery.isError ? (
            <div className="empty-state"><p>{apiMessage(assignmentsQuery.error, 'Assignments could not be loaded.')}</p></div>
          ) : filteredAssignments.length === 0 ? (
            <div className="empty-state"><p>No assignments found</p></div>
          ) : (
            filteredAssignments.map((item) => {
              const daysLeft = getDaysUntilDue(item.deadlineDate, item.deadlineTime);
              const isPastDeadline = new Date(`${item.deadlineDate}T${item.deadlineTime || '23:59:59'}`) < new Date();

              return (
                <div
                  key={item.id}
                  className={`assignment-card status-${item.status}`}
                  onClick={() => { setSelectedAssignment(item.id); setSubmitError(''); setSubmissionText(''); setFiles([]); }}
                >
                  <div className="card-header">
                    <span className={`status-badge ${item.status}`}>{STATUS_LABELS[item.status]}</span>
                    <span className="subject">{item.subject}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <div className="meta">
                    <span className="marks">Marks: {item.marksAllocated}</span>
                    <span className={`deadline ${isPastDeadline ? 'overdue' : daysLeft <= 3 ? 'soon' : ''}`}>
                      Due: {new Date(`${item.deadlineDate}T12:00:00`).toLocaleDateString()}
                      {!isPastDeadline && daysLeft >= 0 && ` (${daysLeft} days)`}
                      {isPastDeadline && item.status !== 'submitted' && item.status !== 'graded' && ' (Overdue)'}
                    </span>
                  </div>
                  <button className="view-btn">View Details →</button>
                </div>
              );
            })
          )}
        </div>

        {selectedAssignment && (
          <div className="assignment-detail">
            {detail.isLoading ? (
              <p>Loading assignment…</p>
            ) : detail.isError || !assignment ? (
              <p>{apiMessage(detail.error, 'Assignment could not be loaded.')}</p>
            ) : (
              <>
                <div className="detail-header">
                  <h2>{assignment.title}</h2>
                  <button className="close-btn" onClick={() => setSelectedAssignment(null)}>✕</button>
                </div>

                <div className="detail-meta">
                  <div className="meta-item">
                    <span className="label">Subject:</span>
                    <span className="value">{assignment.subject}</span>
                  </div>
                  <div className="meta-item">
                    <span className="label">Marks:</span>
                    <span className="value">{assignment.marksAllocated}</span>
                  </div>
                  <div className="meta-item">
                    <span className="label">Due:</span>
                    <span className="value">
                      {new Date(`${assignment.deadlineDate}T12:00:00`).toLocaleDateString()}
                      {assignment.deadlineTime && ` at ${assignment.deadlineTime}`}
                    </span>
                  </div>
                </div>

                {assignment.description && (
                  <div className="description">
                    <h4>Description</h4>
                    <p>{assignment.description}</p>
                  </div>
                )}

                {assignment.files.length > 0 && (
                  <div className="description">
                    <h4>Files from your teacher</h4>
                    <FileLinks files={assignment.files} allowPreview={false} testId={`assignment-${assignment.id}`} emptyLabel="No files attached"
                      link={(fileId) => downloadAssignmentFile(assignment.id, fileId)} />
                  </div>
                )}


                {assignment.instructions.length > 0 && (
                  <div className="instructions">
                    <h4>Instructions</h4>
                    <div className="instruction-content">
                      {assignment.instructions.map((inst, idx) => (
                        <p key={idx}>{inst.content}</p>
                      ))}
                    </div>
                  </div>
                )}

                {assignment.submission?.status === 'graded' ? (
                  <div className="graded-submission">
                    <h4>Your Grade</h4>
                    <div className="grade-display">
                      <span className="mark">{assignment.submission.marksObtained}/{assignment.marksAllocated}</span>
                    </div>
                    {assignment.submission.feedback && (
                      <div className="feedback">
                        <h5>Feedback</h5>
                        <p>{assignment.submission.feedback}</p>
                      </div>
                    )}
                    <SubmittedFiles submission={assignment.submission} />
                  </div>
                ) : assignment.submission?.submittedAt && !assignment.allowResubmission ? (
                  <div className="graded-submission">
                    <h4>Submitted</h4>
                    <p>Your work was submitted on {new Date(assignment.submission.submittedAt).toLocaleString()}. Awaiting grading.</p>
                    {assignment.submission.submissionText && <p className="instruction-content">{assignment.submission.submissionText}</p>}
                    <SubmittedFiles submission={assignment.submission} />
                  </div>
                ) : new Date(`${assignment.deadlineDate}T${assignment.deadlineTime || '23:59:59'}`) < new Date() && !assignment.allowLate ? (
                  <div className="deadline-alert">
                    Deadline has passed. Your teacher closed this assignment to late work.
                  </div>
                ) : (
                  <div className="submission-form">
                    <h4>Your Submission</h4>
                    {assignment.submission?.submittedAt && (
                      <p className="description">You handed this in on {new Date(assignment.submission.submittedAt).toLocaleString()}. Saving replaces it, and your teacher keeps the earlier attempt in the history.</p>
                    )}
                    {new Date(`${assignment.deadlineDate}T${assignment.deadlineTime || '23:59:59'}`) < new Date() && (
                      <div className="deadline-alert">The deadline has passed, so this will be recorded as a late submission.</div>
                    )}
                    <textarea
                      value={submissionText}
                      onChange={(e) => setSubmissionText(e.target.value)}
                      placeholder="Enter your response..."
                      rows={8}
                      maxLength={20000}
                      className="submission-textarea"
                    />
                    <div className="description">
                      <h4>Your files{assignment.allowedFileTypes.length > 0 ? ` (${assignment.allowedFileTypes.map((type) => type.toUpperCase()).join(', ')})` : ''}</h4>
                      <FileDrop getTargets={getTargets} value={files} onChange={setFiles}
                        disabled={submitAssignment.isPending || uploading} onBusyChange={setUploading} testId="drop-submission-files"
                        allowedExtensions={assignment.allowedFileTypes} />
                      <p className="instruction-content">A file is only attached once storage confirms it, so nothing is marked as handed in until the upload really finished.</p>
                    </div>
                    {submitError && <div className="deadline-alert">{submitError}</div>}
                    <div className="form-actions">
                      <button
                        onClick={() => void handleSubmit()}
                        disabled={(!submissionText.trim() && files.length === 0) || submitAssignment.isPending || uploading}
                        className="submit-btn"
                      >
                        {submitAssignment.isPending ? 'Submitting…' : assignment.submission?.submittedAt ? 'Save new attempt' : 'Submit for Grading'}
                      </button>
                      <button onClick={() => { setSubmissionText(''); setFiles([]); }} className="clear-btn">Clear</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};