import { BookOpen, ShieldCheck, UserRound } from 'lucide-react';
import { useListMyChildren, useGetMyLearnerRecord, useListPlatformSchools, type LearnerSummary } from '@workspace/api-client-react';
import { AppShell, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/shell';
import { apiMessage, apiStatus, formatDate } from '@/lib/api';

function LearnerCard({ learner }: { learner: LearnerSummary }) {
  const { attendance } = learner;
  const marked = attendance.present + attendance.absent + attendance.late + attendance.excused;
  return <section className="panel learner-card" data-testid={`card-learner-${learner.studentId}`}>
    <div className="year-head"><div><h2>{learner.firstName} {learner.lastName}</h2><p>Admission no. {learner.admissionNumber} · {learner.className || 'No class assigned'}</p></div><StatusBadge status={learner.status} /></div>
    <div className="modal-section-label">ATTENDANCE SINCE {formatDate(attendance.sinceDate).toUpperCase()}</div>
    {marked === 0 ? <p className="muted-note">No attendance has been recorded in this period yet.</p> : <>
      <dl className="record-facts attendance-facts">
        <div><dt>Present</dt><dd>{attendance.present}</dd></div><div><dt>Late</dt><dd>{attendance.late}</dd></div>
        <div><dt>Absent</dt><dd>{attendance.absent}</dd></div><div><dt>Excused</dt><dd>{attendance.excused}</dd></div>
      </dl>
      {attendance.recent.length > 0 && <ul className="term-list">{attendance.recent.map((day) => <li key={day.date}><span><b>{formatDate(day.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b></span><StatusBadge status={day.status} /></li>)}</ul>}
    </>}
  </section>;
}

export function FamilyPage() {
  const children = useListMyChildren();
  return <AppShell title="My children" portal="family"><main className="page">
    <PageHeader kicker="FAMILY PORTAL" title="My children" description="The learners your school has linked to your account." />
    {children.isLoading ? <LoadingBlock label="Loading your children’s records" /> : children.isError ? <ErrorState message={apiMessage(children.error, 'Your children’s records could not be loaded.')} retry={() => children.refetch()} />
      : !children.data?.length ? <EmptyState icon={UserRound} title="No learners linked yet" text="Your school links learners to your guardian record. Ask the school office if a child is missing." />
      : <div className="calendar-list">{children.data.map((child) => <LearnerCard key={child.studentId} learner={child} />)}</div>}
  </main></AppShell>;
}

export function LearnPage() {
  const record = useGetMyLearnerRecord({ query: { retry: (count, error) => apiStatus(error) !== 404 && count < 2 } });
  return <AppShell title="My record" portal="learn"><main className="page">
    <PageHeader kicker="LEARNER PORTAL" title="My record" description="Your class and attendance, as recorded by your school." />
    {record.isLoading ? <LoadingBlock label="Loading your record" />
      : apiStatus(record.error) === 404 ? <EmptyState icon={BookOpen} title="Your record isn’t linked yet" text="Your account is not connected to a learner record at this school. Ask the school office for help." />
      : record.isError || !record.data ? <ErrorState message={apiMessage(record.error, 'Your record could not be loaded.')} retry={() => record.refetch()} />
      : <LearnerCard learner={record.data} />}
  </main></AppShell>;
}

export function PlatformPage() {
  const schools = useListPlatformSchools();
  return <AppShell title="Schools" portal="platform"><main className="page">
    <PageHeader kicker="PLATFORM" title="Schools on Tushciemat" description="Every school workspace, with active members and learners. School records stay inside each school." />
    <section className="panel records-panel">
      {schools.isLoading ? <LoadingBlock label="Loading schools" /> : schools.isError ? <ErrorState message={apiMessage(schools.error, 'Schools could not be loaded.')} retry={() => schools.refetch()} />
        : !schools.data?.length ? <EmptyState icon={ShieldCheck} title="No schools yet" text="School workspaces appear here once someone creates one." />
        : <div className="table-wrap"><table className="data-table"><thead><tr><th>SCHOOL</th><th>CATEGORY</th><th>COUNTY</th><th>MEMBERS</th><th>LEARNERS</th><th>CREATED</th></tr></thead><tbody>
          {schools.data.map((s) => <tr key={s.id}><td><b>{s.name}</b></td><td>{s.category.replaceAll('_', ' ')}</td><td>{s.county || <span className="muted-cell">—</span>}</td><td>{s.activeMembers}</td><td>{s.activeStudents}</td><td>{formatDate(s.createdAt)}</td></tr>)}
        </tbody></table></div>}
    </section>
  </main></AppShell>;
}
