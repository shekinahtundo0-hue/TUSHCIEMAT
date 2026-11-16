import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus, Search, SlidersHorizontal, Trash2, UserPlus, Users } from 'lucide-react';
import {
  getGetDashboardQueryKey, getGetStudentQueryKey, getListInvitationsQueryKey, getListStudentsQueryKey,
  useAddGuardian, useCreateInvitation, useCreateStudent, useGetStudent, useListClasses, useListStudents,
  useRemoveGuardian, useUpdateStudent,
  type CreatedInvitation, type GuardianInputRelationship, type GuardianLink, type StudentDetail, type StudentStatus,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, InviteLink, LoadingBlock, Modal, PageHeader, StatusBadge } from '@/components/shell';
import { apiMessage, formatDate } from '@/lib/api';
import { MANAGERS, STAFF, hasAny } from '@/lib/roles';
import { useSession } from '@/lib/session';

const PAGE_SIZE = 12;
const RELATIONSHIPS: GuardianInputRelationship[] = ['mother', 'father', 'guardian', 'grandparent', 'sibling', 'sponsor', 'other'];

export function StudentsPage({ portal }: { portal: 'admin' | 'teach' }) {
  const { roles } = useSession();
  const canEdit = hasAny(roles, STAFF);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const timer = window.setTimeout(() => { setTerm(search.trim()); setPage(1); }, 250); return () => window.clearTimeout(timer); }, [search]);
  const params = useMemo(() => ({ search: term || undefined, page, pageSize: PAGE_SIZE }), [term, page]);
  const students = useListStudents(params);
  const items = students.data?.items ?? [];
  const showGuardians = items.some((s) => s.guardianCount !== null);
  const total = students.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <AppShell title={portal === 'teach' ? 'Learners' : 'Students'} portal={portal}><main className="page">
    <PageHeader kicker="SCHOOL RECORDS" title={portal === 'teach' ? 'Learners' : 'Students'} description={portal === 'teach' ? 'Learners in the classes you are assigned to.' : 'Manage learner records and keep school details in order.'}
      action={canEdit ? <Button onClick={() => setCreating(true)} testId="button-register-student"><Plus size={16} /> Register student</Button> : undefined} />
    <section className="panel records-panel"><div className="records-toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or admission number" aria-label="Search students" maxLength={100} data-testid="input-search-students" /></div><div className="filter-label"><SlidersHorizontal size={15} /> {total} record{total === 1 ? '' : 's'}</div></div>
      {students.isLoading ? <LoadingBlock label="Loading student records" /> : students.isError ? <ErrorState message={apiMessage(students.error, 'Student records are temporarily unavailable.')} retry={() => students.refetch()} /> : items.length === 0 ? <EmptyState icon={Users} title={term ? 'No matching students' : 'No students yet'} text={term ? 'Try another name or admission number.' : portal === 'teach' ? 'Learners appear here once your school assigns you to a class that has learners.' : 'Your school’s student records will appear here once you register a learner.'} action={!term && canEdit ? <Button onClick={() => setCreating(true)}><Plus size={15} /> Register first student</Button> : undefined} /> : <>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>STUDENT</th><th>ADMISSION NO.</th><th>CLASS</th>{showGuardians && <th>GUARDIANS</th>}<th>ACCOUNT</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{items.map((student) => <tr key={student.id} data-testid={`row-student-${student.id}`}>
          <td><div className="student-cell"><span className="student-initial">{student.firstName[0]}{student.lastName[0]}</span><span><b>{student.firstName} {student.lastName}</b><small>Registered {formatDate(student.createdAt)}</small></span></div></td>
          <td className="mono-cell">{student.admissionNumber}</td>
          <td>{student.className || <span className="muted-cell">Unassigned</span>}</td>
          {showGuardians && <td>{student.guardianCount ? student.guardianCount : <span className="muted-cell">None on file</span>}</td>}
          <td>{student.hasAccount ? 'Linked' : <span className="muted-cell">Not linked</span>}</td>
          <td><StatusBadge status={student.status} /></td>
          <td><button className="table-action" onClick={() => setOpenId(student.id)} aria-label={`Open ${student.firstName} ${student.lastName}`} data-testid={`button-open-student-${student.id}`}><MoreHorizontal size={18} /></button></td>
        </tr>)}</tbody></table></div>
        <div className="table-footer"><span>Showing <b>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</b> of <b>{total}</b> students</span><div className="pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></div>
      </>}
    </section>
    {creating && <CreateStudentModal close={() => setCreating(false)} />}
    {openId && <StudentModal studentId={openId} close={() => setOpenId(null)} />}
  </main></AppShell>;
}

