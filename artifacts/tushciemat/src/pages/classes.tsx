import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Plus, UserPlus, Users, X } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetDashboardQueryKey, getListClassesQueryKey, useAssignTeacher, useCreateClass, useListAcademicYears,
  useListClasses, useListMembers, useRemoveTeacherAssignment,
  type ClassRecord, type TeacherAssignmentInputAssignmentRole,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader } from '@/components/shell';
import { apiMessage } from '@/lib/api';
import { ATTENDANCE_TAKERS, CLASS_VIEWERS, STAFF, hasAny } from '@/lib/roles';
import { useSession } from '@/lib/session';

export function ClassesPage({ portal }: { portal: 'admin' | 'teach' }) {
  const { roles } = useSession();
  if (!hasAny(roles, CLASS_VIEWERS)) {
    return <AppShell title="Teaching" portal={portal}><main className="page"><PageHeader kicker="TEACHING" title="Teaching access" description="Your school membership does not include assigned teaching access." />
      <EmptyState icon={BookOpen} title="Assigned teaching access is not available" text="Tutor membership does not provide access to assigned classes or learner records here. Ask your school administrator about your access." /></main></AppShell>;
  }
  return <AccessibleClassesPage portal={portal} />;
}

function AccessibleClassesPage({ portal }: { portal: 'admin' | 'teach' }) {
  const { roles } = useSession();
  const canEdit = hasAny(roles, STAFF);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<ClassRecord | null>(null);
  const classes = useListClasses();
  const title = portal === 'teach' ? 'My classes' : 'Classes';

  return <AppShell title={title} portal={portal}><main className="page"><PageHeader kicker="LEARNING GROUPS" title={title} description={portal === 'teach' ? 'The class groups your school has assigned to you.' : 'Organise class groups and their teachers for each school year.'} action={canEdit ? <Button onClick={() => setCreating(true)} testId="button-create-class"><Plus size={16} /> Create class group</Button> : undefined} />
    {classes.isLoading ? <LoadingBlock label="Loading class groups" /> : classes.isError ? <ErrorState message={apiMessage(classes.error, 'Class groups could not be loaded.')} retry={() => classes.refetch()} /> : classes.data?.length ? <div className="classes-grid">{classes.data.map((group) => <ClassCard key={group.id} group={group} portal={portal} canEdit={canEdit} assign={() => setAssigning(group)} />)}</div>
      : <EmptyState icon={BookOpen} title={portal === 'teach' ? 'No classes assigned yet' : 'No class groups yet'} text={portal === 'teach' ? 'Your school administrator assigns teachers to classes. Assigned classes will appear here.' : 'Create your first class group to start organising learners and taking attendance.'} action={canEdit ? <Button onClick={() => setCreating(true)}><Plus size={15} /> Create class group</Button> : undefined} />}
    {creating && <CreateClassModal close={() => setCreating(false)} />}
    {assigning && <AssignTeacherModal group={assigning} close={() => setAssigning(null)} />}
  </main></AppShell>;
}

function ClassCard({ group, portal, canEdit, assign }: { group: ClassRecord; portal: 'admin' | 'teach'; canEdit: boolean; assign: () => void }) {
  const { roles } = useSession();
  const remove = useRemoveTeacherAssignment();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const registerPath = portal === 'teach' ? '/teach/attendance' : '/admin/attendance';
  return <article className="class-card" data-testid={`card-class-${group.id}`}><div className="class-card-top"><span className="class-card-icon"><BookOpen size={18} /></span><span className="academic-chip">{group.academicYear}</span></div><div className="class-card-grade">{group.grade}{group.stream ? <span> · {group.stream}</span> : null}</div><h2>{group.name}</h2>
    <ul className="teacher-list">{group.teachers.map((t) => <li key={t.id}><span>{t.teacherName || 'Teacher'}<small>{t.assignmentRole === 'class_teacher' ? 'Class teacher' : `Subject teacher${t.subject ? ` · ${t.subject}` : ''}`}</small></span>
      {canEdit && <button className="table-action" aria-label={`Remove ${t.teacherName || 'teacher'} from ${group.name}`} disabled={remove.isPending} onClick={() => remove.mutate({ classId: group.id, assignmentId: t.id }, { onSuccess: () => client.invalidateQueries({ queryKey: getListClassesQueryKey() }), onError: (e) => setError(apiMessage(e, 'The assignment could not be removed.')) })}><X size={14} /></button>}</li>)}
      {group.teachers.length === 0 && <li className="muted-cell">No teacher assigned</li>}</ul>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="class-card-bottom"><span><Users size={14} /> {group.studentCount} {group.studentCount === 1 ? 'learner' : 'learners'}</span>
      {canEdit && <button className="class-link" onClick={assign}><UserPlus size={14} /> Assign</button>}
      {hasAny(roles, ATTENDANCE_TAKERS) && <Link href={`${registerPath}?class=${encodeURIComponent(group.id)}`} className="class-link">Register <ArrowRight size={14} /></Link>}</div></article>;
}

