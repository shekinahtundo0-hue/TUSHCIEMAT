import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Ban, CalendarClock, CalendarPlus, ClipboardCheck, Copy, Pencil, Plus, Send } from 'lucide-react';
import { Link } from 'wouter';
import {
  duplicateAssignment,
  extendAssignmentDeadline,
  getGetDashboardQueryKey,
  getListManagedAssignmentsQueryKey,
  publishAssignment,
  setAssignmentState,
  downloadAssignmentFile,
  useListClasses,
  useListManagedAssignments,
  type ManagedAssignment,
  type PublishState,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader } from '@/components/shell';
import { apiMessage, formatDate, todayInSchoolTimezone } from '@/lib/api';
import { ClassSelect, FileLinks, KIND_LABELS, StateBadge, StateFilter, StorageNotice, useSyncedParam } from './shared';
import './classroom.css';

const PAGE_SIZE = 20;

export function TeacherAssignmentsPage() {
  const client = useQueryClient();
  const classes = useListClasses();
  const [classId, setClassId] = useSyncedParam('class');
  const [state, setState] = useState<PublishState>('all');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState('');
  const [scheduling, setScheduling] = useState<ManagedAssignment | null>(null);
  const [extending, setExtending] = useState<ManagedAssignment | null>(null);
  const [confirming, setConfirming] = useState<{ assignment: ManagedAssignment; action: 'archived' | 'cancelled' } | null>(null);

  useEffect(() => { setPage(1); setNotice(''); setSaved(''); }, [classId, state]);

  const params = useMemo(() => ({ classId, state, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }), [classId, state, page]);
  const assignments = useListManagedAssignments(params, { query: { enabled: !!classId } });

  function invalidate() {
    void client.invalidateQueries({ queryKey: getListManagedAssignmentsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  }

  function classNameFor(id: string): string {
    return classes.data?.find((group) => group.id === id)?.name ?? 'your class';
  }

  async function act(assignment: ManagedAssignment, action: 'publish' | 'draft' | 'duplicate' | 'state', stateValue?: 'archived' | 'cancelled') {
    setBusy(`${action}:${assignment.id}`);
    setNotice('');
    setSaved('');
    try {
      if (action === 'publish' || action === 'draft') await publishAssignment(assignment.id, { state: action === 'publish' ? 'published' : 'draft' });
      else if (action === 'duplicate') await duplicateAssignment(assignment.id);
      else await setAssignmentState(assignment.id, { state: stateValue ?? 'archived' });
      invalidate();
      setSaved(action === 'publish'
        ? `“${assignment.title}” is live for ${classNameFor(assignment.classId)}. Learners have been notified.`
        : action === 'draft'
          ? `“${assignment.title}” is back in your drafts. Learners can no longer open it.`
          : action === 'duplicate'
            ? `A draft copy of “${assignment.title}” is ready to edit.`
            : `“${assignment.title}” was ${stateValue === 'cancelled' ? 'cancelled' : 'archived'}.`);
      if (action === 'state') setConfirming(null);
    } catch (error) {
      setNotice(apiMessage(error, 'The assignment could not be updated. Learners still see the previous state.'));
    } finally {
      setBusy('');
    }
  }

  const rows = assignments.data?.data ?? [];
  const total = assignments.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <AppShell title="Assignments" portal="teach"><main className="page dc-page">
    <PageHeader kicker="DIGITAL CLASSROOM" title="Assignments"
      description="Set work, control when learners see it, and extend or close it without losing the attempts already made."
      action={<Link href={`/teach/assignments/new${classId ? `?class=${encodeURIComponent(classId)}` : ''}`} className="button button-primary" data-testid="link-new-assignment"><Plus size={16} /> Create assignment</Link>} />

    <section className="panel dc-panel">
      <div className="dc-controls">
        <ClassSelect value={classId} onChange={setClassId} testId="select-assignment-class" />
      </div>
      {!classId ? <EmptyState icon={ClipboardCheck} title="Choose a class group" text="Assignments belong to one class, so pick a class to see the work you have set there." />
        : assignments.isLoading ? <LoadingBlock label="Loading your assignments" />
        : assignments.isError ? <ErrorState message={apiMessage(assignments.error, 'Your assignments could not be loaded.')} retry={() => { void assignments.refetch(); }} />
        : <>
          <StorageNotice enabled={assignments.data?.storageEnabled !== false} />
          <StateFilter value={state} onChange={setState} testId="filter-assignment-state" />
          {notice && <p className="dc-error" role="alert">{notice}</p>}
          {saved && <p className="dc-success" role="status">{saved}</p>}
          {rows.length === 0 ? <EmptyState icon={ClipboardCheck} title={state === 'all' ? 'No assignments yet' : 'Nothing in this list'}
            text={state === 'all' ? 'Create homework, classwork or a project and publish it when your class is ready.' : 'Change the filter to see your other assignments.'}
            action={<Link href={`/teach/assignments/new?class=${encodeURIComponent(classId)}`} className="button button-outline"><Plus size={15} /> Create assignment</Link>} />
            : <ul className="dc-list">{rows.map((assignment) => {
              const deadline = `${assignment.deadlineDate}T${assignment.deadlineTime ?? '23:59'}`;
              const closed = assignment.state === 'archived' || assignment.state === 'cancelled';
              const lockEditing = assignment.submissionCount > 0;
              return <li key={assignment.id} className="dc-card" data-testid={`card-assignment-${assignment.id}`}>
                <div className="dc-card-head"><h2>{assignment.title}</h2><StateBadge state={assignment.state} /></div>
                <p className="dc-meta">
                  <span>{classNameFor(assignment.classId)}</span>
                  <span>{assignment.subject}</span>
                  <span>{KIND_LABELS[assignment.assignmentKind]}</span>
                  {assignment.topic && <span>{assignment.topic}</span>}
                  <span>{assignment.marksAllocated} marks</span>
                  <span>Due {formatDate(assignment.deadlineDate, { day: 'numeric', month: 'short', year: 'numeric' })}{assignment.deadlineTime ? ` at ${assignment.deadlineTime}` : ''}</span>
                  {new Date(deadline) < new Date() && !closed && <span className="dc-late-chip">Deadline passed</span>}
                </p>
                {assignment.description && <p className="dc-description">{assignment.description}</p>}
                <p className="dc-meta"><span><b>{assignment.submissionCount}</b> submitted</span><span><b>{assignment.gradedCount}</b> graded</span>{assignment.allowLate ? <span>Late submissions allowed</span> : <span>Late submissions blocked</span>}{assignment.allowResubmission && <span>Resubmission allowed</span>}</p>
                <FileLinks files={assignment.files} allowPreview={false} testId={`assignment-${assignment.id}`}
                  link={(fileId) => downloadAssignmentFile(assignment.id, fileId)} />
                <div className="dc-actions">
                  <Link href={`/teach/submissions?assignment=${encodeURIComponent(assignment.id)}&class=${encodeURIComponent(assignment.classId)}`} className="dc-action" data-testid={`button-submissions-${assignment.id}`}>
                    <ClipboardCheck size={14} /> Submissions</Link>
                  {!closed && assignment.state !== 'published' && <button type="button" className="dc-action" disabled={busy !== ''} data-testid={`button-publish-${assignment.id}`} onClick={() => { void act(assignment, 'publish'); }}><Send size={14} /> Publish now</button>}
                  {!closed && assignment.state !== 'published' && <button type="button" className="dc-action" disabled={busy !== ''} onClick={() => setScheduling(assignment)}><CalendarClock size={14} /> Schedule</button>}
                  {assignment.state === 'published' && <button type="button" className="dc-action" disabled={busy !== ''} onClick={() => { void act(assignment, 'draft'); }}>Back to draft</button>}
                  {lockEditing
                    ? <button type="button" className="dc-action" disabled={busy !== ''} onClick={() => setExtending(assignment)}><CalendarPlus size={14} /> Extend deadline</button>
                    : <Link href={`/teach/assignments/edit?id=${encodeURIComponent(assignment.id)}&class=${encodeURIComponent(assignment.classId)}`} className="dc-action"><Pencil size={14} /> Edit</Link>}
                  <button type="button" className="dc-action" disabled={busy !== ''} onClick={() => { void act(assignment, 'duplicate'); }}><Copy size={14} /> Duplicate</button>
                  {assignment.state !== 'archived' && <button type="button" className="dc-action is-danger" disabled={busy !== ''} onClick={() => setConfirming({ assignment, action: 'archived' })}><Archive size={14} /> Archive</button>}
                  {!closed && <button type="button" className="dc-action is-danger" disabled={busy !== ''} onClick={() => setConfirming({ assignment, action: 'cancelled' })}><Ban size={14} /> Cancel</button>}
                  {busy.endsWith(`:${assignment.id}`) && <span className="dc-busy">Working…</span>}
                </div>
                {lockEditing && <p className="field-hint">{assignment.submissionCount} attempt{assignment.submissionCount === 1 ? '' : 's'} recorded, so the instructions are locked to protect them. Extend the deadline, cancel, or duplicate the assignment instead of editing.</p>}
              </li>;
            })}</ul>}
          {total > PAGE_SIZE && <div className="table-footer"><span>Showing <b>{rows.length}</b> of <b>{total}</b> assignments</span>
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
            </div></div>}
        </>}
    </section>

    {scheduling && <ScheduleModal assignment={scheduling} close={() => setScheduling(null)} onDone={(message) => { invalidate(); setScheduling(null); setSaved(message); }} />}
    {extending && <ExtendModal assignment={extending} close={() => setExtending(null)} onDone={(message) => { invalidate(); setExtending(null); setSaved(message); }} />}
    {confirming && <Modal title={confirming.action === 'cancelled' ? 'Cancel this assignment?' : 'Archive this assignment?'}
      subtitle={`“${confirming.assignment.title}” · ${classNameFor(confirming.assignment.classId)}`} close={() => setConfirming(null)} kicker="DIGITAL CLASSROOM">
      <p className="modal-copy">{confirming.action === 'cancelled'
        ? 'Learners can no longer submit work, and the assignment disappears from their list. Submissions and marks you already have are kept for the record.'
        : 'The assignment moves out of the active list for you and your learners. Submissions and marks are kept.'}</p>
      <div className="modal-actions"><Button kind="quiet" onClick={() => setConfirming(null)}>Keep it</Button>
        <Button kind="outline" testId="button-confirm-assignment-state" onClick={() => { void act(confirming.assignment, 'state', confirming.action); }}>
          {busy === `state:${confirming.assignment.id}` ? 'Working…' : confirming.action === 'cancelled' ? 'Cancel assignment' : 'Archive assignment'}
        </Button></div>
    </Modal>}
  </main></AppShell>;
}

function ScheduleModal({ assignment, close, onDone }: { assignment: ManagedAssignment; close: () => void; onDone: (message: string) => void }) {
  const [when, setWhen] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!when) { setError('Choose the date and time you want this published.'); return; }
    setSaving(true);
    setError('');
    try {
      await publishAssignment(assignment.id, { state: 'scheduled', publishAt: new Date(when).toISOString() });
      onDone(`“${assignment.title}” is scheduled for ${formatDate(when, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.`);
    } catch (caught) {
      setError(apiMessage(caught, 'The schedule could not be saved.'));
    } finally {
      setSaving(false);
    }
  }
  return <Modal title={`Schedule “${assignment.title}”`} subtitle="Learners are told about it at the moment you choose." close={close} kicker="DIGITAL CLASSROOM">
    <div className="modal-form">
      <label className="field"><span>Publish at</span>
        <input type="datetime-local" value={when} min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)} onChange={(event) => setWhen(event.target.value)} data-testid="input-assignment-schedule" /></label>
      {new Date(`${assignment.deadlineDate}T${assignment.deadlineTime ?? '23:59'}`) <= new Date(when || Date.now()) && <p className="field-hint">The deadline is not later than this publication time, so learners may see the work as already overdue.</p>}
      {error && <p className="dc-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button kind="quiet" onClick={close}>Cancel</Button>
        <Button disabled={saving} testId="button-save-assignment-schedule" onClick={() => { void save(); }}>{saving ? 'Scheduling…' : 'Schedule publication'}</Button></div>
    </div>
  </Modal>;
}