function useStudentInvalidation() {
  const client = useQueryClient();
  return (studentId?: string) => {
    void client.invalidateQueries({ queryKey: getListStudentsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    if (studentId) void client.invalidateQueries({ queryKey: getGetStudentQueryKey(studentId) });
  };
}

function ClassSelect({ defaultValue }: { defaultValue: string }) {
  const classes = useListClasses();
  const [value, setValue] = useState(defaultValue);
  const options = classes.data ?? [];
  // Keep the existing class selectable and submittable before the class list finishes loading,
  // otherwise an early save would silently unassign the learner.
  const pending = value !== '' && !options.some((c) => c.id === value);
  return <select name="classId" value={value} onChange={(e) => setValue(e.target.value)}><option value="">Not assigned</option>{pending && <option value={value}>Current class</option>}{options.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.academicYear}</option>)}</select>;
}

function CreateStudentModal({ close }: { close: () => void }) {
  const create = useCreateStudent();
  const invalidate = useStudentInvalidation();
  const [notice, setNotice] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice('');
    const f = new FormData(event.currentTarget);
    create.mutate({ data: {
      firstName: String(f.get('firstName')).trim(), lastName: String(f.get('lastName')).trim(),
      admissionNumber: String(f.get('admissionNumber')).trim(), classId: String(f.get('classId')) || null,
    } }, {
      onSuccess: () => { invalidate(); close(); },
      onError: (error) => setNotice(apiMessage(error, 'Student registration could not be completed. Please try again.')),
    });
  }
  return <Modal title="Register a student" subtitle="Guardians and portal access can be added from the student’s record." close={close}><form className="modal-form" onSubmit={submit}>
    <div className="form-row"><label className="field"><span>First name <b>*</b></span><input name="firstName" required maxLength={80} data-testid="input-student-first-name" /></label><label className="field"><span>Last name <b>*</b></span><input name="lastName" required maxLength={80} data-testid="input-student-last-name" /></label></div>
    <div className="form-row"><label className="field"><span>Admission number <b>*</b></span><input name="admissionNumber" required maxLength={40} data-testid="input-admission-number" /></label><label className="field"><span>Class group</span><ClassSelect defaultValue="" /></label></div>
    {notice && <p className="form-error" role="alert">{notice}</p>}<div className="modal-actions"><Button kind="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={create.isPending} testId="button-save-student">{create.isPending ? 'Saving…' : 'Register student'}</Button></div>
  </form></Modal>;
}

function StudentModal({ studentId, close }: { studentId: string; close: () => void }) {
  const student = useGetStudent(studentId);
  const name = student.data ? `${student.data.firstName} ${student.data.lastName}` : 'Student record';
  return <Modal title={name} subtitle={student.data ? `Admission no. ${student.data.admissionNumber}` : 'Loading the learner’s record.'} close={close} wide>
    {student.isLoading ? <LoadingBlock label="Loading this record" /> : student.isError || !student.data ? <ErrorState message={apiMessage(student.error, 'This student record could not be loaded.')} retry={() => student.refetch()} /> : <StudentRecord student={student.data} />}
  </Modal>;
}

