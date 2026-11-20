import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getGetDashboardQueryKey,
  getListManagedLearningResourcesQueryKey,
  publishLearningResource,
  useCreateLearningResource,
  useCreateResourceUploadTargets,
  useGetLearningResource,
  useUpdateLearningResource,
  type FileDeclaration,
  type ResourceCategory,
  type ResourceDetail,
  type ResourceType,
  type StoredFileInput,
} from '@workspace/api-client-react';
import { AppShell, Button, ErrorState, LoadingBlock, PageHeader } from '@/components/shell';
import { FileDrop } from '@/components/portals/FileDrop';
import { apiMessage } from '@/lib/api';
import { extensionOf, formatBytes } from '@/lib/uploads';
import { CATEGORY_LABELS, ClassSelect, KEEP_TOPIC, LessonSelect, PageNotice, StateBadge, SubjectSelect, useUrlParam } from './shared';
import './classroom.css';

const CATEGORIES = Object.entries(CATEGORY_LABELS) as Array<[ResourceCategory, string]>;
const TYPE_OPTIONS: Array<{ value: ResourceType; label: string }> = [
  { value: 'other', label: 'Other' },
  { value: 'link', label: 'Link or written note' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Document' },
  { value: 'pptx', label: 'Presentation' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
];
/** Mirrors the API’s own derivation so the record never claims a type its file contradicts. */
const TYPE_BY_EXTENSION: Record<string, ResourceType> = {
  pdf: 'pdf', doc: 'docx', docx: 'docx', ppt: 'pptx', pptx: 'pptx', jpg: 'image', jpeg: 'image', png: 'image',
};

type PublishChoice = 'draft' | 'published' | 'scheduled';

export function MaterialEditorPage() {
  const resourceId = useUrlParam('id');
  const classParam = useUrlParam('class');
  const editing = resourceId !== '';
  const detail = useGetLearningResource(resourceId, { query: { enabled: editing } });

  if (editing && detail.isLoading) {
    return <Scaffold classId={classParam}><LoadingBlock label="Loading the material" /></Scaffold>;
  }
  if (editing && (detail.isError || !detail.data)) {
    return <Scaffold classId={classParam}>
      <ErrorState message={apiMessage(detail.error, 'This material could not be loaded. It may belong to a class you are no longer assigned to.')} retry={() => { void detail.refetch(); }} />
    </Scaffold>;
  }
  return <MaterialForm key={resourceId || 'new'} resourceId={resourceId} initialClass={classParam} existing={detail.data} />;
}

function Scaffold({ classId, children }: { classId: string; children: React.ReactNode }) {
  return <AppShell title="Upload notes" portal="teach"><main className="page dc-page">
    <PageHeader kicker="DIGITAL CLASSROOM" title="Upload notes" description="Preparing the material form." />
    <section className="panel dc-panel">{children}</section>
  </main></AppShell>;
}

function MaterialForm({ resourceId, initialClass, existing }: { resourceId: string; initialClass: string; existing?: ResourceDetail }) {
  const editing = !!existing;
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const targets = useCreateResourceUploadTargets();
  const create = useCreateLearningResource();
  const update = useUpdateLearningResource();

  const [classId, setClassId] = useState(initialClass);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [category, setCategory] = useState<ResourceCategory>(existing?.category ?? 'class_notes');
  const [lessonId, setLessonId] = useState(editing ? KEEP_TOPIC : '');
  const [resourceType, setResourceType] = useState<ResourceType>(existing?.resourceType ?? 'other');
  const [publish, setPublish] = useState<PublishChoice>(editing ? (existing.isVisibleToStudents ? 'published' : existing.scheduledPublishAt ? 'scheduled' : 'draft') : 'draft');
  const [publishAt, setPublishAt] = useState('');
  const [files, setFiles] = useState<StoredFileInput[]>((existing?.files ?? []).map(({ id, path, name, size, type }) => ({ id, path, name, size, type })));
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const untouched = useRef(files.map((file) => file.id).join('|'));

  useEffect(() => { setClassId(initialClass); }, [initialClass]);

  const getTargets = useMemo(() => (declared: FileDeclaration[]) =>
    targets.mutateAsync({ data: { classId, files: declared } }), [classId, targets]);

  const busy = create.isPending || update.isPending || uploading;
  const titleValid = title.trim().length >= 2;
  const canSave = !!classId && titleValid && !busy && (publish !== 'scheduled' || !!publishAt);
  const backHref = `/teach/materials${classId ? `?class=${encodeURIComponent(classId)}` : ''}`;

  async function submit() {
    setNotice('');
    if (!classId) { setNotice('Choose the class group this material belongs to.'); return; }
    if (!titleValid) { setNotice('Give the material a title of at least two characters.'); return; }
    if (publish === 'scheduled' && !publishAt) { setNotice('Choose the date and time you want this published.'); return; }
    try {
      if (editing && existing) {
        await update.mutateAsync({
          resourceId: existing.id,
          data: {
            title: title.trim(),
            description: description.trim(),
            subject: subject.trim(),
            category,
            ...(lessonId === KEEP_TOPIC ? {} : { lessonId: lessonId === '' ? null : lessonId }),
            files,
          },
        });
        // The record keeps its own publication state unless the teacher asked for a different one.
        const live = existing.isVisibleToStudents ? 'published' : 'draft';
        if (publish === 'scheduled') {
          await publishLearningResource(existing.id, { state: 'scheduled', publishAt: new Date(publishAt).toISOString() });
        } else if (publish !== live) {
          await publishLearningResource(existing.id, { state: publish });
        }
      } else {
        const extension = files.length ? extensionOf(files[0].name) : '';
        await create.mutateAsync({
          data: {
            classId,
            title: title.trim(),
            description: description.trim() || undefined,
            subject: subject.trim() || undefined,
            category,
            resourceType: TYPE_BY_EXTENSION[extension] ?? resourceType,
            ...(lessonId && lessonId !== KEEP_TOPIC ? { lessonId } : {}),
            files: files.length ? files : undefined,
            publish,
            publishAt: publish === 'scheduled' ? new Date(publishAt).toISOString() : undefined,
          },
        });
      }
      void client.invalidateQueries({ queryKey: getListManagedLearningResourcesQueryKey() });
      void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      setLocation(backHref);
    } catch (error) {
      setNotice(apiMessage(error, editing
        ? 'The material could not be saved. Your entries are still here — please try again.'
        : 'The material could not be created. Your entries are still here — please try again.'));
    }
  }

  return <AppShell title={editing ? 'Edit material' : 'Upload notes'} portal="teach"><main className="page dc-page">
    <PageHeader kicker="DIGITAL CLASSROOM"
      title={editing ? 'Edit learning material' : 'Upload notes'}
      description={editing ? 'Update the details or replace the files learners open in their digital classroom.' : 'Attach the notes, worksheets or past papers your class should have.'}
      action={<Link href={backHref} className="button button-quiet" data-testid="link-back-to-materials"><ArrowLeft size={15} /> Back to materials</Link>} />

    <section className="panel dc-panel">
      {editing && existing && <div className="dc-card-head"><h2>{existing.title}</h2>
        <StateBadge state={existing.isVisibleToStudents ? 'published' : existing.scheduledPublishAt ? 'scheduled' : 'draft'} /></div>}
      <div className="dc-form">
        <div className="dc-form-grid">
          <label className="field"><span>Title <b>*</b></span>
            <input value={title} maxLength={200} required placeholder="e.g. Fractions — class notes 12 Nov"
              onChange={(event) => setTitle(event.target.value)} data-testid="input-material-title" /></label>
          <ClassSelect value={classId} onChange={setClassId} label="Class group" testId="select-editor-class" />
        </div>
        {editing ? <p className="field-hint">A material always stays with the class it was created for. Files you attach here are confirmed against that class.</p>
          : !classId && <p className="field-hint">Choose a class group — files, subjects and topics are all taken from the class you pick.</p>}

        <label className="field"><span>Description</span>
          <textarea value={description} maxLength={2000} rows={3} placeholder="What learners should do with this material"
            onChange={(event) => setDescription(event.target.value)} data-testid="input-material-description" /></label>

        <div className="dc-form-grid">
          <SubjectSelect classId={classId} value={subject} onChange={setSubject} testId="select-material-subject" />
          <label className="field"><span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as ResourceCategory)} data-testid="select-material-category">
              {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
        </div>

        <LessonSelect classId={classId} value={lessonId} onChange={setLessonId} keepOption={editing} />

        {files.length === 0 && <label className="field"><span>Material type</span>
          <select value={resourceType} onChange={(event) => setResourceType(event.target.value as ResourceType)}>
            {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <small className="field-hint">Attaching a file sets this from the file you upload.</small></label>}

        <fieldset className="dc-fieldset">
          <legend>Attachments</legend>
          {!classId ? <p className="field-hint">Choose a class group first — storage is organised per class, so the class decides where the files belong.</p>
            : <>
              <FileDrop getTargets={getTargets} value={files} onChange={setFiles} disabled={busy} onBusyChange={setUploading} testId="drop-material-files" />
              {files.map((file) => file.id).join('|') !== untouched.current && <p className="field-hint">Saving replaces the files learners can open. Replaced files are removed from storage.</p>}
            </>}
        </fieldset>

        <fieldset className="dc-fieldset">
          <legend>Publication</legend>
          <div className="dc-radio-row">
            {(['draft', 'published', 'scheduled'] as PublishChoice[]).map((option) => <label key={option} className="dc-radio">
              <input type="radio" name="publish" value={option} checked={publish === option}
                disabled={option !== 'draft' && !files.length && !editing}
                onChange={() => setPublish(option)} data-testid={`radio-publish-${option}`} />
              {option === 'draft' ? 'Keep as draft' : option === 'published' ? 'Publish to the class now' : 'Schedule for later'}
            </label>)}
          </div>
          {publish === 'scheduled' && <label className="field"><span>Publish at</span>
            <input type="datetime-local" value={publishAt} min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              onChange={(event) => setPublishAt(event.target.value)} data-testid="input-material-publish-at" /></label>}
          {!editing && !files.length && <p className="field-hint">Learners are only told about a material once it is published, and a published material with no file leaves them nothing to open.</p>}
        </fieldset>

        <details className="dc-card">
          <summary className="dc-action"><Eye size={14} /> Preview as learners will see it</summary>
          <div className="dc-preview">
            <h3>{title.trim() || 'Untitled material'}</h3>
            <p className="dc-meta">
              <span>{subject.trim() || 'No subject'}</span>
              <span>{CATEGORY_LABELS[category]}</span>
              <span>{files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'No file attached'}</span>
            </p>
            {description.trim() && <p className="dc-description">{description.trim()}</p>}
            {!!files.length && <ul className="dc-files">{files.map((file) => <li key={file.id} className="dc-file">
              <span className="dc-file-name">{file.name}</span><span className="dc-file-size">{formatBytes(file.size)}</span></li>)}</ul>}
            <p className="field-hint">Only files the API has confirmed in storage are attached to the record, so this is what a saved material looks like.</p>
          </div>
        </details>

        <PageNotice>{notice}</PageNotice>
        <div className="modal-actions">
          <Link href={backHref} className="button button-quiet">Cancel</Link>
          <Button kind="gold" type="button" disabled={!canSave} testId="button-save-material" onClick={() => { void submit(); }}>
            {busy ? 'Saving…' : editing ? 'Save changes' : publish === 'draft' ? 'Save as draft' : 'Save material'}
          </Button>
        </div>
      </div>
    </section>
  </main></AppShell>;
}
