import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowRight, ArrowUpRight, Bell, BookOpen, CalendarDays,
  Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck,
  GraduationCap, LayoutDashboard, LoaderCircle, LockKeyhole, LogOut, Menu,
  MoreHorizontal, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Users, X, School as SchoolIcon, UserRound, UserPlus, AlertTriangle, RefreshCw,
} from 'lucide-react';
import {
  getGetDashboardQueryKey, getGetSchoolContextQueryKey, getListAttendanceQueryKey,
  getListClassesQueryKey, getListStudentsQueryKey, useCreateClass, useCreateSchool,
  useCreateStudent, useGetDashboard, useGetSchoolContext, useHealthCheck,
  useListAttendance, useListClasses, useListStudents, useSaveAttendance, useUpdateStudent,
} from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import type { AttendanceRecord, ClassRecord, Student } from '@workspace/api-client-react';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#245b4d', colorForeground: '#173b33', colorMutedForeground: '#63766f',
    colorDanger: '#a23d34', colorBackground: '#fbfaf5', colorInput: '#fffefb',
    colorInputForeground: '#173b33', colorNeutral: '#173b33', fontFamily: 'DM Sans',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#dce3da]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#173b33] font-semibold tracking-tight',
    headerSubtitle: 'text-[#63766f]',
    socialButtonsBlockButtonText: 'text-[#173b33] font-medium',
    formFieldLabel: 'text-[#244c41] font-medium',
    footerActionLink: 'text-[#245b4d] font-semibold',
    footerActionText: 'text-[#63766f]',
    dividerText: 'text-[#74827b]',
    identityPreviewEditButton: 'text-[#245b4d]',
    formFieldSuccessText: 'text-[#287159]',
    alertText: 'text-[#863b34]',
    logoBox: 'mb-4',
    logoImage: 'max-h-10',
    socialButtonsBlockButton: 'border-[#dce3da] bg-[#fffefb] hover:bg-[#f1f4ed]',
    formButtonPrimary: 'bg-[#245b4d] hover:bg-[#1b493e] text-white shadow-none',
    formFieldInput: 'border-[#dce3da] bg-[#fffefb] text-[#173b33]',
    footerAction: 'text-[#63766f]',
    dividerLine: 'bg-[#dce3da]',
    alert: 'bg-[#fbefeb] border-[#edd2cb]',
    otpCodeFieldInput: 'border-[#dce3da] bg-[#fffefb]',
    formFieldRow: 'gap-2',
    main: 'gap-5',
  },
};

function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className={`brand ${light ? 'brand-light' : ''}`} data-testid="link-brand">
    <span className="brand-mark"><SchoolIcon size={19} strokeWidth={2.3} /></span>
    <span>Tushciemat<span className="brand-dot">.</span></span>
  </Link>;
}

function Button({ children, onClick, kind = 'primary', type = 'button', disabled = false, testId }: {
  children: ReactNode; onClick?: () => void; kind?: 'primary' | 'outline' | 'quiet' | 'gold'; type?: 'button' | 'submit'; disabled?: boolean; testId?: string;
}) {
  return <button className={`button button-${kind}`} onClick={onClick} type={type} disabled={disabled} data-testid={testId}>{children}</button>;
}

function ClerkCacheListener() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const id = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== id) client.clear();
    previous.current = id;
  }), [addListener, client]);
  return null;
}

function ClerkRouter() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={appearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Welcome back', subtitle: 'Your school day, in one clear place.' } },
      signUp: { start: { title: 'Create your Tushciemat account', subtitle: 'A better-organised school starts here.' } },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkCacheListener />
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/onboarding"><AuthGate><OnboardingPage /></AuthGate></Route>
        <Route path="/dashboard"><AuthGate><DashboardPage /></AuthGate></Route>
        <Route path="/students"><AuthGate><StudentsPage /></AuthGate></Route>
        <Route path="/classes"><AuthGate><ClassesPage /></AuthGate></Route>
        <Route path="/attendance"><AuthGate><AttendancePage /></AuthGate></Route>
        <Route path="/portal/parent"><AuthGate><PortalPage role="parent" /></AuthGate></Route>
        <Route path="/portal/student"><AuthGate><PortalPage role="student" /></AuthGate></Route>
        <Route path="/portal/teacher"><AuthGate><PortalPage role="teacher" /></AuthGate></Route>
        <Route path="/portal/tutor"><AuthGate><PortalPage role="tutor" /></AuthGate></Route>
        <Route path="/platform-admin"><AuthGate><PlatformAdminPage /></AuthGate></Route>
        <Route component={NotFound} />
      </Switch>
    </QueryClientProvider>
  </ClerkProvider>;
}

function SignInPage() {
  return <AuthBackdrop><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthBackdrop>;
}
function SignUpPage() {
  return <AuthBackdrop><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthBackdrop>;
}
function AuthBackdrop({ children }: { children: ReactNode }) {
  return <main className="auth-backdrop"><div className="auth-brand"><Brand /></div><div className="auth-aside">
    <div className="auth-aside-inner"><p className="eyebrow">BUILT FOR KENYAN SCHOOLS</p><h1>Good systems<br />make room for<br /><em>good teaching.</em></h1>
      <p>Keep the school day moving, from the first bell to the last lesson.</p><div className="auth-seal"><ShieldCheck size={17} /> Private by design · School-led access</div></div>
  </div><div className="auth-card-wrap">{children}</div></main>;
}

function HomeRedirect() {
  const { isSignedIn, isLoaded } = useUser();
  if (!isLoaded) return <LandingSkeleton />;
  return isSignedIn ? <Redirect to="/dashboard" /> : <LandingPage />;
}
function LandingSkeleton() { return <div className="landing-skeleton"><div className="skel skel-nav" /><div className="skel skel-hero" /><div className="skel skel-block" /></div>; }