function StudentRecord({ student }: { student: StudentDetail }) {
  const { roles } = useSession();
  const canEdit = hasAny(roles, STAFF);
  const canInvite = hasAny(roles, MANAGERS);
  const update = useUpdateStudent();
  const invalidate = useStudentInvalidation();
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState<{ kind: 'student' } | { kind: 'parent'; guardian: GuardianLink } | null>(null);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice(''); setSaved(false);
    const f = new FormData(event.currentTarget);
    update.mutate({ studentId: student.id, data: {
      firstName: String(f.get('firstName')).trim(), lastName: String(f.get('lastName')).trim(),
      admissionNumber: String(f.get('admissionNumber')).trim(), classId: String(f.get('classId')) || null,
      status: String(f.get('status')) as StudentStatus,
    } }, {
      onSuccess: () => { invalidate(student.id); setSaved(true); },
      onError: (error) => setNotice(apiMessage(error, 'Student details could not be updated. Please try again.')),
    });
  }

  return <div className="record-sections">
    {canEdit ? <form className="modal-form" onSubmit={save}>
      <div className="modal-section-label">LEARNER DETAILS</div>
      <div className="form-row"><label className="field"><span>First name <b>*</b></span><input name="firstName" required maxLength={80} defaultValue={student.firstName} /></label><label className="field"><span>Last name <b>*</b></span><input name="lastName" required maxLength={80} defaultValue={student.lastName} /></label></div>
      <div className="form-row"><label className="field"><span>Admission number <b>*</b></span><input name="admissionNumber" required maxLength={40} defaultValue={student.admissionNumber} /></label><label className="field"><span>Class group</span><ClassSelect defaultValue={student.classId ?? ''} /></label></div>
      <label className="field"><span>Record status</span><select name="status" defaultValue={student.status}><option value="active">Active</option><option value="transferred">Transferred</option><option value="graduated">Graduated</option><option value="inactive">Inactive</option></select></label>
      {notice && <p className="form-error" role="alert">{notice}</p>}{saved && <p className="form-success" role="status">Changes saved.</p>}
      <div className="modal-actions"><Button type="submit" disabled={update.isPending} testId="button-save-student">{update.isPending ? 'Saving…' : 'Save changes'}</Button></div>
    </form> : <dl className="record-facts">
      <div><dt>Class</dt><dd>{student.className || 'Unassigned'}</dd></div><div><dt>Status</dt><dd><StatusBadge status={student.status} /></dd></div><div><dt>Registered</dt><dd>{formatDate(student.createdAt)}</dd></div>
    </dl>}

    {student.guardians !== null && <section>
      <div className="modal-section-label section-with-action"><span>GUARDIANS</span>{canEdit && !adding && <button className="text-button" onClick={() => setAdding(true)} data-testid="button-add-guardian"><Plus size={13} /> Add guardian</button>}</div>
      {student.guardians.length === 0 && !adding && <p className="muted-note">No guardians are on file for this learner yet.</p>}
      <ul className="guardian-list">{student.guardians.map((g) => <GuardianRow key={g.guardianId} studentId={student.id} guardian={g} canEdit={canEdit} canInvite={canInvite} invite={() => setInviting({ kind: 'parent', guardian: g })} />)}</ul>
      {adding && <AddGuardianForm studentId={student.id} done={() => setAdding(false)} />}
    </section>}

    {canInvite && <section>
      <div className="modal-section-label">LEARNER PORTAL</div>
      {student.hasAccount ? <p className="muted-note">This learner has accepted an invitation and can sign in to their learner portal.</p> : inviting?.kind === 'student' ? null : <p className="muted-note">This learner does not have a portal account. <button className="text-button" onClick={() => setInviting({ kind: 'student' })} data-testid="button-invite-learner"><UserPlus size={13} /> Invite learner</button></p>}
    </section>}
    {inviting && <InviteForm key={inviting.kind === 'parent' ? inviting.guardian.guardianId : 'student'} studentId={student.id} target={inviting} cancel={() => setInviting(null)} />}
  </div>;
}

function GuardianRow({ studentId, guardian, canEdit, canInvite, invite }: { studentId: string; guardian: GuardianLink; canEdit: boolean; canInvite: boolean; invite: () => void }) {
  const remove = useRemoveGuardian();
  const invalidate = useStudentInvalidation();
  const [error, setError] = useState('');
  return <li className="guardian-row">
    <div><b>{guardian.fullName}</b>{guardian.isPrimary && <span className="academic-chip">PRIMARY</span>}<small>{guardian.relationship}{guardian.email ? ` · ${guardian.email}` : ''}{guardian.phone ? ` · ${guardian.phone}` : ''}</small>
      <small>{guardian.hasAccount ? 'Has a family portal account' : 'No family portal account'}</small>{error && <small className="inline-error" role="alert">{error}</small>}</div>
    <div className="row-actions">
      {canInvite && !guardian.hasAccount && <button className="text-button" onClick={invite}><UserPlus size={13} /> Invite</button>}
      {canEdit && <button className="table-action" disabled={remove.isPending} aria-label={`Remove ${guardian.fullName}`} onClick={() => {
        if (!window.confirm(`Remove ${guardian.fullName} as a guardian of this learner?`)) return;
        remove.mutate({ studentId, guardianId: guardian.guardianId }, { onSuccess: () => invalidate(studentId), onError: (e) => setError(apiMessage(e, 'The guardian could not be removed.')) });
      }}><Trash2 size={15} /></button>}
    </div>
  </li>;
}

