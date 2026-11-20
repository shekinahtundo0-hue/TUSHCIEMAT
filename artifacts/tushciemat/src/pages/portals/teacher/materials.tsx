import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, BookOpen, CalendarClock, Inbox, Pencil, Plus, Search, Send, Undo2 } from 'lucide-react';
import { Link } from 'wouter';
import {
  deleteLearningResource,
  downloadResourceFile,
  getGetDashboardQueryKey,
  getListManagedLearningResourcesQueryKey,
  previewResourceFile,
  publishLearningResource,
  useListClasses,
  useListManagedLearningResources,
  type ManagedResource,
  type PublishState,
  type ResourceCategory,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader } from '@/components/shell';
import { apiMessage, formatDate } from '@/lib/api';
import { CATEGORY_LABELS, ClassSelect, FileLinks, StateBadge, StateFilter, StorageNotice, useSyncedParam } from './shared';
import './classroom.css';

const PAGE_SIZE = 20;
const CATEGORIES = Object.entries(CATEGORY_LABELS) as Array<[ResourceCategory, string]>;

export function TeacherMaterialsPage() {
  const client = useQueryClient();
  const classes = useListClasses();
  const [classId, setClassId] = useSyncedParam('class');
  const [state, setState] = useState<PublishState>('all');
  const [category, setCategory] = useState<ResourceCategory | ''>('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState('');
  const [scheduling, setScheduling] = useState<ManagedResource | null>(null);
  const [confirming, setConfirming] = useState<ManagedResource | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setPage(1); setNotice(''); }, [classId, state, category]);

  const params = useMemo(() => ({
    classId, state, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
    category: category === '' ? undefined : category, search: term === '' ? undefined : term,
  }), [classId, state, category, term, page]);
  const resources = useListManagedLearningResources(params, { query: { enabled: !!classId } });

  function invalidate() {
    void client.invalidateQueries({ queryKey: getListManagedLearningResourcesQueryKey() });
    void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  }

  async function act(resource: ManagedResource, action: 'publish' | 'draft' | 'archive') {
    setBusy(`${action}:${resource.id}`);
    setNotice('');
    setSaved('');
    try {
      if (action === 'archive') await deleteLearningResource(resource.id);
      else await publishLearningResource(resource.id, { state: action === 'publish' ? 'published' : 'draft' });
      invalidate();
      setSaved(action === 'archive'
        ? `“${resource.title}” was archived. Learners can no longer open it.`
        : `“${resource.title}” is now published to ${classNameFor(resource.classId)}.`);
      if (action === 'archive') setConfirming(null);
    } catch (error) {
      setNotice(apiMessage(error, action === 'archive'
        ? 'The material could not be archived. It is still visible to learners.'
        : 'The publication status could not be changed.'));
    } finally {
      setBusy('');
    }
  }

  function classNameFor(id: string): string {
    return classes.data?.find((group) => group.id === id)?.name ?? 'your class';
  }

  const rows = resources.data?.data ?? [];
  const total = resources.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <AppShell title="Learning materials" portal="teach"><main className="page dc-page">
    <PageHeader kicker="DIGITAL CLASSROOM" title="My learning materials"
      description="Everything you have shared with your classes — drafts, scheduled notes, published material and archives."
      action={<Link href={`/teach/materials/new${classId ? `?class=${encodeURIComponent(classId)}` : ''}`} className="button button-primary" data-testid="link-new-material"><Plus size={16} /> Upload notes</Link>} />

    <section className="panel dc-panel">
      <div className="dc-controls">
        <ClassSelect value={classId} onChange={setClassId} testId="select-material-class" />
        <label className="field"><span>Category</span>
          <select value={category} disabled={!classId} onChange={(event) => setCategory(event.target.value as ResourceCategory | '')}>
            <option value="">All categories</option>
            {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        <label className="field dc-search-field"><span>Search</span>
          <span className="dc-search"><Search size={16} /><input value={search} disabled={!classId} maxLength={100}
            placeholder="Title or description" onChange={(event) => setSearch(event.target.value)} data-testid="input-material-search" /></span></label>
      </div>

      {!classId ? <EmptyState icon={Inbox} title="Choose a class group" text="Materials are organised per class, so pick one to see your notes, worksheets and past papers." />
        : resources.isLoading ? <LoadingBlock label="Loading your materials" />
        : resources.isError ? <ErrorState message={apiMessage(resources.error, 'Your materials could not be loaded.')} retry={() => { void resources.refetch(); }} />
        : <>
          <StorageNotice enabled={resources.data?.storageEnabled !== false} />
          <StateFilter value={state} onChange={setState} testId="filter-material-state" />
          {notice && <p className="dc-error" role="alert">{notice}</p>}
          {saved && <p className="dc-success" role="status">{saved}</p>}
          {rows.length === 0 ? <EmptyState icon={BookOpen} title={term || category ? 'No matching materials' : 'Nothing here yet'}
            text={term || category ? 'Clear the search or category filter to see the rest of your materials.' : 'Upload notes, worksheets or past papers to share them with this class.'}
            action={<Link href={`/teach/materials/new?class=${encodeURIComponent(classId)}`} className="button button-outline"><Plus size={15} /> Upload notes</Link>} />
            : <ul className="dc-list">{rows.map((resource) => <li key={resource.id} className="dc-card" data-testid={`card-material-${resource.id}`}>
              <div className="dc-card-head">
                <h2>{resource.title}</h2>
                <StateBadge state={resource.state} />
              </div>
              <p className="dc-meta">
                <span>{classNameFor(resource.classId)}</span>
                {resource.subject && <span>{resource.subject}</span>}
                <span>{CATEGORY_LABELS[resource.category]}</span>
                <span>Updated {formatDate(resource.updatedAt)}</span>
                {resource.state === 'scheduled' && resource.scheduledPublishAt && <span>Publishes {formatDate(resource.scheduledPublishAt, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                {resource.state === 'published' && resource.publishedAt && <span>Published {formatDate(resource.publishedAt)}</span>}
                {resource.state === 'expired' && resource.expiresAt && <span>Expired {formatDate(resource.expiresAt)}</span>}
              </p>
              {resource.description && <p className="dc-description">{resource.description}</p>}
              <FileLinks files={resource.files} testId={`material-${resource.id}`}
                link={(fileId, mode) => (mode === 'preview' ? previewResourceFile(resource.id, fileId) : downloadResourceFile(resource.id, fileId))} />
              <div className="dc-actions">
                <Link href={`/teach/materials/edit?id=${encodeURIComponent(resource.id)}&class=${encodeURIComponent(resource.classId)}`} className="dc-action"><Pencil size={14} /> Edit</Link>
                {resource.state !== 'published' && resource.state !== 'archived' && <>
                  <button type="button" className="dc-action" disabled={busy !== ''} data-testid={`button-publish-${resource.id}`} onClick={() => { void act(resource, 'publish'); }}>
                    <Send size={14} /> Publish now</button>
                  <button type="button" className="dc-action" disabled={busy !== ''} onClick={() => setScheduling(resource)}><CalendarClock size={14} /> Schedule</button>
                </>}
                {(resource.state === 'published' || resource.state === 'scheduled') && <button type="button" className="dc-action" disabled={busy !== ''}
                  onClick={() => { void act(resource, 'draft'); }}><Undo2 size={14} /> Back to draft</button>}
                {resource.state !== 'archived' && <button type="button" className="dc-action is-danger" disabled={busy !== ''}
                  onClick={() => setConfirming(resource)}><Archive size={14} /> Archive</button>}
                {busy.endsWith(`:${resource.id}`) && <span className="dc-busy">Working…</span>}
              </div>
            </li>)}</ul>}
          {total > PAGE_SIZE && <div className="table-footer"><span>Showing <b>{rows.length}</b> of <b>{total}</b> materials</span>
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
            </div></div>}
        </>}
    </section>

    {scheduling && <ScheduleModal resource={scheduling} close={() => setScheduling(null)} onDone={(message) => { invalidate(); setScheduling(null); setSaved(message); }} />}
    {confirming && <Modal title="Archive this material?" subtitle={`Learners in ${classNameFor(confirming.classId)} lose access straight away.`} close={() => setConfirming(null)} kicker="DIGITAL CLASSROOM">
      <p className="modal-copy">“{confirming.title}” will disappear from the learner digital classroom. The record and its files are kept for your school’s history, and the material stays in your list under Archived.</p>
      <div className="modal-actions"><Button kind="quiet" onClick={() => setConfirming(null)}>Keep it</Button>
        <Button kind="outline" disabled={busy !== ''} testId="button-confirm-archive" onClick={() => { void act(confirming, 'archive'); }}>{busy === `archive:${confirming.id}` ? 'Archiving…' : 'Archive material'}</Button></div>
    </Modal>}
  </main></AppShell>;
}

function ScheduleModal({ resource, close, onDone }: { resource: ManagedResource; close: () => void; onDone: (message: string) => void }) {
  const [when, setWhen] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setError('');
    if (!when) { setError('Choose the date and time you want this material published.'); return; }
    setSaving(true);
    try {
      await publishLearningResource(resource.id, { state: 'scheduled', publishAt: new Date(when).toISOString() });
      onDone(`“${resource.title}” is scheduled for ${formatDate(when, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.`);
    } catch (caught) {
      setError(apiMessage(caught, 'The schedule could not be saved.'));
    } finally {
      setSaving(false);
    }
  }
  return <Modal title={`Schedule “${resource.title}”`} subtitle="Learners see nothing until the moment you choose." close={close} kicker="DIGITAL CLASSROOM">
    <div className="modal-form">
      <label className="field"><span>Publish at</span>
        <input type="datetime-local" value={when} min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
          onChange={(event) => setWhen(event.target.value)} data-testid="input-schedule-at" /></label>
      {!resource.files.length && <p className="dc-notice" role="status">This material has no file attached yet. Learners will be told there is nothing to open unless you attach one first.</p>}
      {error && <p className="dc-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button kind="quiet" onClick={close}>Cancel</Button>
        <Button disabled={saving} testId="button-save-schedule" onClick={() => { void save(); }}>{saving ? 'Scheduling…' : 'Schedule publication'}</Button></div>
    </div>
  </Modal>;
}