function LandingPage() {
  const [menu, setMenu] = useState(false);
  return <div className="landing">
    <header className="landing-nav"><Brand /><nav className={menu ? 'landing-links open' : 'landing-links'}>
      <a href="#platform" onClick={() => setMenu(false)}>Platform</a><a href="#roles" onClick={() => setMenu(false)}>For your school</a><a href="#principles" onClick={() => setMenu(false)}>Our approach</a>
      <Link href="/sign-in" className="mobile-signin">Sign in</Link>
    </nav><div className="nav-actions"><Link href="/sign-in" className="nav-login">Sign in</Link><Link href="/sign-up" className="button button-primary">Get started <ArrowRight size={15} /></Link></div>
      <button className="menu-toggle" onClick={() => setMenu(!menu)} aria-label="Toggle menu"><Menu size={21} /></button>
    </header>
    <main>
      <section className="landing-hero">
        <div className="hero-copy"><div className="hero-kicker"><span className="live-dot" /> SCHOOL OPERATIONS, MADE CLEAR</div>
          <h1>More time<br />for <span>the learning.</span></h1>
          <p className="hero-intro">The everyday work of running a school, brought into one steady, secure workspace.</p>
          <div className="hero-actions"><Link href="/sign-up" className="button button-primary">Create your school workspace <ArrowRight size={16} /></Link><Link href="/sign-in" className="hero-text-link">Already have an account <ArrowRight size={15} /></Link></div>
          <div className="hero-trust"><div className="trust-avatars"><span>O</span><span>T</span><span>P</span></div><p>Made for the people<br />who make schools work.</p></div>
        </div>
        <div className="hero-art" aria-label="Illustrated school operations workspace">
          <div className="art-sun" /><div className="art-grid" />
          <div className="dashboard-preview">
            <div className="preview-top"><div className="preview-brand"><span className="mini-mark"><SchoolIcon size={13} /></span><span>Tushciemat</span></div><span className="preview-date">YOUR SCHOOL DAY</span></div>
            <div className="preview-greeting"><small>GOOD MORNING</small><strong>Your school, at a glance.</strong></div>
            <div className="preview-tiles"><div className="preview-tile"><span>STUDENTS</span><b>•••</b><i><Users size={13} /></i></div><div className="preview-tile"><span>ATTENDANCE</span><b>•••</b><i><ClipboardCheck size={13} /></i></div></div>
            <div className="preview-register"><div className="register-head"><span>Today’s register</span><span className="register-tag">LIVE DATA</span></div><div className="register-line"><i className="line-dot green" /><span>Class register</span><b>Ready when you are</b></div><div className="register-line"><i className="line-dot yellow" /><span>School overview</span><b>One clear view</b></div></div>
            <div className="preview-footer"><span><LockKeyhole size={12} /> School data stays yours</span><span className="preview-spark">T.</span></div>
          </div>
          <div className="floating-note note-attendance"><span className="note-icon"><Check size={15} /></span><span><b>Class register</b><small>Mark it as you go</small></span></div>
          <div className="floating-note note-local"><span className="sun-symbol"><SchoolIcon size={16} /></span><span><b>Designed for here</b><small>Kenyan school rhythms</small></span></div>
        </div>
        <div className="hero-caption"><span>01 — THE SCHOOL DAY, IN SYNC</span><span>NAIROBI · KENYA</span></div>
      </section>
      <section className="proof-strip"><span>ONE SCHOOL WORKSPACE</span><div className="proof-rule" /><span>OPERATIONS THAT FEEL LIGHTER</span><div className="proof-rule" /><span>BUILT AROUND PEOPLE</span></section>
      <section id="platform" className="platform-section">
        <div className="section-heading"><div><p className="eyebrow">THE DAILY WORK, TOGETHER</p><h2>Less chasing.<br /><em>More clarity.</em></h2></div><p className="section-lede">School work touches many people. Tushciemat gives each one a clear place to do their part, without losing sight of the whole.</p></div>
        <div className="platform-layout"><div className="platform-feature"><div className="feature-index">01 / OPERATIONS</div><div className="feature-illustration"><div className="feature-paper"><span className="paper-line long" /><span className="paper-line medium" /><span className="paper-line short" /><span className="paper-check"><Check size={14} /></span></div><div className="feature-stamp">IN<br />ORDER</div></div><h3>A calmer way to run the day.</h3><p>Keep essential school records and routines organised, so teams spend less time searching and more time supporting learners.</p><Link href="/sign-up" className="under-link">Set up your workspace <ArrowRight size={15} /></Link></div>
          <div className="feature-side"><article><span className="feature-number">02</span><div><h3>Information where it belongs.</h3><p>School data is organised around the people and tasks that need it, with access shaped by role.</p></div><div className="side-graphic role-graphic"><span>OWNER</span><span>TEACHER</span><span>PARENT</span></div></article>
            <article><span className="feature-number">03</span><div><h3>A better view of today.</h3><p>Understand what’s happening across your school without making another round of calls.</p></div><div className="side-graphic pulse-graphic"><Activity size={17} /><span>Live school view</span><i /></div></article></div></div>
      </section>
      <section id="roles" className="roles-section"><div className="roles-heading"><p className="eyebrow">A PLACE FOR EVERY SCHOOL ROLE</p><h2>One school.<br /><em>Many perspectives.</em></h2><p>Purposeful access for the people who keep learning moving.</p></div><div className="role-list">
        {[['01','School owners & administrators','A dependable view of operations, people and the everyday details.','Owners · Admins'],['02','Teachers','A clear path to class groups and the routines around them.','Teachers'],['03','Parents & guardians','A dedicated place for the school connection to grow.','Parents'],['04','Learners & tutors','A role-aware entry point for learning support.','Learners · Tutors']].map((r) => <div className="role-row" key={r[0]}><span className="role-index">{r[0]}</span><div><h3>{r[1]}</h3><p>{r[2]}</p></div><span className="role-meta">{r[3]}</span><ArrowUpRight size={18} /></div>)}
      </div></section>
      <section id="principles" className="principles-section"><div className="principle-copy"><p className="eyebrow">SIMPLE, SECURE, SCHOOL-LED</p><h2>Clarity is a kind<br />of <em>care.</em></h2><p>Good school systems should be felt in the time they give back, the details they keep in order and the confidence they create.</p><Link href="/sign-up" className="button button-gold">Bring your school in <ArrowRight size={16} /></Link></div><div className="principle-card"><span className="card-ornament">T</span><div className="principle-quote">“The right information.<br />With the right people.<br /><em>At the right time.</em>”</div><div className="principle-foot"><span>THE TUSHCIEMAT PRINCIPLE</span><ShieldCheck size={17} /></div></div></section>
      <section className="landing-cta"><p className="eyebrow">A GOOD PLACE TO BEGIN</p><h2>Make the school day<br /><em>work better.</em></h2><p>Start with a school workspace that feels ready for real life.</p><Link href="/sign-up" className="button button-primary">Create your school workspace <ArrowRight size={16} /></Link><span className="cta-mark">T.</span></section>
    </main>
    <footer className="landing-footer"><Brand /><span>School operations and learning tools, with people at the centre.</span><span>© Tushciemat</span></footer>
  </div>;
}