function AddGuardianForm({ studentId, done }: { studentId: string; done: () => void }) {
  const add = useAddGuardian();
  const invalidate = useStudentInvalidation();
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const f = new FormData(event.currentTarget);
    add.mutate({ studentId, data: {
      fullName: String(f.get('fullName')).trim(), relationship: String(f.get('relationship')) as GuardianInputRelationship,
      email: String(f.get('email')).trim() || null, phone: String(f.get('phone')).trim() || null, isPrimary: f.get('isPrimary') === 'on',
    } }, {
      onSuccess: () => { invalidate(studentId); done(); },
      onError: (e) => setError(apiMessage(e, 'The guardian could not be added.')),
    });
  }
  return <form className="modal-form nested-form" onSubmit={submit}>
    <div className="form-row"><label className="field"><span>Full name <b>*</b></span><input name="fullName" required minLength={2} maxLength={160} data-testid="input-guardian-name" /></label><label className="field"><span>Relationship <b>*</b></span><select name="relationship" required defaultValue="guardian">{RELATIONSHIPS.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select></label></div>
    <div className="form-row"><label className="field"><span>Email address</span><input type="email" name="email" maxLength={254} data-testid="input-guardian-email" /></label><label className="field"><span>Phone number</span><input type="tel" name="phone" pattern="\+?[0-9 ]{7,20}" placeholder="+254 7…" /></label></div>
    <label className="check-field"><input type="checkbox" name="isPrimary" /> Primary contact</label>
    <p className="muted-note">A guardian already on file with the same email and name is linked rather than duplicated, so siblings share one parent record.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button kind="quiet" onClick={done}>Cancel</Button><Button type="submit" disabled={add.isPending} testId="button-save-guardian">{add.isPending ? 'Adding…' : 'Add guardian'}</Button></div>
  </form>;
}

function InviteForm({ studentId, target, cancel }: { studentId: string; target: { kind: 'student' } | { kind: 'parent'; guardian: GuardianLink }; cancel: () => void }) {
  const create = useCreateInvitation();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const fixedEmail = target.kind === 'parent' ? target.guardian.email : null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const email = String(new FormData(event.currentTarget).get('email')).trim();
    create.mutate({ data: target.kind === 'parent'
      ? { email, role: 'parent', guardianId: target.guardian.guardianId }
      : { email, role: 'student', studentId } }, {
      onSuccess: (result) => { setCreated(result); void client.invalidateQueries({ queryKey: getListInvitationsQueryKey() }); },
      onError: (e) => setError(apiMessage(e, 'The invitation could not be created.')),
    });
  }
  if (created) return <><InviteLink acceptPath={created.acceptPath} email={created.invitation.email} /><div className="modal-actions"><Button kind="outline" onClick={cancel}>Done</Button></div></>;
  return <form className="modal-form nested-form" onSubmit={submit}>
    <div className="modal-section-label">{target.kind === 'parent' ? `INVITE ${target.guardian.fullName.toUpperCase()} TO THE FAMILY PORTAL` : 'INVITE THIS LEARNER'}</div>
    <label className="field"><span>Email address <b>*</b></span><input type="email" name="email" required maxLength={254} defaultValue={fixedEmail ?? ''} readOnly={!!fixedEmail} data-testid="input-invite-email" /></label>
    <p className="muted-note">{fixedEmail ? 'Parent invitations go to the email on file for this guardian.' : 'They must sign in with this email address to accept.'} Tushciemat does not send email yet, so you will get a link to share with them yourself.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button kind="quiet" onClick={cancel}>Cancel</Button><Button type="submit" disabled={create.isPending} testId="button-create-invite">{create.isPending ? 'Creating…' : 'Create invitation link'}</Button></div>
  </form>;
}
