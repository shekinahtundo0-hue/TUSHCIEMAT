import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Inbox, LoaderCircle, Save, Search } from 'lucide-react';
import { Link } from 'wouter';
import {
  downloadAssignmentFile,
  downloadSubmissionFile,
  getListAssignmentSubmissionsQueryKey,
  getListManagedAssignmentsQueryKey,
  getGetDashboardQueryKey,
  markAssignmentSubmission,
  useListAssignmentSubmissions,
  useListClasses,
  useListManagedAssignments,
  type ListAssignmentSubmissionsFilter,
  type ListAssignmentSubmissionsSort,
  type ManagedAssignment,
  type SubmissionRosterRow,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/shell';
import { apiMessage, formatDate } from '@/lib/api';
import { ClassSelect, FileLinks, KIND_LABELS, PageNotice, StateBadge, useSyncedParam } from './shared';
import './classroom.css';

const PAGE_SIZE = 50;

const FILTERS: Array<{ value: ListAssignmentSubmissionsFilter; label: string }> = [
  { value: 'all', label: 'Everyone' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'graded', label: 'Marked' },
  { value: 'pending', label: 'Waiting for marks' },
  { value: 'late', label: 'Late' },
];

const SORTS: Array<{ value: ListAssignmentSubmissionsSort; label: string }> = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'submitted', label: 'Newest submissions' },
  { value: 'marks', label: 'Highest marks' },
];

const STATUS_LABELS: Record<SubmissionRosterRow['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  graded: 'Marked',
  overdue: 'Overdue',
};

export function TeacherSubmissionsPage() {
  const classes = useListClasses();
  const [classId, setClassId] = useSyncedParam('class');
  const [assignmentId, setAssignmentId] = useSyncedParam('assignment');

  const assignments = useListManagedAssignments({ classId, state: 'all', limit: 100 }, { query: { enabled: !!classId } });
  const list = useMemo(() => assignments.data?.data ?? [], [assignments.data]);
  const options = useMemo(() => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [list]);
  const assignment = list.find((row) => row.id === assignmentId);

  return <AppShell title="Student submissions" portal="teach"><main className="page dc-page">
    <PageHeader kicker="DIGITAL CLASSROOM" title="Student submissions"
      description="See who has handed in work, open each attempt, and record marks and feedback your learners can then read." />

    <section className="panel dc-panel">
      <div className="dc-controls">
        <ClassSelect value={classId} onChange={(next) => { setClassId(next); setAssignmentId(''); }} testId="select-submission-class" />
        <label className="field"><span>Assignment</span>
          <select value={assignmentId} disabled={!classId || assignments.isLoading} onChange={(event) => setAssignmentId(event.target.value)} data-testid="select-submission-assignment">
            <option value="">{classId ? (assignments.isLoading ? 'Loading assignments…' : 'Choose an assignment') : 'Choose a class first'}</option>
            {assignmentId && !options.some((row) => row.id === assignmentId) && <option value={assignmentId}>Selected assignment</option>}
            {options.map((row) => <option key={row.id} value={row.id}>{row.title} · {row.subject} · due {formatDate(row.deadlineDate, { day: 'numeric', month: 'short' })}</option>)}
          </select></label>
      </div>
      {!classId ? <EmptyState icon={ClipboardList} title="Choose a class group" text="Submissions belong to one assignment in one class, so pick a class to begin." />
        : assignments.isError ? <ErrorState message={apiMessage(assignments.error, 'Your assignments could not be loaded.')} retry={() => { void assignments.refetch(); }} />
        : !assignmentId ? <EmptyState icon={Inbox} title="Choose an assignment"
          text={list.length ? 'Pick an assignment to see its whole-class roster, who has submitted, and what still needs marks.' : 'This class has no assignments yet, so there is nothing to mark.'}
          action={<Link href={`/teach/assignments/new?class=${encodeURIComponent(classId)}`} className="button button-outline">Create assignment</Link>} />
        : assignments.isLoading ? <LoadingBlock label="Loading the assignment" />
        : !assignment ? <EmptyState icon={Inbox} title="Assignment not found"
          text="This assignment is not in your list for this class any more. It may have been archived, or it belongs to a class you are no longer assigned to."
          action={<Link href={`/teach/assignments?class=${encodeURIComponent(classId)}`} className="button button-outline">Back to assignments</Link>} />
        : <Roster assignment={assignment} className={classes.data?.find((group) => group.id === assignment.classId)?.name ?? ''} />}
    </section>
  </main></AppShell>;
}

