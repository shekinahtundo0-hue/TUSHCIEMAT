import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSearch } from 'wouter';
import {
  useListClassLessons,
  useListClasses,
  useListTeachableSubjects,
  type AssignmentKind,
  type ManagedAssignmentState,
  type ManagedResourceState,
  type PublishState,
  type ResourceCategory,
} from '@workspace/api-client-react';
import './classroom.css';

export const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  class_notes: 'Class notes',
  revision_notes: 'Revision notes',
  worksheet: 'Worksheet',
  reading_material: 'Reading material',
  presentation: 'Presentation',
  study_guide: 'Study guide',
  past_paper: 'Past paper',
  other: 'Other',
};

export const KIND_LABELS: Record<AssignmentKind, string> = {
  homework: 'Homework',
  classwork: 'Classwork',
  individual: 'Individual work',
  group: 'Group work',
  project: 'Project',
  revision: 'Revision',
  practical: 'Practical',
};

export const STATE_LABELS: Record<ManagedResourceState | ManagedAssignmentState, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Published',
  expired: 'Expired',
  archived: 'Archived',
  cancelled: 'Cancelled',
};

export const STATE_FILTERS: Array<{ value: PublishState; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'archived', label: 'Archived' },
];

/** Reads one query-string parameter so links from other screens can open the right record. */
export function useUrlParam(name: string): string {
  const search = useSearch();
  return useMemo(() => new URLSearchParams(search).get(name) ?? '', [search, name]);
}

/** Keeps local state in step when the URL changes while the page stays mounted. */
export function useSyncedParam(name: string): [string, (value: string) => void] {
  const param = useUrlParam(name);
  const [value, setValue] = useState(param);
  useEffect(() => { setValue(param); }, [param]);
  return [value, setValue];
}

export function ClassSelect({ value, onChange, label = 'Class group', testId }: {
  value: string; onChange: (classId: string) => void; label?: string; testId?: string;
}) {
  const classes = useListClasses();
  const options = classes.data ?? [];
  const pending = value !== '' && !options.some((group) => group.id === value);
  return <label className="field"><span>{label}</span>
    <select value={value} disabled={classes.isLoading} onChange={(event) => onChange(event.target.value)} data-testid={testId}>
      <option value="">{classes.isLoading ? 'Loading classes…' : 'Choose a class group'}</option>
      {pending && <option value={value}>Current class</option>}
      {options.map((group) => <option key={group.id} value={group.id}>{group.name}{group.stream ? ` · ${group.stream}` : ''} · {group.academicYear}</option>)}
    </select>
    {!classes.isLoading && options.length === 0 && <small className="field-hint">No class groups are assigned to you yet. Your school administrator assigns teachers to classes.</small>}
  </label>;
}

/**
 * Subjects come from what the teacher actually owns for the class. The free-text escape hatch
 * stays available because a first record for a new subject has nothing to list yet.
 */
