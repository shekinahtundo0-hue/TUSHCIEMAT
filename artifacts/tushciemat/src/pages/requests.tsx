import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Search } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getListJoinRequestsQueryKey, getListMembersQueryKey, getListMyJoinRequestsQueryKey,
  getListNotificationsQueryKey, getListStudentsQueryKey, useGetStudent, useListJoinRequests,
  useListMyJoinRequests, useListStudents, useReviewJoinRequest,
  type JoinRequest, type JoinRequestReview,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, StatusBadge } from '@/components/shell';
import { apiMessage, formatDate } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { JoinSteps, OnboardingLinks } from '@/pages/onboarding';

export function MyRequestsPage() {
  const requests = useListMyJoinRequests({ query: { refetchInterval: (query) => query.state.data?.some((r) => r.status === 'pending') ? 10_000 : false } });
  return <AppShell title="My requests" portal={null}><main className="page entry-page"><JoinSteps current={2} />
    <PageHeader kicker="YOUR SCHOOL ACCESS" title="My requests" description="Decisions come from the school. Pending requests refresh every 10 seconds while you are on this page." action={<Link href="/onboarding/find" className="button button-outline">Find another school</Link>} />
    {requests.isLoading ? <LoadingBlock label="Loading your access requests" /> : requests.isError ? <ErrorState message={apiMessage(requests.error, 'Your requests could not be loaded.')} retry={() => { void requests.refetch(); }} /> : !requests.data?.length ? <EmptyState icon={ClipboardCheck} title="No access requests yet" text="Find your school and send a request. If you already have an invitation, use the link your school shared." action={<Link href="/onboarding/find" className="button button-outline">Find my school</Link>} /> : <div className="request-list">{requests.data.map((request) => <MyRequestCard key={request.id} request={request} />)}</div>}
    <OnboardingLinks />
  </main></AppShell>;
}