function CreateClassModal({ close }: { close: () => void }) {
  const years = useListAcademicYears();
  const create = useCreateClass();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const current = years.data?.find((y) => y.isCurrent);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); const f = new FormData(e.currentTarget);
    create.mutate({ data: { name: String(f.get('name')).trim(), grade: String(f.get('grade')).trim(), stream: String(f.get('stream')).trim() || null, academicYearId: String(f.get('academicYearId')) } }, {
      onSuccess: () => { void client.invalidateQueries({ queryKey: getListClassesQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); close(); },
      onError: (err) => setError(apiMessage(err, 'We couldn’t create this class group. Check the details and try again.')),
    });
  }
  return <Modal title="Create a class group" subtitle="Add a learning group to a school year." close={close}>
    {years.isLoading ? <LoadingBlock label="Loading school years" /> : years.isError ? <ErrorState message={apiMessage(years.error, 'School years could not be loaded.')} retry={() => years.refetch()} /> : !years.data?.length ? <EmptyState title="Add a school year first" text="Class groups belong to an academic year. Create one in the school calendar." action={<Link href="/admin/calendar" className="button button-outline">Open calendar <ArrowRight size={15} /></Link>} /> :
    <form className="modal-form" onSubmit={submit}>
      <label className="field"><span>Class name <b>*</b></span><input name="name" required maxLength={100} placeholder="e.g. Grade 4 East" data-testid="input-class-name" /></label>
      <div className="form-row"><label className="field"><span>Grade <b>*</b></span><input name="grade" required maxLength={40} placeholder="e.g. Grade 4" data-testid="input-class-grade" /></label><label className="field"><span>Stream</span><input name="stream" maxLength={40} placeholder="e.g. East" /></label></div>
      <label className="field"><span>Academic year <b>*</b></span><select name="academicYearId" required defaultValue={current?.id ?? years.data[0].id} data-testid="select-class-year">{years.data.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ' (current)' : ''}</option>)}</select></label>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Button kind="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={create.isPending} testId="button-save-class">{create.isPending ? 'Creating…' : 'Create class group'}</Button></div>
    </form>}
  </Modal>;
}

function AssignTeacherModal({ group, close }: { group: ClassRecord; close: () => void }) {
  const members = useListMembers();
  const assign = useAssignTeacher();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [role, setRole] = useState<TeacherAssignmentInputAssignmentRole>('class_teacher');
  const teachers = (members.data ?? []).filter((m) => m.role === 'teacher' && m.status === 'active');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); const f = new FormData(e.currentTarget);
    assign.mutate({ classId: group.id, data: { teacherUserId: String(f.get('teacher')), assignmentRole: role, subject: role === 'subject_teacher' ? String(f.get('subject')).trim() || null : null } }, {
      onSuccess: () => { void client.invalidateQueries({ queryKey: getListClassesQueryKey() }); close(); },
      onError: (err) => setError(apiMessage(err, 'The teacher could not be assigned.')),
    });
  }
  return <Modal title={`Assign a teacher to ${group.name}`} subtitle="Assigned teachers can see this class’s learners and take its register." close={close}>
    {members.isLoading ? <LoadingBlock label="Loading teachers" /> : members.isError ? <ErrorState message={apiMessage(members.error, 'Teachers could not be loaded.')} retry={() => members.refetch()} /> : teachers.length === 0 ? <EmptyState icon={UserPlus} title="No teachers have joined yet" text="Invite teachers from the People page. They appear here once they accept." action={<Link href="/admin/people" className="button button-outline">Go to people <ArrowRight size={15} /></Link>} /> :
    <form className="modal-form" onSubmit={submit}>
      <label className="field"><span>Teacher <b>*</b></span><select name="teacher" required defaultValue="" data-testid="select-assign-teacher"><option value="" disabled>Choose a teacher</option>{teachers.map((t) => <option key={t.authUserId} value={t.authUserId}>{t.fullName || t.email || 'Teacher'}</option>)}</select></label>
      <div className="form-row"><label className="field"><span>Role <b>*</b></span><select value={role} onChange={(e) => setRole(e.target.value as TeacherAssignmentInputAssignmentRole)}><option value="class_teacher">Class teacher</option><option value="subject_teacher">Subject teacher</option></select></label>
        {role === 'subject_teacher' && <label className="field"><span>Subject <b>*</b></span><input name="subject" required maxLength={80} placeholder="e.g. Mathematics" /></label>}</div>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Button kind="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={assign.isPending} testId="button-save-assignment">{assign.isPending ? 'Assigning…' : 'Assign teacher'}</Button></div>
    </form>}
  </Modal>;
}
