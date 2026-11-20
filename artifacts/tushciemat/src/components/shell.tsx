import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Bell, BookOpen, CalendarCheck, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, Copy,
  LayoutDashboard, LoaderCircle, LogOut, Megaphone, Menu, Plus, RefreshCw, School as SchoolIcon, Search, Settings, ShieldCheck,
  FolderOpen, GraduationCap,
  TrendingUp, UserPlus, UserRound, Users, X, type LucideIcon,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useListNotifications, type SchoolRole } from '@workspace/api-client-react';
import { signOut, useAuth } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { ATTENDANCE_TAKERS, CLASS_VIEWERS, MANAGERS, PORTALS, ROLE_LABELS, STAFF, STUDENT_VIEWERS, hasAny, portalsFor, type PortalKey } from '@/lib/roles';

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className={`brand ${light ? 'brand-light' : ''}`} data-testid="link-brand">
    <span className="brand-mark"><SchoolIcon size={19} strokeWidth={2.3} /></span>
    <span>Tushciemat<span className="brand-dot">.</span></span>
  </Link>;
}

export function Button({ children, onClick, kind = 'primary', type = 'button', disabled = false, testId }: {
  children: ReactNode; onClick?: () => void; kind?: 'primary' | 'outline' | 'quiet' | 'gold'; type?: 'button' | 'submit'; disabled?: boolean; testId?: string;
}) {
  return <button className={`button button-${kind}`} onClick={onClick} type={type} disabled={disabled} data-testid={testId}>{children}</button>;
}

type ShellKey = PortalKey | 'platform';
type NavItem = { href: string; label: string; icon: LucideIcon; roles?: readonly SchoolRole[] };