function MyRequestCard({ request }: { request: JoinRequest }) {
  const { refreshMe, switchSchool } = useSession();
  const [, setLocation] = useLocation();
  const [error, setError] = useState(''); const [opening, setOpening] = useState(false);
  async function open() {
    setError(''); setOpening(true);
    try {
      const fresh = await refreshMe();
      const active = fresh?.schools.find((s) => s.schoolId === request.schoolId && s.roles.includes(request.requestedRole));
      if (!active) { setError('This request was approved, but you do not currently have active access for this role. Access may be suspended or removed. Ask the school administrator to check your membership.'); return; }
      switchSchool(request.schoolId); setLocation('/home');
    } catch (e) { setError(apiMessage(e, 'Your active membership could not be checked. Try again.')); }
    finally { setOpening(false); }
  }
  return <article className="panel request-card"><div className="section-with-action"><h2>{request.schoolName}</h2><StatusBadge status={request.status} /></div>
    <p className="muted-note">{ROLE_LABELS[request.requestedRole]} · Sent {formatDate(request.submittedAt)}</p>
    {request.status === 'pending' && <p className="request-message">Waiting for the school to review your details. No school access has been granted by this request.</p>}
    {request.status === 'approved' && <><p className="request-message">The school approved this request{request.reviewedAt ? ` on ${formatDate(request.reviewedAt)}` : ''}. Opening the portal checks that your membership is still active.</p><Button disabled={opening} onClick={() => { void open(); }}>{opening ? 'Checking access…' : 'Open portal'}</Button></>}
    {request.status === 'rejected' && <><p className="request-message">The school declined this request{request.reviewedAt ? ` on ${formatDate(request.reviewedAt)}` : ''}.</p><p className="review-reason"><b>School’s reason:</b> {request.rejectionReason || 'No reason returned.'}</p><div className="entry-links"><Link href={`/onboarding/join/${request.schoolId}`}>Review details and retry</Link><Link href="/onboarding/find">Find another school</Link></div></>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </article>;
}

const TABS = [
  { key: 'all', label: 'All Requests' }, { key: 'student', label: 'Students' },
  { key: 'teacher', label: 'Teachers' }, { key: 'school_admin', label: 'Administrators' },
  { key: 'parent', label: 'Parents' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' },
] as const;
type RequestTab = typeof TABS[number]['key'];

export function AccessRequestsPage() {
  const { school } = useSession();
  return <AppShell title="Membership & access requests" portal="admin"><main className="page">
    <PageHeader kicker="SCHOOL ACCESS" title="Membership & access requests" description="Verify each applicant before deciding. Learner and guardian access must be linked to a record held by this school." action={<Link href="/admin/people" className="button button-outline">Manage members</Link>} />
    {school && <SchoolRequestsPanel key={school.schoolId} />}
  </main></AppShell>;
}

function SchoolRequestsPanel() {
  const { me, school } = useSession();
  const requests = useListJoinRequests({ query: { enabled: !!school } });
  const [tab, setTab] = useState<RequestTab>('all'); const [selected, setSelected] = useState<JoinRequest | null>(null);
  const rows = requests.data?.filter((r) => tab === 'all' || r.requestedRole === tab || r.status === tab) ?? [];
  return <section className="panel records-panel">
    <div className="request-tabs" role="group" aria-label="Filter access requests">{TABS.map((t) => <button key={t.key} type="button" className={tab === t.key ? 'is-active' : ''} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>
    {requests.isLoading ? <LoadingBlock label="Loading school access requests" /> : requests.isError ? <ErrorState message={apiMessage(requests.error, 'Access requests could not be loaded.')} retry={() => { void requests.refetch(); }} /> : !rows.length ? <EmptyState icon={ClipboardCheck} title="No requests in this view" text="Access requests appear here when people ask to join this school. Choose All Requests to see other statuses and roles." /> : <div className="table-wrap"><table className="data-table requests-table"><thead><tr><th>APPLICANT</th><th>SCHOOL</th><th>REQUESTED ROLE</th><th>SENT</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><div className="student-cell"><span><b>{r.applicantName}{r.authUserId === me.authUserId ? ' (you)' : ''}</b><small>{r.applicantEmail}</small></span></div></td><td>{r.schoolName}</td><td>{ROLE_LABELS[r.requestedRole]}</td><td>{formatDate(r.submittedAt)}</td><td><StatusBadge status={r.status} /></td><td><button type="button" className="text-button" onClick={() => setSelected(r)}>View details{r.status === 'pending' && r.authUserId !== me.authUserId ? ' / review' : ''}</button></td></tr>)}</tbody></table></div>}
    {selected && <ReviewRequestModal key={selected.id} request={selected} close={() => setSelected(null)} />}
  </section>;
}

const DETAIL_LABELS: Record<string, string> = {
  fullName: 'Declared name', admissionNumber: 'Admission number', programme: 'Programme / course', academicYear: 'Academic year',
  staffNumber: 'Staff number', department: 'Department', subjects: 'Declared subjects', classes: 'Declared classes',
  position: 'Position', reason: 'Reason / details', relationship: 'Relationship',
};

function ReviewRequestModal({ request, close }: { request: JoinRequest; close: () => void }) {
  const { me } = useSession();
  const client = useQueryClient(); const review = useReviewJoinRequest();
  const [result, setResult] = useState<JoinRequest>(request);
  const [error, setError] = useState(''); const [reason, setReason] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const [studentId, setStudentId] = useState(''); const [guardianId, setGuardianId] = useState('');
  const pending = result.status === 'pending'; const self = request.authUserId === me.authUserId;
  const isStudent = request.requestedRole === 'student'; const isParent = request.requestedRole === 'parent';
  const needsLink = isStudent || isParent;
  const students = useListStudents({ search: search.trim(), page, pageSize: 20 }, { query: { enabled: pending && !self && needsLink } });
  const eligibleStudents = students.data?.items.filter((s) => !isStudent || (s.status === 'active' && !s.hasAccount)) ?? [];
  const selectedStudent = eligibleStudents.find((s) => s.id === studentId);
  const detail = useGetStudent(studentId, { query: { enabled: pending && !self && isParent && !!selectedStudent } });
  const email = request.applicantEmail.trim().toLowerCase();
  const guardians = detail.data?.guardians?.filter((g) => !g.hasAccount && !!g.email && g.email.trim().toLowerCase() === email) ?? [];
  const selectedGuardian = guardians.find((g) => g.guardianId === guardianId);
  const linkReady = !needsLink || (isStudent ? !!selectedStudent && !students.isFetching && !students.isError : !!selectedStudent && !!selectedGuardian && !students.isFetching && !students.isError && !detail.isFetching && !detail.isError);
  async function decide(decision: JoinRequestReview['decision']) {
    setError('');
    if (!pending || self) return;
    if (decision === 'approved' && (!confirmed || !linkReady)) { setError('Verify the applicant and explicitly select the required school record before approving.'); return; }
    if (decision === 'rejected' && reason.trim().length < 3) { setError('Give a rejection reason of at least 3 characters.'); return; }
    try {
      const updated = await review.mutateAsync({ requestId: request.id, data: {
        decision, ...(decision === 'rejected' ? { reason: reason.trim() } : {}),
        ...(decision === 'approved' && isStudent ? { studentId } : {}),
        ...(decision === 'approved' && isParent ? { guardianId } : {}),
      } });
      setResult(updated);
      await Promise.all([
        client.invalidateQueries({ queryKey: getListJoinRequestsQueryKey() }),
        client.invalidateQueries({ queryKey: getListMyJoinRequestsQueryKey() }),
        client.invalidateQueries({ queryKey: getListMembersQueryKey() }),
        client.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
        client.invalidateQueries({ queryKey: getListStudentsQueryKey() }),
      ]);
    } catch (e) { setError(apiMessage(e, 'The review could not be saved. Your selections are preserved.')); }
  }
  return <Modal title={request.applicantName} subtitle={`${request.applicantEmail} · ${ROLE_LABELS[request.requestedRole]} · ${request.schoolName}`} kicker="ACCESS REQUEST" close={close} wide>
    <div className="record-sections"><section><div className="section-with-action"><p className="muted-note">Sent {formatDate(request.submittedAt)}</p><StatusBadge status={result.status} /></div><dl className="record-facts">{Object.entries(request.applicantDetails).map(([key, value]) => <div key={key}><dt>{DETAIL_LABELS[key] || key}</dt><dd>{value}</dd></div>)}</dl><p className="muted-note">These are applicant declarations, not proof of identity or automatic record matches. Subject and class declarations grant no assignments.</p></section>
      {self && pending && <p className="form-error">You cannot review your own request. Another school owner or administrator must review it; the server also enforces this.</p>}
      {pending && !self && <>
        {needsLink && <section className="nested-form modal-form"><h3>{isStudent ? 'Select the learner record to link' : 'Find a learner, then select their guardian'}</h3><p className="muted-note">{isStudent ? 'Choose an existing, active learner with no linked account. Admission numbers never auto-select a record.' : 'Choose a learner to inspect this school’s guardian records. Only an unlinked guardian whose email matches the applicant can be selected.'}</p>
          <label className="field"><span>Search this school’s students</span><div className="search-field"><Search size={14} /><input value={search} maxLength={100} onChange={(e) => { setSearch(e.target.value); setPage(1); setStudentId(''); setGuardianId(''); setConfirmed(false); }} placeholder="Name or admission number" /></div></label>
          {students.isLoading ? <LoadingBlock label="Loading student records" /> : students.isError ? <ErrorState message={apiMessage(students.error, 'School records could not be loaded.')} retry={() => { void students.refetch(); }} /> : <>
            <label className="field"><span>{isStudent ? 'Unlinked active learner' : 'Student record'} <b>*</b></span><select value={studentId} onChange={(e) => { setStudentId(e.target.value); setGuardianId(''); setConfirmed(false); }} disabled={students.isFetching}><option value="">Select a record explicitly</option>{eligibleStudents.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} · {s.admissionNumber}{s.className ? ` · ${s.className}` : ''}</option>)}</select></label>
            {!eligibleStudents.length && <p className="muted-note">No eligible records on this page. Try another search or page.</p>}
            {(students.data?.total ?? 0) > 20 && <div className="entry-pagination"><Button kind="quiet" disabled={page === 1 || students.isFetching} onClick={() => { setPage((p) => p - 1); setStudentId(''); setGuardianId(''); setConfirmed(false); }}>Previous</Button><span>Page {page}</span><Button kind="quiet" disabled={page * 20 >= (students.data?.total ?? 0) || students.isFetching} onClick={() => { setPage((p) => p + 1); setStudentId(''); setGuardianId(''); setConfirmed(false); }}>Next</Button></div>}
          </>}
          <p className="muted-note">Missing a record? <Link href="/admin/students" className="text-button">Go to Students</Link> to create the learner{isParent ? ' and add a guardian with the applicant’s verified email' : ''}, then return and retry this review.</p>
          {isParent && selectedStudent && (detail.isLoading ? <LoadingBlock label="Loading guardians for this learner" /> : detail.isError ? <ErrorState message={apiMessage(detail.error, 'Guardian records could not be loaded.')} retry={() => { void detail.refetch(); }} /> : <><label className="field"><span>Unlinked guardian matching {request.applicantEmail} <b>*</b></span><select value={guardianId} onChange={(e) => { setGuardianId(e.target.value); setConfirmed(false); }} disabled={detail.isFetching}><option value="">Select a guardian explicitly</option>{guardians.map((g) => <option key={g.guardianId} value={g.guardianId}>{g.fullName} · {g.relationship} · {g.email}</option>)}</select></label>{!guardians.length && <p className="muted-note">No unlinked guardian with a matching email was returned for this learner. Check the verified school record in Students; a name or admission claim is not enough.</p>}</>)}
        </section>}
        {!needsLink && <p className="muted-note">This approves only the requested {ROLE_LABELS[request.requestedRole].toLowerCase()} membership. It does not link learner records or assign subjects or classes.</p>}
        <label className="check-field"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>I have verified the applicant’s details, account and requested role{needsLink ? ', and the record selected above' : ''}.</span></label>
        <div className="modal-actions"><Button disabled={review.isPending || !confirmed || !linkReady} onClick={() => { void decide('approved'); }}>{review.isPending ? 'Saving decision…' : 'Approve request'}</Button></div>
        <section className="nested-form modal-form"><label className="field"><span>Rejection reason · required to reject</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} rows={3} placeholder="Explain what the applicant should correct or who to contact." /></label><div className="modal-actions"><Button kind="outline" disabled={review.isPending || reason.trim().length < 3} onClick={() => { void decide('rejected'); }}>Reject request</Button></div></section>
      </>}
      {!pending && <section><p className="muted-note">Reviewed{result.reviewedAt ? ` on ${formatDate(result.reviewedAt)}` : ''}. The status above is the decision returned by the school server.</p>{result.rejectionReason && <p className="review-reason"><b>Reason:</b> {result.rejectionReason}</p>}</section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button kind="quiet" onClick={close}>Close</Button></div>
    </div>
  </Modal>;
}
