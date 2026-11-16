import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus } from 'lucide-react';
import {
  getGetDashboardQueryKey, getListAcademicYearsQueryKey, getListClassesQueryKey, useCreateAcademicYear, useCreateTerm,
  useListAcademicYears, useSetCurrentAcademicYear, useSetCurrentTerm,
  type AcademicYear,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader } from '@/components/shell';
import { apiMessage, formatDate } from '@/lib/api';
import { STAFF, hasAny } from '@/lib/roles';
import { useSession } from '@/lib/session';

function useCalendarInvalidation() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: getListAcademicYearsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    void client.invalidateQueries({ queryKey: getListClassesQueryKey() });
  };
}

export function CalendarPage() {
  const { roles } = useSession();
  const canEdit = hasAny(roles, STAFF);
  const years = useListAcademicYears();
  const [creating, setCreating] = useState(false);
  const [addingTermTo, setAddingTermTo] = useState<AcademicYear | null>(null);

  return <AppShell title="School calendar" portal="admin"><main className="page">
    <PageHeader kicker="ACADEMIC CALENDAR" title="School calendar" description="School years and terms. The current term frames attendance and reporting across the school."
      action={canEdit ? <Button onClick={() => setCreating(true)} testId="button-create-year"><Plus size={16} /> Add school year</Button> : undefined} />
    {years.isLoading ? <LoadingBlock label="Loading the school calendar" /> : years.isError ? <ErrorState message={apiMessage(years.error, 'The school calendar could not be loaded.')} retry={() => years.refetch()} />
      : !years.data?.length ? <EmptyState icon={CalendarDays} title="No school years yet" text={canEdit ? 'Add your first school year to start organising classes and terms.' : 'Your school has not set up its calendar yet.'} action={canEdit ? <Button onClick={() => setCreating(true)}><Plus size={15} /> Add school year</Button> : undefined} />
      : <div className="calendar-list">{years.data.map((year) => <YearCard key={year.id} year={year} canEdit={canEdit} addTerm={() => setAddingTermTo(year)} />)}</div>}
    {creating && <PeriodModal kind="year" close={() => setCreating(false)} />}
    {addingTermTo && <PeriodModal kind="term" year={addingTermTo} close={() => setAddingTermTo(null)} />}
  </main></AppShell>;
}

function YearCard({ year, canEdit, addTerm }: { year: AcademicYear; canEdit: boolean; addTerm: () => void }) {
  const setYear = useSetCurrentAcademicYear();
  const setTerm = useSetCurrentTerm();
  const invalidate = useCalendarInvalidation();
  const [error, setError] = useState('');
  const range = (a: string, b: string) => `${formatDate(a)} – ${formatDate(b)}`;
  return <section className="panel year-card" data-testid={`card-year-${year.id}`}>
    <div className="year-head"><div><h2>{year.name} {year.isCurrent && <span className="academic-chip">CURRENT YEAR</span>}</h2><p>{range(year.startsOn, year.endsOn)}</p></div>
      {canEdit && <div className="row-actions">
        {!year.isCurrent && <Button kind="outline" disabled={setYear.isPending} onClick={() => { setError(''); setYear.mutate({ academicYearId: year.id }, { onSuccess: invalidate, onError: (e) => setError(apiMessage(e, 'The current year could not be changed.')) }); }}>Make current</Button>}
        <Button kind="quiet" onClick={addTerm} testId={`button-add-term-${year.id}`}><Plus size={15} /> Add term</Button>
      </div>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {year.terms.length === 0 ? <p className="muted-note">No terms in this year yet.</p> : <ul className="term-list">{year.terms.map((term) => <li key={term.id}>
      <span><b>{term.name}</b><small>{range(term.startsOn, term.endsOn)}</small></span>
      {term.isCurrent ? <span className="academic-chip">CURRENT TERM</span> : canEdit && <button className="text-button" disabled={setTerm.isPending} onClick={() => { setError(''); setTerm.mutate({ termId: term.id }, { onSuccess: invalidate, onError: (e) => setError(apiMessage(e, 'The current term could not be changed.')) }); }}>Make current</button>}
    </li>)}</ul>}
  </section>;
}

function PeriodModal({ kind, year, close }: { kind: 'year' | 'term'; year?: AcademicYear; close: () => void }) {
  const createYear = useCreateAcademicYear();
  const createTerm = useCreateTerm();
  const invalidate = useCalendarInvalidation();
  const [error, setError] = useState('');
  const pending = createYear.isPending || createTerm.isPending;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const f = new FormData(event.currentTarget);
    const data = { name: String(f.get('name')).trim(), startsOn: String(f.get('startsOn')), endsOn: String(f.get('endsOn')) };
    if (data.endsOn <= data.startsOn) { setError('The end date must be after the start date.'); return; }
    const handlers = { onSuccess: () => { invalidate(); close(); }, onError: (e: unknown) => setError(apiMessage(e, `The ${kind === 'year' ? 'school year' : 'term'} could not be saved.`)) };
    if (kind === 'year') createYear.mutate({ data }, handlers);
    else createTerm.mutate({ academicYearId: year!.id, data }, handlers);
  }
  return <Modal kicker="ACADEMIC CALENDAR" title={kind === 'year' ? 'Add a school year' : `Add a term to ${year!.name}`} subtitle={kind === 'year' ? 'Terms and class groups belong to a school year.' : 'Terms must fall within the school year and must not overlap.'} close={close}>
    <form className="modal-form" onSubmit={submit}>
      <label className="field"><span>Name <b>*</b></span><input name="name" required minLength={2} maxLength={40} placeholder={kind === 'year' ? 'e.g. 2027' : 'e.g. Term 1'} data-testid="input-period-name" /></label>
      <div className="form-row"><label className="field"><span>Starts on <b>*</b></span><input type="date" name="startsOn" required min={year?.startsOn} max={year?.endsOn} data-testid="input-period-start" /></label><label className="field"><span>Ends on <b>*</b></span><input type="date" name="endsOn" required min={year?.startsOn} max={year?.endsOn} data-testid="input-period-end" /></label></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button kind="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={pending} testId="button-save-period">{pending ? 'Saving…' : kind === 'year' ? 'Add school year' : 'Add term'}</Button></div>
    </form>
  </Modal>;
}