const NAV: Record<ShellKey, NavItem[]> = {
  admin: [
    { href: '/admin', label: 'Overview', icon: LayoutDashboard, roles: STAFF },
    { href: '/admin/students', label: 'Students', icon: Users, roles: STUDENT_VIEWERS },
    { href: '/admin/classes', label: 'Classes', icon: BookOpen, roles: STAFF },
    { href: '/admin/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ATTENDANCE_TAKERS },
    { href: '/admin/calendar', label: 'School calendar', icon: CalendarDays },
    { href: '/admin/people', label: 'People', icon: UserPlus, roles: STAFF },
    { href: '/admin/requests', label: 'Access requests', icon: ClipboardCheck, roles: MANAGERS },
    { href: '/admin/announcements', label: 'Announcements', icon: Megaphone },
    { href: '/admin/settings', label: 'School settings', icon: Settings, roles: MANAGERS },
  ],
  teach: [
    { href: '/teach', label: 'My classes', icon: BookOpen, roles: PORTALS.teach.roles },
    { href: '/teach/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['teacher'] },
    { href: '/teach/students', label: 'Learners', icon: Users, roles: ['teacher'] },
    { href: '/teach/materials', label: 'Materials', icon: FolderOpen, roles: ['teacher'] },
    { href: '/teach/materials/new', label: 'Upload notes', icon: Plus, roles: ['teacher'] },
    { href: '/teach/assignments', label: 'Assignments', icon: ClipboardCheck, roles: ['teacher'] },
    { href: '/teach/submissions', label: 'Marking', icon: GraduationCap, roles: ['teacher'] },
    { href: '/teach/announcements', label: 'Announcements', icon: Megaphone },
  ],
  family: [
    { href: '/family', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/family/academic', label: 'Academics', icon: TrendingUp },
    { href: '/family/attendance', label: 'Attendance', icon: CalendarCheck },
    { href: '/family/assignments', label: 'Assignments', icon: ClipboardCheck },
    { href: '/family/communications', label: 'Communications', icon: Megaphone },
    { href: '/family/children', label: 'My children', icon: Users },
    { href: '/family/announcements', label: 'Announcements', icon: Megaphone },
  ],
  learn: [
    { href: '/learn', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/learn/learning', label: 'My learning', icon: BookOpen },
    { href: '/learn/assignments', label: 'Assignments', icon: ClipboardCheck },
    { href: '/learn/results', label: 'Results', icon: TrendingUp },
    { href: '/learn/timetable', label: 'Timetable', icon: CalendarDays },
    { href: '/learn/announcements', label: 'Announcements', icon: Megaphone },
    { href: '/learn/profile', label: 'Profile', icon: UserRound },
  ],
  platform: [{ href: '/platform', label: 'Schools', icon: ShieldCheck }],
};

const SHELL_LABELS: Record<ShellKey, string> = {
  admin: PORTALS.admin.label, teach: PORTALS.teach.label, family: PORTALS.family.label, learn: PORTALS.learn.label, platform: 'Platform',
};

export function AppShell({ children, title, portal }: { children: ReactNode; title: string; portal: ShellKey | null }) {
  const [loc, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const navToggle = useRef<HTMLButtonElement>(null);
  const mobileActive = isMobile && mobileOpen;
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => { setIsMobile(media.matches); if (!media.matches) setMobileOpen(false); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileActive) return;
    const toggle = navToggle.current;
    const focusable = () => Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter((el) => el.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] ?? sidebar.current)?.focus({ preventScroll: true });
    focusFirst();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setMobileOpen(false); setSwitcherOpen(false); }
      if (e.key === 'Tab') {
        const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1];
        if (!first) { e.preventDefault(); sidebar.current?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !sidebar.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !sidebar.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    const onFocus = (e: FocusEvent) => { if (e.target instanceof Node && !sidebar.current?.contains(e.target)) focusFirst(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (toggle?.isConnected && toggle.getClientRects().length) toggle.focus();
    };
  }, [mobileActive]);
  const { user } = useAuth();
  const { me, school, roles, switchSchool } = useSession();
  const notifications = useListNotifications({ query: { refetchInterval: 30_000 } });
  const unread = notifications.data?.filter((n) => !n.readAt).length ?? 0;
  const nav = portal ? NAV[portal].filter((item) => !item.roles || hasAny(roles, item.roles)).map((item) => item.href === '/teach' && !hasAny(roles, CLASS_VIEWERS) ? { ...item, label: 'Teaching' } : item) : [];
  const otherPortals = [
    ...portalsFor(roles).map((key) => ({ key: key as ShellKey, path: PORTALS[key].path, label: PORTALS[key].label })),
    ...(me.platformRole ? [{ key: 'platform' as ShellKey, path: '/platform', label: 'Platform' }] : []),
  ].filter((entry) => entry.key !== portal);
  const initial = (me.fullName?.[0] || user?.displayName?.[0] || me.email?.[0] || 'T').toUpperCase();
  const close = () => { setMobileOpen(false); setSwitcherOpen(false); };

  return <div className="app-shell">
    <aside ref={sidebar} id="app-navigation" tabIndex={-1} className={`sidebar ${mobileActive ? 'sidebar-open' : ''}`} inert={isMobile && !mobileOpen} aria-hidden={isMobile && !mobileOpen ? true : undefined} role={mobileActive ? 'dialog' : undefined} aria-modal={mobileActive ? true : undefined} aria-label="School navigation">
      <div className="sidebar-brand"><Brand light /><button className="sidebar-close" onClick={close} aria-label="Close navigation"><X size={18} /></button></div>
      <div className="switcher-wrap">
        <button className="school-switcher" onClick={() => setSwitcherOpen(!switcherOpen)} aria-expanded={switcherOpen} data-testid="button-school-switcher">
          <span className="school-avatar"><SchoolIcon size={17} /></span>
          <span className="switcher-text"><small>{school ? 'YOUR SCHOOL' : 'NO SCHOOL YET'}</small><b>{school?.schoolName || 'Choose or create a school'}</b></span>
          <ChevronDown size={15} />
        </button>
        {switcherOpen && <div className="switcher-menu" role="menu">
          {me.schools.map((s) => <button key={s.schoolId} role="menuitem" className={`switcher-option ${s.schoolId === school?.schoolId ? 'is-active' : ''}`} onClick={() => {
            close();
            if (s.schoolId !== school?.schoolId) { switchSchool(s.schoolId); setLocation('/home'); }
          }}><span><b>{s.schoolName}</b><small>{s.roles.map((r) => ROLE_LABELS[r]).join(' · ')}</small></span>{s.schoolId === school?.schoolId && <Check size={14} />}</button>)}
          <Link href="/onboarding/find" className="switcher-option switcher-create" role="menuitem" onClick={close}><Search size={14} /><span><b>{me.schools.length ? 'Join another school' : 'Find my school'}</b></span></Link>
          <Link href="/onboarding/create" className="switcher-option" role="menuitem" onClick={close}><Plus size={14} /><span><b>{me.schools.length ? 'Create another school' : 'Create school'}</b></span></Link>
        </div>}
      </div>
      {nav.length > 0 && <><div className="nav-label">{SHELL_LABELS[portal!].toUpperCase()}</div><nav className="side-nav">{nav.map((item) => {
        const Icon = item.icon; const active = loc === item.href;
        return <Link key={item.href} href={item.href} className={`side-link ${active ? 'is-active' : ''}`} onClick={close} data-testid={`nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={17} /><span>{item.label}</span>{active && <i />}</Link>;
      })}</nav></>}
      {otherPortals.length > 0 && <>
        <div className="nav-label portal-label">YOUR OTHER PORTALS</div><nav className="side-nav portal-nav">
          {otherPortals.map((entry) => <Link key={entry.key} href={entry.path} className="side-link" onClick={close}><UserRound size={16} /><span>{entry.label}</span></Link>)}
        </nav>
      </>}
      <div className="nav-label">YOUR ACCOUNT</div><nav className="side-nav" aria-label="Account navigation">
        <Link href="/notifications" className={`side-link ${loc === '/notifications' ? 'is-active' : ''}`} onClick={close}><Bell size={17} /><span>Notifications</span>{unread > 0 && <b className="notification-badge" aria-label={`${unread} unread notifications`}>{unread}</b>}</Link>
        <Link href="/onboarding/requests" className={`side-link ${loc === '/onboarding/requests' ? 'is-active' : ''}`} onClick={close}><ClipboardCheck size={17} /><span>My requests</span></Link>
      </nav>
      <div className="sidebar-bottom">{user && !user.emailVerified && <Link href="/verify-email" className="switcher-option" data-testid="link-verify-email">Verify your email</Link>}<div className="help-card"><div className="help-top"><CircleHelp size={15} /><span>Here to help</span></div><p>Ask your school administrator for help with access.</p></div>
        <button className="account-row" onClick={() => { void signOut().catch(() => undefined).then(() => setLocation('/', { replace: true })); }} data-testid="button-sign-out"><span className="account-avatar">{initial}</span><span className="account-name"><b>{me.fullName || user?.displayName || 'Your account'}</b><small>{roles.length ? roles.map((r) => ROLE_LABELS[r]).join(' · ') : me.email || 'Signed in'}</small></span><LogOut size={16} /></button>
      </div>
    </aside>
    {mobileActive && <button className="sidebar-scrim" onClick={close} tabIndex={-1} aria-hidden="true" aria-label="Close menu" />}
    <div className="workspace" inert={mobileActive}><header className="topbar"><button ref={navToggle} className="mobile-nav-toggle" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileActive} aria-controls="app-navigation"><Menu size={20} /></button><div className="crumb"><span>{portal ? SHELL_LABELS[portal] : 'Workspace'}</span><ChevronRight size={14} /> <b>{title}</b></div><div className="topbar-right"><span className="day-chip"><CalendarDays size={13} /> {new Intl.DateTimeFormat('en-KE', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}</span><Link href="/notifications" className="notification-link" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><Bell size={18} />{unread > 0 && <b className="notification-badge">{unread}</b>}</Link><span className="top-avatar">{initial}</span></div></header><div className="workspace-body">{children}</div></div>
  </div>;
}

export function PageHeader({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</div>;
}
export function LoadingBlock({ label = 'Loading school data' }: { label?: string }) {
  return <div className="loading-block" role="status"><div className="skeleton-row"><span className="skel skel-big" /><span className="skel skel-small" /></div><div className="skeleton-grid"><span className="skel" /><span className="skel" /><span className="skel" /></div><p><LoaderCircle size={14} className="subtle-spin" /> {label}</p></div>;
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="state-card error-state"><span className="state-icon error-icon"><AlertTriangle size={20} /></span><h3>We couldn’t load this just now</h3><p>{message || 'Please check your connection and try again.'}</p>{retry && <Button kind="outline" onClick={retry}><RefreshCw size={15} /> Try again</Button>}</div>;
}
export function EmptyState({ icon: Icon = SchoolIcon, title, text, action }: { icon?: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return <div className="state-card empty-state"><span className="state-icon"><Icon size={20} /></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function AppLoading() { return <div className="global-loading"><div className="loading-logo"><SchoolIcon size={22} /></div><LoadingBlock label="Preparing your workspace" /></div>; }

export function StatusBadge({ status }: { status: string }) {
  const good = ['active', 'present', 'accepted', 'pending'].includes(status);
  return <span className={`status-badge ${good ? 'status-good' : 'status-other'}`}><i />{status.replaceAll('_', ' ')}</span>;
}

export function Metric({ title, value, suffix = '', icon: Icon, detail, tone }: { title: string; value: number | null; suffix?: string; icon: LucideIcon; detail: string; tone: string }) {
  return <article className="metric-card" data-testid={`metric-${title.toLowerCase().replaceAll(' ', '-')}`}><div className="metric-top"><span>{title}</span><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div><div className="metric-value">{value ?? '—'}{value !== null && <small>{suffix}</small>}</div><p>{detail}</p></article>;
}

export function Modal({ children, title, subtitle, close, kicker = 'SCHOOL RECORD', wide = false }: { children: ReactNode; title: string; subtitle: string; close: () => void; kicker?: string; wide?: boolean }) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter((el) => el.getClientRects().length > 0);
    (focusable()[0] ?? dialog.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1];
        if (!first) { e.preventDefault(); dialog.current?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><section ref={dialog} tabIndex={-1} className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-subtitle"><div className="modal-heading"><div><p className="eyebrow">{kicker}</p><h2 id="modal-title">{title}</h2><p id="modal-subtitle">{subtitle}</p></div><button onClick={close} className="modal-close" aria-label="Close dialog"><X size={18} /></button></div>{children}</section></div>;
}

/** Shows a freshly created invitation link. The token is only ever returned once. */
export function InviteLink({ acceptPath, email }: { acceptPath: string; email: string }) {
  const url = `${window.location.origin}${basePath}${acceptPath}`;
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectLink = () => { inputRef.current?.focus(); inputRef.current?.select(); };
  return <div className="invite-link" role="status">
    <p><b>Invitation ready for {email}.</b> Share this link with them directly. It works once, only for that email address, and won’t be shown again.</p>
    <div className="invite-link-row"><input ref={inputRef} readOnly value={url} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} data-testid="input-invite-link" />
      <Button kind="outline" onClick={() => { if (!navigator.clipboard) { selectLink(); return; } void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(selectLink); }}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</Button></div>
  </div>;
}