function ExtendModal({ assignment, close, onDone }: { assignment: ManagedAssignment; close: () => void; onDone: (message: string) => void }) {
  const [date, setDate] = useState(assignment.deadlineDate < todayInSchoolTimezone() ? todayInSchoolTimezone() : assignment.deadlineDate);
  const [time, setTime] = useState(assignment.deadlineTime ?? '23:59');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError('');
    try {
      await extendAssignmentDeadline(assignment.id, { deadlineDate: date, deadlineTime: time || undefined });
      onDone(`The deadline for “${assignment.title}” now runs to ${formatDate(date, { day: 'numeric', month: 'short', year: 'numeric' })}${time ? ` at ${time}` : ''}, and your class has been told.`);
    } catch (caught) {
      setError(apiMessage(caught, 'The deadline could not be extended.'));
    } finally {
      setSaving(false);
    }
  }
  return <Modal title={`Extend the deadline`} subtitle={`“${assignment.title}” · currently due ${formatDate(assignment.deadlineDate, { day: 'numeric', month: 'short', year: 'numeric' })}${assignment.deadlineTime ? ` at ${assignment.deadlineTime}` : ''}`} close={close} kicker="DIGITAL CLASSROOM">
    <div className="modal-form">
      <div className="form-row">
        <label className="field"><span>New deadline date</span><input type="date" value={date} min={assignment.deadlineDate} onChange={(event) => setDate(event.target.value)} data-testid="input-extend-date" /></label>
        <label className="field"><span>New deadline time</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} data-testid="input-extend-time" /></label>
      </div>
      <p className="field-hint">An extension must move the deadline later. Submissions already received keep their own late flag and marks.</p>
      {error && <p className="dc-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button kind="quiet" onClick={close}>Cancel</Button>
        <Button disabled={saving} testId="button-save-extension" onClick={() => { void save(); }}>{saving ? 'Saving…' : 'Extend deadline'}</Button></div>
    </div>
  </Modal>;
}