export function SubjectSelect({ classId, value, onChange, testId }: {
  classId: string; value: string; onChange: (subject: string) => void; testId?: string;
}) {
  const subjects = useListTeachableSubjects({ classId }, { query: { enabled: !!classId } });
  const options = subjects.data?.data ?? [];
  const [custom, setCustom] = useState(false);
  const known = options.includes(value);
  const showInput = custom || (value !== '' && !known);
  return <div className="subject-field">
    <label className="field"><span>Subject</span>
      <select value={known ? value : custom || value ? '__other' : ''} disabled={!classId || subjects.isLoading}
        onChange={(event) => {
          if (event.target.value === '__other') { setCustom(true); onChange(''); return; }
          setCustom(false);
          onChange(event.target.value);
        }} data-testid={testId}>
        <option value="">{classId ? (subjects.isLoading ? 'Loading subjects…' : 'Choose a subject') : 'Choose a class first'}</option>
        {options.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
        <option value="__other">Other subject…</option>
      </select>
      {classId && !subjects.isLoading && options.length <= 1 && <small className="field-hint">Only subjects you teach or already have records for are listed.</small>}
    </label>
    {showInput && <label className="field"><span>Subject name</span>
      <input value={value} maxLength={100} placeholder="e.g. Mathematics" onChange={(event) => onChange(event.target.value)} data-testid="input-custom-subject" /></label>}
  </div>;
}

export function useLessonOptions(classId: string) {
  const lessons = useListClassLessons(classId, { query: { enabled: !!classId } });
  return useMemo(() => (lessons.data?.data ?? []).flatMap((unit) => unit.chapters.flatMap((chapter) => chapter.lessons
    .map((lesson) => ({ id: lesson.id, label: `${unit.unit} · ${chapter.chapter} · ${lesson.name}`, topic: lesson.topic ?? lesson.name })))), [lessons.data]);
}

/** Topic/chapter for a material — stored as the lesson id the API validates. */
export const KEEP_TOPIC = '__keep';

export function LessonSelect({ classId, value, onChange, keepOption = false }: {
  classId: string; value: string; onChange: (lessonId: string) => void; keepOption?: boolean;
}) {
  const lessons = useLessonOptions(classId);
  const pending = value !== '' && value !== KEEP_TOPIC && !lessons.some((lesson) => lesson.id === value);
  return <label className="field"><span>Topic / chapter</span>
    <select value={value} disabled={!classId} onChange={(event) => onChange(event.target.value)}>
      {keepOption && <option value={KEEP_TOPIC}>No change</option>}
      <option value="">{classId ? 'Not linked to a topic' : 'Choose a class first'}</option>
      {pending && <option value={value}>Current topic</option>}
      {lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.label}</option>)}
    </select>
    {classId && lessons.length === 0 && <small className="field-hint">No lessons are recorded for this class yet, so materials cannot be linked to a topic.</small>}
    {keepOption && <small className="field-hint">“Not linked to a topic” clears the current link when you save.</small>}
  </label>;
}

/** Topic for an assignment — the contract stores the text, so offer recorded lesson topics first. */
export function TopicSelect({ classId, value, onChange }: { classId: string; value: string; onChange: (topic: string) => void }) {
  const lessons = useLessonOptions(classId);
  const topics = useMemo(() => Array.from(new Set(lessons.map((lesson) => lesson.topic))), [lessons]);
  const known = topics.includes(value);
  const [custom, setCustom] = useState(false);
  const showInput = custom || (value !== '' && !known);
  return <div className="subject-field">
    <label className="field"><span>Topic</span>
      <select value={known ? value : custom || value ? '__custom' : ''} disabled={!classId}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '__custom') { setCustom(true); onChange(''); return; }
          setCustom(false);
          onChange(next);
        }}>
        <option value="">{classId ? 'No topic' : 'Choose a class first'}</option>
        {topics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
        <option value="__custom">Write your own…</option>
      </select></label>
    {showInput && <label className="field"><span>Topic name</span>
      <input value={value} maxLength={200} placeholder="e.g. Fractions and decimals" onChange={(event) => onChange(event.target.value)} data-testid="input-custom-topic" /></label>}
  </div>;
}

export function StateFilter({ value, onChange, testId }: { value: PublishState; onChange: (state: PublishState) => void; testId?: string }) {
  return <div className="dc-tabs" role="tablist" data-testid={testId}>
    {STATE_FILTERS.map((tab) => <button key={tab.value} role="tab" aria-selected={value === tab.value}
      className={`dc-tab ${value === tab.value ? 'is-active' : ''}`} onClick={() => onChange(tab.value)}>{tab.label}</button>)}
  </div>;
}

export function StateBadge({ state }: { state: ManagedResourceState | ManagedAssignmentState }) {
  return <span className={`dc-badge is-${state}`}>{STATE_LABELS[state] ?? state}</span>;
}

export function StorageNotice({ enabled }: { enabled: boolean }) {
  if (enabled) return null;
  return <div className="dc-notice" role="status"><AlertTriangle size={16} />
    <span>File storage is not connected for this school yet. Records can be written and published without attachments, but no files can be uploaded until your school administrator connects storage.</span></div>;
}

export { FileLinks } from '@/components/portals/file-links';

export function PageNotice({ kind = 'error', children }: { kind?: 'error' | 'success'; children: ReactNode }) {
  if (!children) return null;
  return <div className={kind === 'success' ? 'dc-success' : 'dc-error'} role={kind === 'success' ? 'status' : 'alert'}>{children}</div>;
}