function Roster({ assignment, className }: { assignment: ManagedAssignment; className: string }) {
  const client = useQueryClient();
  const [filter, setFilter] = useState<ListAssignmentSubmissionsFilter>('all');
  const [sort, setSort] = useState<ListAssignmentSubmissionsSort>('name');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');

  useEffect(() => { setPage(1); }, [filter, sort, term, assignment.id]);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo(() => ({ filter, sort, search: term || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }), [filter, sort, term, page]);
  const rows = useListAssignmentSubmissions(assignment.id, params);

  function invalidate() {
    void client.invalidateQueries({ queryKey: getListAssignmentSubmissionsQueryKey(assignment.id) });
    void client.invalidateQueries({ queryKey: getListManagedAssignmentsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  }

  const list = rows.data?.data ?? [];
  const total = rows.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <>
    <div className="dc-card-head"><h2>{assignment.title}</h2><StateBadge state={assignment.state} /></div>
    <p className="dc-meta">
      <span>{className || assignment.classId}</span>
      <span>{assignment.subject}</span>
      <span>{KIND_LABELS[assignment.assignmentKind]}</span>
      {assignment.topic && <span>{assignment.topic}</span>}
      <span>Out of {assignment.marksAllocated} marks</span>
      <span>Due {formatDate(assignment.deadlineDate, { day: 'numeric', month: 'short', year: 'numeric' })}{assignment.deadlineTime ? ` at ${assignment.deadlineTime}` : ''}</span>
    </p>
    {assignment.description && <p className="dc-description">{assignment.description}</p>}
    <FileLinks files={assignment.files} allowPreview={false} testId={`assignment-${assignment.id}`}
      link={(fileId) => downloadAssignmentFile(assignment.id, fileId)} />

    <div className="dc-counts">
      <span className="dc-count"><b>{rows.data?.submissionCount ?? 0}</b><span>Submitted</span></span>
      <span className="dc-count"><b>{rows.data?.gradedCount ?? 0}</b><span>Marked</span></span>
      <span className="dc-count"><b>{rows.data?.notSubmittedCount ?? 0}</b><span>Not submitted</span></span>
      <span className="dc-count"><b>{total}</b><span>In roster</span></span>
    </div>

    <div className="dc-controls">
      <label className="field dc-search-field"><span>Find a learner</span>
        <span className="dc-search"><Search size={15} />
          <input value={search} maxLength={100} placeholder="Name or admission number" onChange={(event) => setSearch(event.target.value)} data-testid="input-submission-search" /></span></label>
      <label className="field"><span>Show</span>
        <select value={filter} onChange={(event) => setFilter(event.target.value as ListAssignmentSubmissionsFilter)} data-testid="select-submission-filter">
          {FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      <label className="field"><span>Order by</span>
        <select value={sort} onChange={(event) => setSort(event.target.value as ListAssignmentSubmissionsSort)}>
          {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
    </div>

    <PageNotice>{notice}</PageNotice>
    {rows.isLoading ? <LoadingBlock label="Loading submissions" />
      : rows.isError ? <ErrorState message={apiMessage(rows.error, 'The roster could not be loaded.')} retry={() => { void rows.refetch(); }} />
      : list.length === 0 ? <EmptyState icon={Inbox} title="Nobody here"
        text={term || filter !== 'all' ? 'No learner matches this filter. Clear the search or show everyone.' : 'No learner in this class has started the assignment yet.'} />
        : <ul className="dc-list">{list.map((row) => <Row key={row.studentId} assignment={assignment} row={row} onSaved={invalidate} onError={setNotice} />)}</ul>}

    {total > PAGE_SIZE && <div className="table-footer"><span>Showing <b>{list.length}</b> of <b>{total}</b> learners</span>
      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
      </div></div>}
  </>;
}

/** The assignment brief learners worked from, next to their attempt. */
function Row({ assignment, row, onSaved, onError }: {
  assignment: ManagedAssignment;
  row: SubmissionRosterRow;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState(row.marksObtained === null ? '' : String(row.marksObtained));
  const [feedback, setFeedback] = useState(row.feedback ?? '');
  const [saving, setSaving] = useState(false);

  const submitted = row.submittedAt !== null;
  const marksNumber = Number(marks);
  const marksValid = marks.trim() !== '' && Number.isFinite(marksNumber) && marksNumber >= 0 && marksNumber <= assignment.marksAllocated;

  async function save() {
    if (!row.id || !marksValid) { onError('Enter marks between 0 and ' + assignment.marksAllocated + '.'); return; }
    setSaving(true);
    onError('');
    try {
      await markAssignmentSubmission(assignment.id, row.id, { marksObtained: marksNumber, feedback: feedback.trim() || undefined });
      setOpen(false);
      onSaved();
    } catch (error) {
      onError(apiMessage(error, `${row.studentName ?? 'This learner'} could not be marked. Nothing was saved.`));
    } finally {
      setSaving(false);
    }
  }

  return <li className="dc-card" data-testid={`row-submission-${row.studentId}`}>
    <div className="dc-card-head">
      <h2>{row.studentName ?? 'Learner'}{row.admissionNumber ? <small> · {row.admissionNumber}</small> : null}</h2>
      <span className={`dc-badge is-${submitted ? 'published' : 'draft'}`}>{STATUS_LABELS[row.status]}</span>
      {row.isLate && <span className="dc-late-chip">Late</span>}
      {row.marksObtained !== null && <span className="dc-score">{row.marksObtained} / {assignment.marksAllocated}</span>}
    </div>
    {submitted && <p className="dc-meta"><span>Handed in {formatDate(row.submittedAt as string, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      {row.markedAt && <span>Marked {formatDate(row.markedAt, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}</p>}
    {!submitted && <p className="dc-muted">Nothing has been handed in for this assignment.</p>}

    {submitted && <>
      {row.submittedText && <>{open
        ? <p className="dc-submitted-text">{row.submittedText}</p>
        : <button type="button" className="dc-action" onClick={() => setOpen(true)}><ClipboardList size={14} /> Read the written answer</button>}</>}
      <FileLinks files={row.submittedFiles} allowPreview
        testId={`submission-${row.id}`}
        link={(fileId) => downloadSubmissionFile(assignment.id, row.id as string, fileId)} />
      <div className="dc-actions">
        {row.marksObtained !== null
          ? <button type="button" className="dc-action" onClick={() => setOpen(!open)}>{open ? <CheckCircle2 size={14} /> : <Save size={14} />} {open ? 'Close marking' : 'Change marks'}</button>
          : <button type="button" className="dc-action" onClick={() => setOpen(true)}><Save size={14} /> Mark this work</button>}
      </div>
      {open && <div className="dc-mark-form">
        <div className="dc-form-grid">
          <label className="field"><span>Marks (out of {assignment.marksAllocated})</span>
            <input type="number" min={0} max={assignment.marksAllocated} step="any" value={marks}
              onChange={(event) => setMarks(event.target.value)} data-testid={`input-marks-${row.studentId}`} /></label>
          <p className="field-hint">Learners and guardians see the mark and feedback as soon as you save it, and a notification is sent.</p>
        </div>
        <label className="field"><span>Feedback</span>
          <textarea rows={3} maxLength={5000} value={feedback} placeholder="What was good and what to fix"
            onChange={(event) => setFeedback(event.target.value)} data-testid={`input-feedback-${row.studentId}`} /></label>
        {marks !== '' && !marksValid && <p className="dc-error">Marks must be between 0 and {assignment.marksAllocated}.</p>}
        <div className="modal-actions">
          <Button kind="quiet" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={saving || !marksValid} testId={`button-save-marks-${row.studentId}`} onClick={() => { void save(); }}>
            {saving ? <><LoaderCircle size={14} className="subtle-spin" /> Saving…</> : row.marksObtained === null ? 'Save marks and feedback' : 'Update marks and feedback'}
          </Button>
        </div>
      </div>}
    </>}
  </li>;
}
