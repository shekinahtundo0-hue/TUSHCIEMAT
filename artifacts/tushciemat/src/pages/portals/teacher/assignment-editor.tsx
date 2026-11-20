import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Plus, Trash2 } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getGetDashboardQueryKey,
  getListManagedAssignmentsQueryKey,
  publishAssignment,
  useCreateAssignment,
  useCreateAssignmentUploadTargets,
  useListClasses,
  useListManagedAssignments,
  useUpdateAssignment,
  type AssignmentKind,
  type FileDeclaration,
  type InstructionItem,
  type ManagedAssignment,
  type StoredFileInput,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/shell';
import { FileDrop } from '@/components/portals/FileDrop';
import { apiMessage, formatDate, todayInSchoolTimezone } from '@/lib/api';
import { formatBytes, KNOWN_UPLOAD_EXTENSIONS } from '@/lib/uploads';
import { ClassSelect, KIND_LABELS, PageNotice, StateBadge, SubjectSelect, TopicSelect, useUrlParam } from './shared';
import './classroom.css';

const KINDS = Object.entries(KIND_LABELS) as Array<[AssignmentKind, string]>;
const MAX_INSTRUCTIONS = 50;

type PublishChoice = 'draft' | 'published' | 'scheduled';

export function AssignmentEditorPage() {
  const assignmentId = useUrlParam('id');
  const classParam = useUrlParam('class');
  const classes = useListClasses();
  const editing = assignmentId !== '';
  // There is no single-assignment endpoint for teachers, so the record comes from the
  // management list of the class it belongs to.
  const list = useListManagedAssignments({ classId: classParam, state: 'all', limit: 100 }, { query: { enabled: editing && !!classParam } });
  const existing = list.data?.data.find((row) => row.id === assignmentId);

  if (!editing) return <AssignmentForm key="new" initialClass={classParam} />;

  if (list.isLoading || classes.isLoading) {
    return <Scaffold title="Assignment"><LoadingBlock label="Loading the assignment" /></Scaffold>;
  }
  if (!classParam) {
    return <Scaffold title="Assignment"><EmptyState icon={CalendarClock} title="Open this from your list"
      text="Assignments belong to a class group, so edit one from the class you picked on the Assignments page."
      action={<Link href="/teach/assignments" className="button button-outline">Back to assignments</Link>} /></Scaffold>;
  }
  if (list.isError || !existing) {
    return <Scaffold title="Assignment">
      <ErrorState message={apiMessage(list.error, 'This assignment could not be loaded. It may belong to a class you are no longer assigned to.')} retry={() => { void list.refetch(); }} />
    </Scaffold>;
  }
  if (existing.submissionCount > 0) {
    return <Scaffold title="Assignment"><EmptyState icon={CalendarClock} title="This assignment is locked"
      text={`${existing.submissionCount} learner${existing.submissionCount === 1 ? ' has' : 's have'} already submitted, so the question cannot be rewritten. Extend the deadline, cancel it, or duplicate it to set new work.`}
      action={<Link href={`/teach/submissions?assignment=${encodeURIComponent(existing.id)}&class=${encodeURIComponent(existing.classId)}`} className="button button-outline">Open submissions</Link>} /></Scaffold>;
  }
  return <AssignmentForm key={existing.id} assignmentId={existing.id} initialClass={existing.classId} existing={existing} />;
}

function Scaffold({ title, children }: { title: string; children: ReactNode }) {
  return <AppShell title={title} portal="teach"><main className="page dc-page">
    <PageHeader kicker="DIGITAL CLASSROOM" title={title} description="Preparing the assignment form." />
    <section className="panel dc-panel">{children}</section>
  </main></AppShell>;
}