function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <AppLoading />;
  return isSignedIn ? <>{children}</> : <Redirect to="/" />;
}

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/students', label: 'Students', icon: Users },
  { href: '/classes', label: 'Classes', icon: BookOpen },
  { href: '/attendance', label: 'Attendance', icon: ClipboardCheck },
];
function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const [loc] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: context } = useGetSchoolContext();
  const activeMembership = context?.memberships?.find((membership) => membership.status === 'active');
  const portalRoles = new Set(context?.memberships?.filter((membership) => membership.status === 'active').map((membership) => membership.role) || []);
  const initial = (user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0] || 'T').toUpperCase();
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand light /><button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <div className="school-switcher"><span className="school-avatar"><SchoolIcon size={17} /></span><span className="switcher-text"><small>YOUR SCHOOL</small><b>{activeMembership?.schoolName || 'School workspace'}</b></span></div>
      <div className="nav-label">WORKSPACE</div><nav className="side-nav">{navItems.map((item) => {
        const Icon = item.icon; const active = loc === item.href;
        return <Link key={item.href} href={item.href} className={`side-link ${active ? 'is-active' : ''}`} onClick={() => setMobileOpen(false)} data-testid={`nav-${item.label.toLowerCase()}`}><Icon size={17} /><span>{item.label}</span>{active && <i />}</Link>;
      })}</nav>
      {(['parent','student','teacher','tutor'] as const).some((role) => portalRoles.has(role)) && <>
        <div className="nav-label portal-label">YOUR PORTAL</div><nav className="side-nav portal-nav">
          {([['parent','/portal/parent','Parent'],['student','/portal/student','Learner'],['teacher','/portal/teacher','Teacher'],['tutor','/portal/tutor','Tutor']] as const).filter(([role]) => portalRoles.has(role)).map(([role,href,label]) => <Link key={role} href={href} className={`side-link ${loc === href ? 'is-active' : ''}`} onClick={() => setMobileOpen(false)}><UserRound size={16} /><span>{label}</span></Link>)}
        </nav>
      </>}
      <div className="sidebar-bottom"><div className="help-card"><div className="help-top"><CircleHelp size={15} /><span>Here to help</span></div><p>Ask your school administrator for help with access.</p></div>
        <button className="account-row" onClick={() => signOut({ redirectUrl: basePath || '/' })}><span className="account-avatar">{initial}</span><span className="account-name"><b>{user?.fullName || 'Your account'}</b><small>{activeMembership?.role?.replace('_', ' ') || user?.primaryEmailAddress?.emailAddress || 'School member'}</small></span><LogOut size={16} /></button>
      </div>
    </aside>
    {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
    <div className="workspace"><header className="topbar"><button className="mobile-nav-toggle" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="crumb"><span>Workspace</span><ChevronRight size={14} /> <b>{title || 'School overview'}</b></div><div className="topbar-right"><span className="day-chip"><span className="live-dot" /> SCHOOL DAY</span><button className="icon-button" aria-label="Notifications" onClick={() => setNotificationsOpen(!notificationsOpen)} aria-expanded={notificationsOpen}><Bell size={18} /></button><span className="top-avatar">{initial}</span>{notificationsOpen && <div className="notification-popover"><div className="notification-head"><b>Notifications</b><button onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X size={14} /></button></div><div className="notification-empty"><CheckCircle2 size={18} /><span>You’re all caught up.</span><small>School updates will appear here when available.</small></div></div>}</div></header><div className="workspace-body">{children}</div></div>
  </div>;
}

