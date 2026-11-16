import { useState, type FormEvent, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile,
} from 'firebase/auth';
import { Activity, ArrowRight, ArrowUpRight, Check, ClipboardCheck, LockKeyhole, Menu, School as SchoolIcon, ShieldCheck, Users } from 'lucide-react';
import { Link, Redirect, useLocation } from 'wouter';
import { AppLoading, Brand, Button } from '@/components/shell';
import { auth, authMessage, signInWithGoogle, signOut, useAuth } from '@/lib/auth';

const MIN_PASSWORD = 8;
const RESET_SENT = 'If an account exists for that email, a password reset link is on its way. Check your inbox.';

function GoogleMark() {
  return <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>;
}

function GoogleButton({ disabled, onError }: { disabled: boolean; onError: (message: string) => void }) {
  return <button type="button" className="button button-outline google-button" disabled={disabled} data-testid="button-google" onClick={() => {
    onError('');
    signInWithGoogle().catch((e) => onError(authMessage(e)));
  }}><GoogleMark /> Continue with Google</button>;
}

export function SignInPage() {
  const { ready, user } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'reset'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (!ready) return <AppLoading />;
  if (user) return <Redirect to="/home" replace />;
  const resetting = mode === 'reset';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      if (resetting) {
        await sendPasswordResetEmail(auth, email.trim());
        setNotice(RESET_SENT);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      // Never reveal whether an email has an account.
      if (resetting && (e as { code?: string }).code === 'auth/user-not-found') setNotice(RESET_SENT);
      else setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return <AuthBackdrop><section className="auth-card">
    <header><h1>{resetting ? 'Reset your password' : 'Welcome back'}</h1><p>{resetting ? 'We’ll email you a link to choose a new password.' : 'Your school day, in one clear place.'}</p></header>
    <form className="auth-form" onSubmit={submit} noValidate>
      <label className="field"><span>Email address</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" /></label>
      {!resetting && <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      <Button type="submit" disabled={busy || !email.trim() || (!resetting && !password)} testId="button-submit">{busy ? 'Please wait…' : resetting ? 'Send reset link' : 'Sign in'}</Button>
    </form>
    {!resetting && <><div className="auth-divider">or</div><GoogleButton disabled={busy} onError={setError} /></>}
    <div className="auth-links">
      <button type="button" className="text-button" onClick={() => { setMode(resetting ? 'sign-in' : 'reset'); setError(''); setNotice(''); }} data-testid="button-toggle-reset">{resetting ? 'Back to sign in' : 'Forgot password?'}</button>
      <span>New here? <Link href="/sign-up">Create an account</Link></span>
    </div>
  </section></AuthBackdrop>;
}

export function SignUpPage() {
  const { ready, user } = useAuth();
  const [, setLocation] = useLocation();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!ready) return <AppLoading />;
  // Stay here while the account is set up, so the first API call already carries the name.
  if (user && !busy && !error) return <Redirect to="/home" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD) { setError(`Choose a password of at least ${MIN_PASSWORD} characters.`); return; }
    setBusy(true);
    try {
      const { user: created } = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(created, { displayName: fullName.trim() });
      await created.getIdToken(true);
      setLocation('/verify-email', { replace: true });
    } catch (e) {
      setError(authMessage(e));
      setBusy(false);
    }
  }

  return <AuthBackdrop><section className="auth-card">
    <header><h1>Create your Tushciemat account</h1><p>A better-organised school starts here.</p></header>
    <form className="auth-form" onSubmit={submit} noValidate>
      <label className="field"><span>Full name</span><input autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="input-full-name" /></label>
      <label className="field"><span>Email address</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" /></label>
      <label className="field"><span>Password</span><input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD} characters`} data-testid="input-password" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !fullName.trim() || !email.trim() || !password} testId="button-submit">{busy ? 'Creating your account…' : 'Create account'}</Button>
    </form>
    <div className="auth-divider">or</div>
    <GoogleButton disabled={busy} onError={setError} />
    <div className="auth-links"><span>Already have an account? <Link href="/sign-in">Sign in</Link></span></div>
  </section></AuthBackdrop>;
}

export function VerifyEmailPage() {
  const { ready, user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (!ready) return <AppLoading />;
  if (!user) return <Redirect to="/sign-in" replace />;
  if (user.emailVerified) return <Redirect to="/home" replace />;

  async function verify(check: boolean) {
    setBusy(true); setError(''); setNotice('');
    try {
      if (check) {
        await refresh();
        if (!auth.currentUser?.emailVerified) setNotice('Your email isn’t verified yet. Open the email link, then check again.');
      } else {
        await sendEmailVerification(auth.currentUser!);
        setNotice('Verification email sent. Check your inbox and spam folder.');
      }
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return <AuthBackdrop><section className="auth-card">
    <header><h1>Verify your email</h1><p>Send a verification link to <b>{user.email}</b>. Open it in your inbox, then come back here. A verified email is required to accept school invitations.</p></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="auth-notice" role="status">{notice}</p>}
    <Button onClick={() => { void verify(false); }} disabled={busy} testId="button-send-verification">Send verification email</Button>
    <Button kind="outline" onClick={() => { void verify(true); }} disabled={busy} testId="button-check-verified">{busy ? 'Please wait…' : 'I’ve verified my email'}</Button>
    <div className="auth-links"><Link href="/home">Continue to workspace</Link><button className="text-button" onClick={() => { void signOut().catch((e) => setError(authMessage(e))); }}>Use a different account</button></div>
  </section></AuthBackdrop>;
}

export function AuthBackdrop({ children }: { children: ReactNode }) {
  return <main className="auth-backdrop"><div className="auth-brand"><Brand /></div><div className="auth-aside">
    <div className="auth-aside-inner"><p className="eyebrow">BUILT FOR KENYAN SCHOOLS</p><h1>Good systems<br />make room for<br /><em>good teaching.</em></h1>
      <p>Keep the school day moving, from the first bell to the last lesson.</p><div className="auth-seal"><ShieldCheck size={17} /> Private by design · School-led access</div></div>
  </div><div className="auth-card-wrap">{children}</div></main>;
}
export function LandingSkeleton() { return <div className="landing-skeleton"><div className="skel skel-nav" /><div className="skel skel-hero" /><div className="skel skel-block" /></div>; }

export function LandingPage() {
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
            <div className="preview-register"><div className="register-head"><span>Today’s register</span><span className="register-tag">PREVIEW</span></div><div className="register-line"><i className="line-dot green" /><span>Class register</span><b>Ready when you are</b></div><div className="register-line"><i className="line-dot yellow" /><span>School overview</span><b>One clear view</b></div></div>
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
export function NotFound() {
  return <main className="not-found"><Brand /><p className="eyebrow">PAGE NOT FOUND</p><h1>This page is off the timetable.</h1><p>Let’s get you back to your school workspace.</p><Link href="/" className="button button-primary">Return home <ArrowRight size={16} /></Link></main>;
}