function AssignmentForm({ assignmentId, initialClass, existing }: { assignmentId?: string; initialClass: string; existing?: ManagedAssignment }) {
  const editing = !!existing;
  const client = useQueryClient();
  const classes = useListClasses();
  const [, setLocation] = useLocation();
  const targets = useCreateAssignmentUploadTargets();
  const create = useCreateAssignment();
  const update = useUpdateAssignment();

  const [classId, setClassId] = useState(initialClass);
  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [instructions, setInstructions] = useState<string[]>((existing?.instructions ?? []).map((item) => item.content).filter(Boolean));
  const [kind, setKind] = useState<AssignmentKind>(existing?.assignmentKind ?? 'homework');
  const [topic, setTopic] = useState(existing?.topic ?? '');
  const [marks, setMarks] = useState(existing ? String(existing.marksAllocated) : '');
  const [deadlineDate, setDeadlineDate] = useState(existing?.deadlineDate ?? '');
  const [deadlineTime, setDeadlineTime] = useState(existing?.deadlineTime ?? '');
  const [allowLate, setAllowLate] = useState(existing?.allowLate ?? false);
  const [allowResubmission, setAllowResubmission] = useState(existing?.allowResubmission ?? false);
  const [allowedTypes, setAllowedTypes] = useState<string[]>(existing?.allowedFileTypes ?? []);
  const [files, setFiles] = useState<StoredFileInput[]>((existing?.files ?? []).map(({ id, path, name, size, type }) => ({ id, path, name, size, type })));
  const [publish, setPublish] = useState<PublishChoice>(existing && (existing.state === 'published' || existing.state === 'scheduled') ? existing.state : 'draft');
  const [publishAt, setPublishAt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const untouched = useRef(files.map((file) => file.id).join('|'));

  useEffect(() => { if (!editing) setClassId(initialClass); }, [initialClass, editing]);

  const getTargets = useMemo(() => (declared: FileDeclaration[]) =>
    targets.mutateAsync({ data: { classId, files: declared } }), [classId, targets]);

  const className = classes.data?.find((group) => group.id === classId)?.name ?? '';
  const busy = create.isPending || update.isPending || uploading;
  const marksNumber = Number(marks);
  const marksValid = Number.isInteger(marksNumber) && marksNumber > 0 && marksNumber <= 1000;
  const titleValid = title.trim().length >= 2 && title.trim().length <= 200;
  const canSave = !!classId && !!subject.trim() && titleValid && marksValid && !!deadlineDate && !busy && (publish !== 'scheduled' || !!publishAt);
  const backHref = `/teach/assignments?class=${encodeURIComponent(classId || initialClass)}`;
  const deadlinePast = !!deadlineDate && new Date(`${deadlineDate}T${deadlineTime || '23:59'}`) < new Date();

  async function submit() {
    setNotice('');
    if (!classId) { setNotice('Choose the class group this assignment belongs to.'); return; }
    if (!subject.trim()) { setNotice('Choose the subject the work belongs to.'); return; }
    if (!titleValid) { setNotice('Give the assignment a title between 2 and 200 characters.'); return; }
    if (!marksValid) { setNotice('Marks must be a whole number greater than zero.'); return; }
    if (!deadlineDate) { setNotice('Choose the date the work is due.'); return; }
    if (publish === 'scheduled' && !publishAt) { setNotice('Choose the date and time you want this published.'); return; }

    const items: InstructionItem[] = instructions.map((content) => content.trim()).filter(Boolean)
      .map((content) => ({ type: 'instruction', content: content.slice(0, 2000) }));

    try {
      if (editing && existing) {
        await update.mutateAsync({
          assignmentId: existing.id,
          data: {
            subject: subject.trim(),
            title: title.trim(),
            description: description.trim(),
            instructions: items,
            marksAllocated: marksNumber,
            deadlineDate,
            deadlineTime: deadlineTime || null,
            assignmentKind: kind,
            topic: topic.trim() || null,
            allowLate,
            allowResubmission,
            allowedFileTypes: allowedTypes,
            files,
          },
        });
        if (publish !== existing.state) {
          await publishAssignment(existing.id, publish === 'scheduled'
            ? { state: 'scheduled', publishAt: new Date(publishAt).toISOString() }
            : { state: publish });
        }
      } else {
        await create.mutateAsync({
          data: {
            classId,
            subject: subject.trim(),
            title: title.trim(),
            description: description.trim() || undefined,
            instructions: items.length ? items : undefined,
            marksAllocated: marksNumber,
            deadlineDate,
            deadlineTime: deadlineTime || undefined,
            assignmentKind: kind,
            topic: topic.trim() || undefined,
            allowLate,
            allowResubmission,
            allowedFileTypes: allowedTypes.length ? allowedTypes : undefined,
            files: files.length ? files : undefined,
            publish,
            publishAt: publish === 'scheduled' ? new Date(publishAt).toISOString() : undefined,
          },
        });
      }
      void client.invalidateQueries({ queryKey: getListManagedAssignmentsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      setLocation(backHref);
    } catch (error) {
      setNotice(apiMessage(error, editing
        ? 'The assignment could not be saved. Your entries are still here — please try again.'
        : 'The assignment could not be created. Your entries are still here — please try again.'));
    }
  }

  return <AppShell title={editing ? 'Edit assignment' : 'Create assignment'} portal="teach"><main className="page dc-page">
    <PageHeader kicker="DIGITAL CLASSROOM"
      title={editing ? 'Edit assignment' : 'Create assignment'}
      description={editing ? `“${existing?.title}” — nothing is sent to learners until you publish it.` : 'Set the work, the marks and the deadline, then publish when your class is ready.'}
      action={<Link href={backHref} className="button button-quiet" data-testid="link-back-to-assignments"><ArrowLeft size={15} /> Back to assignments</Link>} />

    <section className="panel dc-panel">
      {editing && existing && <div className="dc-card-head"><h2>{existing.title}</h2>
        <StateBadge state={existing.state} />
        <span className="dc-meta"><b>{existing.submissionCount}</b> submitted · <b>{existing.gradedCount}</b> graded</span></div>}
      <div className="dc-form">
        <div className="dc-form-grid">
          <label className="field"><span>Title <b>*</b></span>
            <input value={title} maxLength={200} placeholder="e.g. Fractions worksheet 12 Nov"
              onChange={(event) => setTitle(event.target.value)} data-testid="input-assignment-title" /></label>
          {editing
            ? <label className="field"><span>Class group</span>
              <input value={className || 'Current class'} readOnly disabled />
              <small className="field-hint">An assignment stays with the class it was set for.</small></label>
            : <ClassSelect value={classId} onChange={setClassId} testId="select-assignment-class-editor" />}
        </div>
        {!editing && !classId && <p className="field-hint">Choose a class group — subjects, topics and file storage all come from the class you pick.</p>}

        <div className="dc-form-grid">
          <SubjectSelect classId={classId} value={subject} onChange={setSubject} testId="select-assignment-subject" />
          <label className="field"><span>Type of work</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as AssignmentKind)} data-testid="select-assignment-kind">
              {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
        </div>

        <TopicSelect classId={classId} value={topic} onChange={setTopic} />

        <label className="field"><span>Instructions for learners</span>
          <textarea value={description} maxLength={5000} rows={3} placeholder="What the work is and how it should be done"
            onChange={(event) => setDescription(event.target.value)} data-testid="input-assignment-description" /></label>

        <fieldset className="dc-fieldset">
          <legend>Step-by-step points</legend>
          {instructions.map((content, index) => <div key={index} className="dc-step">
            <textarea rows={2} maxLength={2000} value={content} data-testid={`input-instruction-${index}`}
              placeholder={`Point ${index + 1}`}
              onChange={(event) => setInstructions(instructions.map((row, i) => (i === index ? event.target.value : row)))} />
            <button type="button" className="dc-action is-danger" aria-label={`Remove point ${index + 1}`}
              onClick={() => setInstructions(instructions.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
          </div>)}
          {instructions.length < MAX_INSTRUCTIONS && <button type="button" className="dc-action" data-testid="button-add-instruction"
            onClick={() => setInstructions([...instructions, ''])}><Plus size={14} /> Add a point</button>}
          <small className="field-hint">Each point shows as its own line in the learner’s assignment view.</small>
        </fieldset>

        <div className="dc-form-grid">
          <label className="field"><span>Marks <b>*</b></span>
            <input type="number" min={1} max={1000} step={1} value={marks} placeholder="e.g. 20"
              onChange={(event) => setMarks(event.target.value)} data-testid="input-assignment-marks" /></label>
          <label className="field"><span>Due date <b>*</b></span>
            <input type="date" value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} data-testid="input-assignment-deadline-date" /></label>
          <label className="field"><span>Due time</span>
            <input type="time" value={deadlineTime} onChange={(event) => setDeadlineTime(event.target.value)} data-testid="input-assignment-deadline-time" /></label>
        </div>
        {deadlinePast && <p className="field-hint">That deadline is already past, so learners will see this work as overdue the moment it is published.</p>}

        <fieldset className="dc-fieldset">
          <legend>Submission rules</legend>
          <div className="dc-check-row">
            <label className="dc-check"><input type="checkbox" checked={allowLate} onChange={(event) => setAllowLate(event.target.checked)} data-testid="check-allow-late" /> Allow late submissions (flagged as late)</label>
            <label className="dc-check"><input type="checkbox" checked={allowResubmission} onChange={(event) => setAllowResubmission(event.target.checked)} data-testid="check-allow-resubmission" /> Learners may replace their submission</label>
          </div>
          <p className="field-hint">Accepted formats — leave all unticked to accept any supported file.</p>
          <div className="dc-check-row">
            {KNOWN_UPLOAD_EXTENSIONS.map((extension) => <label key={extension} className="dc-check is-tight">
              <input type="checkbox" checked={allowedTypes.includes(extension)} data-testid={`check-format-${extension}`}
                onChange={(event) => setAllowedTypes(event.target.checked
                  ? [...allowedTypes, extension]
                  : allowedTypes.filter((row) => row !== extension))} />
              {extension.toUpperCase()}
            </label>)}
          </div>
        </fieldset>

        <fieldset className="dc-fieldset">
          <legend>Supporting files</legend>
          {!classId ? <p className="field-hint">Choose a class group first — storage is organised per class, so the class decides where the files belong.</p>
            : <>
              <FileDrop getTargets={getTargets} value={files} onChange={setFiles} disabled={busy} onBusyChange={setUploading} testId="drop-assignment-files"
                allowedExtensions={allowedTypes} />
              {files.map((file) => file.id).join('|') !== untouched.current && <p className="field-hint">Saving replaces the files learners can download. Replaced files are removed from storage.</p>}
            </>}
        </fieldset>

        <fieldset className="dc-fieldset">
          <legend>Publication</legend>
          <div className="dc-radio-row">
            {(['draft', 'published', 'scheduled'] as PublishChoice[]).map((option) => <label key={option} className="dc-radio">
              <input type="radio" name="publish" value={option} checked={publish === option}
                onChange={() => setPublish(option)} data-testid={`radio-assignment-publish-${option}`} />
              {option === 'draft' ? 'Keep as draft' : option === 'published' ? 'Publish to the class now' : 'Schedule for later'}
            </label>)}
          </div>
          {publish === 'scheduled' && <label className="field"><span>Publish at</span>
            <input type="datetime-local" value={publishAt} min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              onChange={(event) => setPublishAt(event.target.value)} data-testid="input-assignment-publish-at" /></label>}
          {publish === 'published' && <p className="field-hint">Learners in {className || 'your class'} are notified as soon as this is saved, with {deadlineDate ? `the deadline on ${formatDate(deadlineDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'no deadline set yet'}.</p>}
        </fieldset>

        <details className="dc-card">
          <summary className="dc-action"><CalendarClock size={14} /> Preview as learners will see it</summary>
          <div className="dc-preview">
            <h3>{title.trim() || 'Untitled assignment'}</h3>
            <p className="dc-meta">
              <span>{subject.trim() || 'No subject'}</span>
              <span>{KIND_LABELS[kind]}</span>
              {topic.trim() && <span>{topic.trim()}</span>}
              <span>{marks || '0'} marks</span>
              <span>{deadlineDate ? `Due ${formatDate(deadlineDate, { day: 'numeric', month: 'short', year: 'numeric' })}${deadlineTime ? ` at ${deadlineTime}` : ''}` : 'No deadline'}</span>
            </p>
            {description.trim() && <p className="dc-description">{description.trim()}</p>}
            {!!instructions.filter((row) => row.trim()).length && <ul className="dc-files">
              {instructions.filter((row) => row.trim()).map((row, index) => <li key={index} className="dc-file"><span className="dc-file-name">{row}</span></li>)}</ul>}
            {files.length > 0 && <ul className="dc-files">{files.map((file) => <li key={file.id} className="dc-file">
              <span className="dc-file-name">{file.name}</span><span className="dc-file-size">{formatBytes(file.size)}</span></li>)}</ul>}
            <p className="field-hint">{allowLate ? 'Late work will be accepted and flagged.' : 'Submissions close at the deadline.'} {allowedTypes.length ? `Files must be ${allowedTypes.map((type) => type.toUpperCase()).join(', ')}.` : 'Any supported file format is accepted.'}</p>
          </div>
        </details>

        <PageNotice>{notice}</PageNotice>
        <div className="modal-actions">
          <Link href={backHref} className="button button-quiet">Cancel</Link>
          <Button kind="gold" type="button" disabled={!canSave} testId="button-save-assignment" onClick={() => { void submit(); }}>
            {busy ? 'Saving…' : editing ? 'Save changes' : publish === 'draft' ? 'Save as draft' : 'Save assignment'}
          </Button>
        </div>
      </div>
    </section>
  </main></AppShell>;
}