function PageHeader({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</div>;
}
function LoadingBlock({ label = 'Loading school data' }: { label?: string }) {
  return <div className="loading-block" role="status"><div className="skeleton-row"><span className="skel skel-big" /><span className="skel skel-small" /></div><div className="skeleton-grid"><span className="skel" /><span className="skel" /><span className="skel" /></div><p><LoaderCircle size={14} className="subtle-spin" /> {label}</p></div>;
}
function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className="state-card error-state"><span className="state-icon error-icon"><AlertTriangle size={20} /></span><h3>We couldn’t load this just now</h3><p>{message || 'Please check your connection and try again.'}</p><Button kind="outline" onClick={retry}><RefreshCw size={15} /> Try again</Button></div>;
}
function EmptyState({ icon: Icon = SchoolIcon, title, text, action }: { icon?: typeof SchoolIcon; title: string; text: string; action?: ReactNode }) {
  return <div className="state-card empty-state"><span className="state-icon"><Icon size={20} /></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function AppLoading() { return <div className="global-loading"><div className="loading-logo"><SchoolIcon size={22} /></div><LoadingBlock label="Preparing your workspace" /></div>; }

function DashboardPage() {
  const { data: summary, isLoading, isError, refetch } = useGetDashboard();
  const { data: context } = useGetSchoolContext();
  const health = useHealthCheck({ query: { retry: false } });
  const schoolName = summary?.school?.name || context?.memberships?.find((m) => m.status === 'active')?.schoolName || 'Your school';
  return <AppShell title="Overview"><main className="page">
    <div className="dashboard-welcome"><div><p className="eyebrow"><span className="live-dot" /> YOUR SCHOOL, TODAY</p><h1>Good morning<span className="period">.</span></h1><p className="welcome-sub">A clear view of {schoolName} and the day ahead.</p></div><div className="date-block"><CalendarDays size={16} /><span>{new Intl.DateTimeFormat('en-KE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span></div></div>
    {isLoading ? <LoadingBlock /> : isError || !summary ? <ErrorState message="Your school overview is temporarily unavailable." retry={() => refetch()} /> : <>
      {!summary.school && <div className="onboarding-banner"><div className="banner-icon"><Sparkles size={18} /></div><div><b>Your workspace is ready for its first school.</b><p>Add your school details to begin organising your operations.</p></div><Link href="/onboarding" className="banner-link">Create school <ArrowRight size={15} /></Link></div>}
      <div className="metrics-grid">
        <Metric title="Total students" value={summary.totalStudents} icon={Users} detail="Enrolled in your school" tone="mint" />
        <Metric title="Class groups" value={summary.totalClasses} icon={BookOpen} detail="Across your school" tone="sand" />
        <Metric title="Teachers" value={summary.totalTeachers} icon={GraduationCap} detail="Teaching team" tone="blue" />
        <Metric title="Attendance today" value={summary.attendanceRate} suffix="%" icon={ClipboardCheck} detail={`${summary.presentToday} present · ${summary.absentToday} absent`} tone="gold" />
      </div>
      <div className="dashboard-columns"><section className="panel attendance-panel"><div className="panel-heading"><div><p className="eyebrow">A DAILY PULSE</p><h2>Attendance, today</h2></div><span className="panel-date"><CalendarDays size={14} /> {new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' }).format(new Date())}</span></div>
        <div className="attendance-visual"><div className="attendance-ring" style={{ '--rate': `${Math.max(0, Math.min(Number(summary.attendanceRate) || 0, 100))}%` } as React.CSSProperties}><div><b>{summary.attendanceRate}%</b><small>present</small></div></div><div className="attendance-legend"><div><i className="legend-present" /><span>Present</span><b>{summary.presentToday}</b></div><div><i className="legend-absent" /><span>Absent</span><b>{summary.absentToday}</b></div></div></div>
        <Link href="/attendance" className="panel-link">Open class register <ArrowRight size={15} /></Link>
      </section>
      <section className="panel quick-panel"><div className="panel-heading"><div><p className="eyebrow">KEEP THINGS MOVING</p><h2>Quick actions</h2></div><Settings2 size={17} className="panel-muted-icon" /></div><div className="quick-list"><Link href="/students" className="quick-item"><span className="quick-icon quick-mint"><UserPlus size={17} /></span><span><b>Register a student</b><small>Add a learner to your school</small></span><ArrowRight size={15} /></Link><Link href="/classes" className="quick-item"><span className="quick-icon quick-sand"><BookOpen size={17} /></span><span><b>Create a class group</b><small>Set up your learning groups</small></span><ArrowRight size={15} /></Link><Link href="/attendance" className="quick-item"><span className="quick-icon quick-gold"><ClipboardCheck size={17} /></span><span><b>Take attendance</b><small>Open today’s class register</small></span><ArrowRight size={15} /></Link></div><div className="health-indicator"><span className={health.data ? 'health-dot good' : 'health-dot'} />{health.isLoading ? 'Checking workspace connection' : health.data ? 'Workspace connection is healthy' : 'Connection status unavailable'}</div></section></div>
      <section className="dashboard-footnote"><div className="footnote-mark"><ShieldCheck size={18} /></div><div><b>Your school, your information.</b><p>School records are available according to your role and access.</p></div><span className="footnote-label">SECURE SCHOOL WORKSPACE</span></section>
    </>}
  </main></AppShell>;
}

function Metric({ title, value, suffix = '', icon: Icon, detail, tone }: { title: string; value: number; suffix?: string; icon: typeof Users; detail: string; tone: string }) {
  return <article className="metric-card" data-testid={`metric-${title.toLowerCase().replaceAll(' ', '-')}`}><div className="metric-top"><span>{title}</span><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div><div className="metric-value">{value}<small>{suffix}</small></div><p>{detail}</p></article>;
}

function OnboardingPage() {
  const [, setLocation] = useLocation();
  const create = useCreateSchool();
  const client = useQueryClient();
  const [formError, setFormError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError('');
    const data = new FormData(event.currentTarget);
      create.mutate({ data: { name: String(data.get('name')).trim(), category: String(data.get('category')) as 'primary' | 'secondary' | 'mixed' | 'tertiary' | 'other', curriculum: String(data.get('curriculum')).trim(), county: String(data.get('county')).trim() || null } }, {
      onSuccess: () => { client.invalidateQueries({ queryKey: getGetSchoolContextQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setLocation('/dashboard'); },
      onError: () => setFormError('We couldn’t create your school workspace. Please review the details and try again.'),
    });
  }
  return <AppShell title="Create your school"><main className="page onboarding-page"><div className="onboarding-intro"><Link href="/dashboard" className="back-link"><ChevronLeft size={16} /> Back to workspace</Link><p className="eyebrow">LET’S GET STARTED</p><h1>Bring your school<br /><em>into focus.</em></h1><p>Start with a few details. You can build out the rest of your workspace as you go.</p><div className="onboarding-points"><div><CheckCircle2 size={17} /><span>Your school data stays within your workspace.</span></div><div><CheckCircle2 size={17} /><span>Access is shaped around each person’s role.</span></div><div><CheckCircle2 size={17} /><span>No sample records. Your data is yours to add.</span></div></div></div>
    <form className="panel onboarding-form" onSubmit={submit}><div className="form-step"><span>01</span><b>School details</b><i /></div><div className="form-title"><h2>Tell us about your school</h2><p>This helps us shape a workspace that fits.</p></div>
      <label className="field"><span>School name <b>*</b></span><input name="name" required minLength={2} maxLength={160} placeholder="e.g. Mwangaza Academy" data-testid="input-school-name" /></label>
      <div className="form-row"><label className="field"><span>School category <b>*</b></span><select name="category" required defaultValue=""><option value="" disabled>Select a category</option><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="mixed">Mixed</option><option value="tertiary">Tertiary</option><option value="other">Other</option></select></label><label className="field"><span>County</span><input name="county" maxLength={100} placeholder="Select or enter county" data-testid="input-school-county" /></label></div>
      <label className="field"><span>Curriculum <b>*</b></span><input name="curriculum" required minLength={2} maxLength={80} placeholder="e.g. CBC, 8-4-4, IGCSE" data-testid="input-school-curriculum" /></label>
      {formError && <p className="form-error" role="alert">{formError}</p>}<Button type="submit" disabled={create.isPending} testId="button-create-school">{create.isPending ? <><LoaderCircle size={16} className="subtle-spin" /> Creating workspace</> : <>Create school workspace <ArrowRight size={16} /></>}</Button><div className="form-privacy"><LockKeyhole size={13} /> Only authorised school members can view these details.</div>
    </form></main></AppShell>;
}

function StudentsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [notice, setNotice] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => { setTerm(search); setPage(1); }, 250); return () => window.clearTimeout(timer); }, [search]);
  const params = useMemo(() => ({ search: term || undefined, page, pageSize: 12 }), [term, page]);
  const students = useListStudents(params);
  const classes = useListClasses();
  const client = useQueryClient();
  const create = useCreateStudent();
  const update = useUpdateStudent();
  function resetList() { client.invalidateQueries({ queryKey: getListStudentsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); }
  function saveStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice('');
    const f = new FormData(event.currentTarget);
    const payload = {
      firstName: String(f.get('firstName')).trim(), lastName: String(f.get('lastName')).trim(),
      admissionNumber: String(f.get('admissionNumber')).trim(), classId: String(f.get('classId')) || null,
      guardianName: String(f.get('guardianName')).trim() || null, guardianEmail: String(f.get('guardianEmail')).trim() || null,
      guardianPhone: String(f.get('guardianPhone')).trim() || null, status: String(f.get('status') || 'active') as 'active' | 'transferred' | 'graduated' | 'inactive',
    };
    const done = () => { setModal(false); setEditing(null); resetList(); };
    if (editing) update.mutate({ studentId: editing.id, data: payload }, { onSuccess: done, onError: () => setNotice('Student details could not be updated. Please try again.') });
    else create.mutate({ data: payload }, { onSuccess: done, onError: () => setNotice('Student registration could not be completed. Check the admission number and try again.') });
  }
  const items = students.data?.items || [];
  const totalPages = students.data ? Math.max(1, Math.ceil(students.data.total / students.data.pageSize)) : 1;
  return <AppShell title="Students"><main className="page">
    <PageHeader kicker="SCHOOL RECORDS" title="Students" description="Manage learner records and keep school details in order." action={<Button onClick={() => { setEditing(null); setNotice(''); setModal(true); }} testId="button-register-student"><Plus size={16} /> Register student</Button>} />
    <section className="panel records-panel"><div className="records-toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or admission number" aria-label="Search students" data-testid="input-search-students" /></div><div className="filter-label"><SlidersHorizontal size={15} /> School records</div></div>
      {students.isLoading ? <LoadingBlock label="Loading student records" /> : students.isError ? <ErrorState message="Student records are temporarily unavailable." retry={() => students.refetch()} /> : items.length === 0 ? <EmptyState icon={Users} title={term ? 'No matching students' : 'No students registered yet'} text={term ? 'Try another name or admission number.' : 'Your school’s student records will appear here once you register a learner.'} action={!term ? <Button onClick={() => setModal(true)}><Plus size={15} /> Register first student</Button> : undefined} /> : <>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>STUDENT</th><th>ADMISSION NO.</th><th>CLASS</th><th>GUARDIAN</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{items.map((student) => <tr key={student.id} data-testid={`row-student-${student.id}`}><td><div className="student-cell"><span className="student-initial">{student.firstName?.[0]}{student.lastName?.[0]}</span><span><b>{student.firstName} {student.lastName}</b><small>Registered {new Date(student.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</small></span></div></td><td className="mono-cell">{student.admissionNumber}</td><td>{student.className || <span className="muted-cell">Unassigned</span>}</td><td>{student.guardianName || <span className="muted-cell">Not provided</span>}</td><td><StatusBadge status={student.status} /></td><td><button className="table-action" onClick={() => { setEditing(student); setNotice(''); setModal(true); }} aria-label={`Edit ${student.firstName} ${student.lastName}`} data-testid={`button-edit-student-${student.id}`}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>
        <div className="table-footer"><span>Showing <b>{(page - 1) * (students.data?.pageSize || 12) + 1}–{Math.min(page * (students.data?.pageSize || 12), students.data?.total || 0)}</b> of <b>{students.data?.total || 0}</b> students</span><div className="pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></div>
      </>}
    </section>
    {modal && <Modal title={editing ? 'Edit student details' : 'Register a student'} subtitle="Keep each learner’s school record accurate." close={() => setModal(false)}><form className="modal-form" onSubmit={saveStudent}>
      <div className="form-row"><label className="field"><span>First name <b>*</b></span><input name="firstName" required defaultValue={editing?.firstName || ''} data-testid="input-student-first-name" /></label><label className="field"><span>Last name <b>*</b></span><input name="lastName" required defaultValue={editing?.lastName || ''} data-testid="input-student-last-name" /></label></div>
      <div className="form-row"><label className="field"><span>Admission number <b>*</b></span><input name="admissionNumber" required defaultValue={editing?.admissionNumber || ''} data-testid="input-admission-number" /></label><label className="field"><span>Class group</span><select name="classId" defaultValue={editing?.classId || ''}><option value="">Not assigned</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
      <div className="modal-section-label">GUARDIAN DETAILS</div><label className="field"><span>Guardian name</span><input name="guardianName" defaultValue={editing?.guardianName || ''} /></label>
      <div className="form-row"><label className="field"><span>Email address</span><input type="email" name="guardianEmail" defaultValue={editing?.guardianEmail || ''} /></label><label className="field"><span>Phone number</span><input type="tel" name="guardianPhone" defaultValue={editing?.guardianPhone || ''} /></label></div>
      {editing && <label className="field"><span>Record status</span><select name="status" defaultValue={editing.status}><option value="active">Active</option><option value="transferred">Transferred</option><option value="graduated">Graduated</option><option value="inactive">Inactive</option></select></label>}
      {notice && <p className="form-error" role="alert">{notice}</p>}<div className="modal-actions"><Button kind="quiet" onClick={() => setModal(false)}>Cancel</Button><Button type="submit" disabled={create.isPending || update.isPending} testId="button-save-student">{create.isPending || update.isPending ? 'Saving…' : editing ? 'Save changes' : 'Register student'}</Button></div>
    </form></Modal>}
  </main></AppShell>;
}

function StatusBadge({ status }: { status: string }) {
  const known = ['active', 'present'].includes(status);
  return <span className={`status-badge ${known ? 'status-good' : 'status-other'}`}><i />{status.replaceAll('_', ' ')}</span>;
}

function ClassesPage() {
  const [modal, setModal] = useState(false);
  const [error, setError] = useState('');
  const classes = useListClasses();
  const create = useCreateClass();
  const client = useQueryClient();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); const f = new FormData(e.currentTarget);
    create.mutate({ data: { name: String(f.get('name')).trim(), grade: String(f.get('grade')).trim(), stream: String(f.get('stream')).trim() || null, academicYear: String(f.get('academicYear')).trim() } }, {
      onSuccess: () => { setModal(false); client.invalidateQueries({ queryKey: getListClassesQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); },
      onError: () => setError('We couldn’t create this class group. Check the details and try again.'),
    });
  }
  return <AppShell title="Classes"><main className="page"><PageHeader kicker="LEARNING GROUPS" title="Classes" description="Organise class groups for your school year." action={<Button onClick={() => { setError(''); setModal(true); }} testId="button-create-class"><Plus size={16} /> Create class group</Button>} />
    {classes.isLoading ? <LoadingBlock label="Loading class groups" /> : classes.isError ? <ErrorState message="Class groups could not be loaded." retry={() => classes.refetch()} /> : classes.data?.length ? <div className="classes-grid">{classes.data.map((group) => <ClassCard key={group.id} group={group} />)}</div> : <EmptyState icon={BookOpen} title="No class groups yet" text="Create your first class group to start organising learners and taking attendance." action={<Button onClick={() => setModal(true)}><Plus size={15} /> Create class group</Button>} />}
    {modal && <Modal title="Create a class group" subtitle="Add a learning group to your school." close={() => setModal(false)}><form className="modal-form" onSubmit={submit}>
      <label className="field"><span>Class name <b>*</b></span><input name="name" required maxLength={100} placeholder="e.g. Grade 4 East" data-testid="input-class-name" /></label>
      <div className="form-row"><label className="field"><span>Grade <b>*</b></span><input name="grade" required maxLength={40} placeholder="e.g. Grade 4" /></label><label className="field"><span>Stream</span><input name="stream" maxLength={40} placeholder="e.g. East" /></label></div>
      <label className="field"><span>Academic year <b>*</b></span><input name="academicYear" required minLength={4} maxLength={20} placeholder="e.g. 2025" data-testid="input-academic-year" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Button kind="quiet" onClick={() => setModal(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create class group'}</Button></div>
    </form></Modal>}
  </main></AppShell>;
}

function ClassCard({ group }: { group: ClassRecord }) {
  return <article className="class-card"><div className="class-card-top"><span className="class-card-icon"><BookOpen size={18} /></span><span className="academic-chip">{group.academicYear}</span></div><div className="class-card-grade">{group.grade}{group.stream ? <span> · {group.stream}</span> : null}</div><h2>{group.name}</h2><div className="class-card-bottom"><span><Users size={14} /> {group.studentCount} {group.studentCount === 1 ? 'learner' : 'learners'}</span><Link href={`/attendance?class=${encodeURIComponent(group.id)}`} className="class-link">Attendance <ArrowRight size={14} /></Link></div></article>;
}

function todayLocal() {
  const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const EMPTY_ATTENDANCE: AttendanceRecord[] = [];
const EMPTY_STUDENTS: Student[] = [];
function AttendancePage() {
  const [loc] = useLocation();
  const initialClass = new URLSearchParams(loc.split('?')[1] || '').get('class') || '';
  const [classId, setClassId] = useState(initialClass);
  const [date, setDate] = useState(todayLocal());
  const [records, setRecords] = useState<Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; note?: string | null }>>({});
  const [success, setSuccess] = useState('');
  const [saveError, setSaveError] = useState('');
  const classes = useListClasses();
  const studentsParams = useMemo(() => ({ classId: classId || undefined, page: 1, pageSize: 100 }), [classId]);
  const students = useListStudents(studentsParams, { query: { enabled: !!classId, queryKey: getListStudentsQueryKey(studentsParams) } });
  const secondPageParams = useMemo(() => ({ classId: classId || undefined, page: 2, pageSize: 100 }), [classId]);
  const studentsPageTwo = useListStudents(secondPageParams, { query: { enabled: !!classId && (students.data?.total || 0) > 100, queryKey: getListStudentsQueryKey(secondPageParams) } });
  const attendanceParams = useMemo(() => ({ date, classId: classId || undefined }), [date, classId]);
  const attendance = useListAttendance(attendanceParams, { query: { enabled: !!classId, queryKey: getListAttendanceQueryKey(attendanceParams) } });
  const save = useSaveAttendance();
  const client = useQueryClient();
  const firstPageItems = students.data?.items || EMPTY_STUDENTS;
  const secondPageItems = studentsPageTwo.data?.items || EMPTY_STUDENTS;
  const studentItems = useMemo(() => [...firstPageItems, ...secondPageItems], [firstPageItems, secondPageItems]);
  const existing = attendance.data || EMPTY_ATTENDANCE;
  useEffect(() => {
    const next: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; note?: string | null }> = {};
    existing.forEach((r: AttendanceRecord) => { next[r.studentId] = { status: r.status, note: r.note }; });
    setRecords(next); setSuccess('');
  }, [existing, date, classId]);
  function setStatus(studentId: string, status: 'present' | 'absent' | 'late' | 'excused') {
    setSaveError('');
    setRecords((prev) => ({ ...prev, [studentId]: { ...prev[studentId], status } }));
  }
  const completed = studentItems.filter((s) => records[s.id]).length;
  const total = students.data?.total ?? studentItems.length;
  const tooManyStudents = total > 200;
  const allStudentsLoaded = studentItems.length === total;
  const counts = studentItems.reduce((acc, s) => { const status = records[s.id]?.status; if (status) acc[status] += 1; return acc; }, { present: 0, absent: 0, late: 0, excused: 0 });
  function saveRegister() {
    if (!classId || studentItems.length === 0 || completed !== total || tooManyStudents) return;
    const prepared = studentItems.map((student) => ({ studentId: student.id, status: records[student.id].status, note: records[student.id]?.note || null }));
    setSaveError('');
    save.mutate({ data: { classId, date, records: prepared } }, { onSuccess: () => { setSuccess('Register saved. Your class attendance is up to date.'); client.invalidateQueries({ queryKey: getListAttendanceQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); }, onError: () => setSaveError('The register could not be saved. Your changes are still here; please try again.') });
  }
  return <AppShell title="Attendance"><main className="page"><PageHeader kicker="DAILY CLASS REGISTER" title="Attendance" description="Take a date-specific register for each class group." />
    <section className="panel register-panel"><div className="register-controls"><label className="field"><span>Class group</span><select value={classId} onChange={(e) => { setClassId(e.target.value); setRecords({}); }} data-testid="select-attendance-class"><option value="">Choose a class group</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field"><span>Register date</span><input type="date" value={date} onChange={(e) => { setDate(e.target.value); setRecords({}); }} data-testid="input-attendance-date" /></label><div className="register-summary"><span className="summary-count">{completed}<small> / {total}</small></span><span>marked</span></div></div>
      {!classId ? <EmptyState icon={ClipboardCheck} title="Choose a class to begin" text="Select one of your school’s class groups to open its register." /> : students.isLoading || studentsPageTwo.isLoading || attendance.isLoading ? <LoadingBlock label="Loading this class register" /> : students.isError || studentsPageTwo.isError || attendance.isError ? <ErrorState message="The class register could not be loaded." retry={() => { students.refetch(); studentsPageTwo.refetch(); attendance.refetch(); }} /> : !studentItems.length ? <EmptyState icon={Users} title="No learners in this group" text="There are no student records assigned to this class yet. Add or assign learners from the Students page." action={<Link href="/students" className="button button-outline">Go to students <ArrowRight size={15} /></Link>} /> : <>
        {tooManyStudents && <div className="register-limit-note"><AlertTriangle size={15} /> This class has more learners than one register can save at once. Please contact your school administrator for help.</div>}
        <div className="register-progress"><div><span>REGISTER COMPLETION</span><b>{total ? Math.round(completed / total * 100) : 0}%</b></div><div className="progress-track"><i style={{ transform: `scaleX(${total ? completed / total : 0})` }} /></div><div className="register-status-counts"><span><i className="legend-present" /> Present <b>{counts.present}</b></span><span><i className="legend-absent" /> Absent <b>{counts.absent}</b></span><span><i className="legend-other" /> Other <b>{counts.late + counts.excused}</b></span></div></div>
        {success && <div className="success-message" role="status"><CheckCircle2 size={17} />{success}</div>}{saveError && <div className="register-error-message" role="alert"><AlertTriangle size={16} />{saveError}</div>}
        <div className="table-wrap attendance-table-wrap"><table className="data-table attendance-table"><thead><tr><th>LEARNER</th><th>ADMISSION NO.</th><th>REGISTER STATUS</th></tr></thead><tbody>{studentItems.map((student) => <tr key={student.id} data-testid={`attendance-student-${student.id}`}><td><div className="student-cell"><span className="student-initial">{student.firstName?.[0]}{student.lastName?.[0]}</span><span><b>{student.firstName} {student.lastName}</b></span></div></td><td className="mono-cell">{student.admissionNumber}</td><td><div className="attendance-options">{(['present','absent','late','excused'] as const).map((status) => <button key={status} className={`attendance-choice ${records[student.id]?.status === status ? `choice-${status}` : ''}`} onClick={() => setStatus(student.id, status)} data-testid={`attendance-${status}-${student.id}`}>{status[0].toUpperCase() + status.slice(1)}</button>)}</div></td></tr>)}</tbody></table></div>
        <div className="register-footer"><div><ShieldCheck size={15} /><span>{completed === total ? `All learners marked for ${new Date(`${date}T12:00:00`).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}.` : `${Math.max(0, total - completed)} learner${total - completed === 1 ? '' : 's'} still need a register status.`}</span></div><Button onClick={saveRegister} disabled={save.isPending || studentItems.length === 0 || !allStudentsLoaded || completed !== total || tooManyStudents} testId="button-save-attendance">{save.isPending ? 'Saving register…' : <>Save register <Check size={16} /></>}</Button></div>
      </>}
    </section>
  </main></AppShell>;
}

function PortalPage({ role }: { role: 'parent' | 'student' | 'teacher' | 'tutor' }) {
  const config = {
    parent: { title: 'Parent portal', heading: 'Stay close to your child’s school journey.', text: 'Your parent portal is ready to connect with your school. When a school links your account, the information shared with you will appear here.', icon: UserRound, tag: 'FAMILY CONNECTION' },
    student: { title: 'Learner portal', heading: 'Your learning, in one place.', text: 'This is your learner space. When your school links your account, the learning information available to you will appear here.', icon: BookOpen, tag: 'LEARNER SPACE' },
    teacher: { title: 'Teacher portal', heading: 'A clear start to your teaching day.', text: 'Your teacher space is ready. Once your school assigns your access, your classes and teaching tools will appear here.', icon: GraduationCap, tag: 'TEACHING SPACE' },
    tutor: { title: 'Tutor portal', heading: 'Learning support starts here.', text: 'This tutor entry point is in place. Your school will need to enable and connect tutor access before any information appears.', icon: Sparkles, tag: 'TUTOR SPACE' },
  }[role];
  const Icon = config.icon;
  const { data: context, isLoading, isError, refetch } = useGetSchoolContext();
  return <AppShell title={config.title}><main className="page portal-page"><PageHeader kicker={config.tag} title={config.title} description="A dedicated entry point for your role in the school community." />
    {isLoading ? <LoadingBlock label="Checking your school access" /> : isError ? <ErrorState message="We couldn’t check your current school access." retry={() => refetch()} /> : <div className="portal-empty panel"><div className="portal-art"><span className="portal-orbit orbit-one" /><span className="portal-orbit orbit-two" /><span className="portal-icon"><Icon size={28} /></span><span className="portal-spark spark-a" /><span className="portal-spark spark-b" /></div><div className="portal-copy"><span className="access-label"><span className="live-dot" /> ROLE-AWARE ACCESS</span><h2>{config.heading}</h2><p>{context?.memberships?.length ? config.text : 'No school access is currently connected to this account. Ask your school administrator to invite you or link your account.'}</p><div className="portal-actions"><Link href="/dashboard" className="button button-outline">Go to workspace <ArrowRight size={15} /></Link><span>Access appears when your school connects your account.</span></div></div><div className="portal-safety"><ShieldCheck size={15} /> School information is shared according to your role and permissions.</div></div>}
  </main></AppShell>;
}

function PlatformAdminPage() {
  const context = useGetSchoolContext();
  const isAuthorized = !!context.data?.memberships?.some((m) => m.role === 'platform_admin' && m.status === 'active');
  if (context.isLoading) return <AppLoading />;
  if (context.isError) return <AppShell title="Access check"><main className="page"><ErrorState message="We couldn’t verify platform administrator access." retry={() => context.refetch()} /></main></AppShell>;
  if (!isAuthorized) return <AppShell title="Access restricted"><main className="page"><div className="restricted-card"><span className="state-icon"><LockKeyhole size={20} /></span><p className="eyebrow">RESTRICTED AREA</p><h1>Platform administration isn’t available here.</h1><p>This area is reserved for explicitly authorised Tushciemat platform administrators. It is not part of a school owner workspace.</p><Link href="/dashboard" className="button button-outline">Return to your workspace <ArrowRight size={15} /></Link></div></main></AppShell>;
  return <AppShell title="Platform administration"><main className="page"><PageHeader kicker="TUSHCIEMAT OPERATIONS" title="Platform administration" description="Access is confirmed for an authorised platform administrator." /><EmptyState icon={ShieldCheck} title="Platform tools are not connected" text="No platform administration operations are available in this workspace yet." /></main></AppShell>;
}

function Modal({ children, title, subtitle, close }: { children: ReactNode; title: string; subtitle: string; close: () => void }) {
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [close]);
  return <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><p className="eyebrow">SCHOOL RECORD</p><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button onClick={close} className="modal-close" aria-label="Close dialog"><X size={18} /></button></div>{children}</section></div>;
}

function NotFound() {
  return <main className="not-found"><Brand /><p className="eyebrow">PAGE NOT FOUND</p><h1>This page is off the timetable.</h1><p>Let’s get you back to your school workspace.</p><Link href="/" className="button button-primary">Return home <ArrowRight size={16} /></Link></main>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkRouterWithLocation />;
}
function ClerkRouterWithLocation() {
  return <ClerkRouter />;
}
function App() {
  return <WouterRouter base={basePath}><ClerkRouter /></WouterRouter>;
}
export default App;
