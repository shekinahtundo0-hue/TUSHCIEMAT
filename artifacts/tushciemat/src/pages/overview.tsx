import { ArrowRight, BookOpen, CalendarDays, ClipboardCheck, GraduationCap, Settings2, ShieldCheck, Sparkles, UserPlus, Users } from 'lucide-react';
import { Link } from 'wouter';
import { useGetDashboard, useHealthCheck } from '@workspace/api-client-react';
import { AppShell, ErrorState, LoadingBlock, Metric } from '@/components/shell';
import { apiMessage } from '@/lib/api';
import { MANAGERS, hasAny } from '@/lib/roles';
import { useSession } from '@/lib/session';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function OverviewPage() {
  const { school, roles } = useSession();
  const { data: summary, isLoading, isError, error, refetch } = useGetDashboard();
  const health = useHealthCheck({ query: { retry: false } });
  const rate = summary?.attendanceRate ?? null;
  return <AppShell title="Overview" portal="admin"><main className="page">
    <div className="dashboard-welcome"><div><p className="eyebrow">YOUR SCHOOL, TODAY</p><h1>{greeting()}<span className="period">.</span></h1><p className="welcome-sub">A clear view of {summary?.school.name || school?.schoolName} and the day ahead.</p></div><div className="date-block"><CalendarDays size={16} /><span>{new Intl.DateTimeFormat('en-KE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span></div></div>
    {isLoading ? <LoadingBlock /> : isError || !summary ? <ErrorState message={apiMessage(error, 'Your school overview is temporarily unavailable.')} retry={() => refetch()} /> : <>
      {!summary.currentTerm && <div className="onboarding-banner"><div className="banner-icon"><Sparkles size={18} /></div><div><b>{summary.currentYear ? `${summary.currentYear} has no current term yet.` : 'No academic year is marked as current.'}</b><p>Set up the school calendar so classes and registers line up with the term.</p></div><Link href="/admin/calendar" className="banner-link">Open calendar <ArrowRight size={15} /></Link></div>}
      <div className="metrics-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric title="Total students" value={summary.totalStudents} icon={Users} detail="Active learner records" tone="mint" />
        <Metric title="Class groups" value={summary.totalClasses} icon={BookOpen} detail={summary.currentYear ? `In ${summary.currentYear}` : 'Across your school'} tone="sand" />
        <Metric title="Teachers" value={summary.totalTeachers} icon={GraduationCap} detail="Active teaching accounts" tone="blue" />
        <Metric title="Attendance today" value={rate} suffix="%" icon={ClipboardCheck} detail={summary.markedToday ? `${summary.presentToday} present · ${summary.absentToday} absent` : 'No register taken yet today'} tone="gold" />
      </div>
      <div className="dashboard-columns"><section className="panel attendance-panel"><div className="panel-heading"><div><p className="eyebrow">A DAILY PULSE</p><h2>Attendance, today</h2></div><span className="panel-date"><CalendarDays size={14} /> {new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' }).format(new Date())}</span></div>
        <div className="attendance-visual"><div className="attendance-ring" style={{ '--rate': `${Math.max(0, Math.min(rate ?? 0, 100))}%` } as React.CSSProperties}><div><b>{rate === null ? '—' : `${rate}%`}</b><small>{rate === null ? 'not taken' : 'present'}</small></div></div><div className="attendance-legend"><div><i className="legend-present" /><span>Present</span><b>{summary.presentToday}</b></div><div><i className="legend-absent" /><span>Absent</span><b>{summary.absentToday}</b></div><div><i className="legend-other" /><span>Marked</span><b>{summary.markedToday}</b></div></div></div>
        <Link href="/admin/attendance" className="panel-link">Open class register <ArrowRight size={15} /></Link>
      </section>
      <section className="panel quick-panel"><div className="panel-heading"><div><p className="eyebrow">KEEP THINGS MOVING</p><h2>Quick actions</h2></div><Settings2 size={17} className="panel-muted-icon" /></div><div className="quick-list">
        <Link href="/admin/students" className="quick-item"><span className="quick-icon quick-mint"><Users size={17} /></span><span><b>Register a student</b><small>Add a learner to your school</small></span><ArrowRight size={15} /></Link>
        <Link href="/admin/classes" className="quick-item"><span className="quick-icon quick-sand"><BookOpen size={17} /></span><span><b>Create a class group</b><small>Set up your learning groups</small></span><ArrowRight size={15} /></Link>
        {hasAny(roles, MANAGERS) && <Link href="/admin/people" className="quick-item"><span className="quick-icon quick-gold"><UserPlus size={17} /></span><span><b>Invite your team</b><small>Give staff their own access</small></span><ArrowRight size={15} /></Link>}
      </div><div className="health-indicator"><span className={health.data ? 'health-dot good' : 'health-dot'} />{health.isLoading ? 'Checking workspace connection' : health.data ? 'Workspace connection is healthy' : 'Connection status unavailable'}</div></section></div>
      <section className="dashboard-footnote"><div className="footnote-mark"><ShieldCheck size={18} /></div><div><b>Your school, your information.</b><p>School records are available according to each person’s role and access.</p></div><span className="footnote-label">SECURE SCHOOL WORKSPACE</span></section>
    </>}
  </main></AppShell>;
}
