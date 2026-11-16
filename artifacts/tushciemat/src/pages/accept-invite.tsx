import { useEffect, useState, type ReactNode } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { ArrowRight, LogOut, MailCheck } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useAcceptInvitation } from '@workspace/api-client-react';
import { Button } from '@/components/shell';
import { apiMessage } from '@/lib/api';
import { auth, authMessage, signOut, useAuth } from '@/lib/auth';
import { pendingInvite, useSession } from '@/lib/session';
import { AuthBackdrop } from '@/pages/public';

// The token travels in the URL fragment so it never reaches server logs; move it out of the address bar at once.
function captureInviteToken(): string | null {
  const fromHash = window.location.hash.slice(1).trim();
  if (fromHash) {
    pendingInvite.set(fromHash);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return pendingInvite.get();
}

// Re-capture on hashchange too: a same-document navigation to a new #token must not be ignored.
function useInviteToken(): string | null {
  const [token, setToken] = useState(captureInviteToken);
  useEffect(() => {
    const onHash = () => setToken(captureInviteToken());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return token;
}

function InviteCard({ children }: { children: ReactNode }) {
  return <AuthBackdrop><section className="invite-card"><span className="state-icon"><MailCheck size={20} /></span>{children}</section></AuthBackdrop>;
}

function MissingToken() {
  return <InviteCard><h1>This invitation link is incomplete</h1><p>Open the full link you were sent, or ask the school to create a new invitation.</p><Link href="/" className="button button-outline">Go to Tushciemat <ArrowRight size={15} /></Link></InviteCard>;
}

export function AcceptInviteSignedOut() {
  const token = useInviteToken();
  if (!token) return <MissingToken />;
  return <InviteCard>
    <h1>You’ve been invited to a school on Tushciemat</h1>
    <p>Sign in or create an account using the email address the invitation was sent to. You’ll come straight back here to accept it.</p>
    <div className="invite-actions"><Link href="/sign-in" className="button button-primary" data-testid="link-invite-sign-in">Sign in <ArrowRight size={15} /></Link><Link href="/sign-up" className="button button-outline" data-testid="link-invite-sign-up">Create an account</Link></div>
  </InviteCard>;
}

export function AcceptInviteSignedIn() {
  const token = useInviteToken();
  const [, setLocation] = useLocation();
  const { user, refresh } = useAuth();
  const { refreshMe, switchSchool } = useSession();
  const accept = useAcceptInvitation();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(false);
  if (!token) return <MissingToken />;
  const email = user?.email;

  function acceptInvite() {
    setError('');
    accept.mutate({ data: { token: token! } }, {
      onSuccess: async (result) => {
        pendingInvite.clear();
        await refreshMe();
        switchSchool(result.schoolId);
        setLocation('/home', { replace: true });
      },
      onError: (e) => setError(apiMessage(e, 'The invitation could not be accepted. Please try again.')),
    });
  }

  async function resendVerification() {
    if (!user) return;
    setError(''); setNotice('');
    try {
      await sendEmailVerification(user);
      setNotice(`We’ve sent a verification link to ${email}.`);
    } catch (e) {
      setError(authMessage(e));
    }
  }

  async function checkVerified() {
    setError(''); setNotice(''); setChecking(true);
    try {
      await refresh();
      if (!auth.currentUser?.emailVerified) setNotice('Your email isn’t verified yet. Open the link in the email we sent, then try again.');
      else await refreshMe();
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setChecking(false);
    }
  }

  function switchAccount() {
    void signOut().catch(() => undefined).then(() => setLocation('/accept-invite', { replace: true }));
  }

  const differentAccount = <Button kind="quiet" onClick={switchAccount}><LogOut size={15} /> Use a different account</Button>;

  if (user && !user.emailVerified) {
    return <InviteCard>
      <h1>Verify your email first</h1>
      <p>Invitations are matched to a verified email address. Open the verification link we sent to <b>{email || 'your email'}</b>, then come back here.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      <div className="invite-actions">
        <Button onClick={() => { void checkVerified(); }} disabled={checking} testId="button-check-verified">{checking ? 'Checking…' : 'I’ve verified my email'}</Button>
        <Button kind="outline" onClick={() => { void resendVerification(); }}>Resend the link</Button>
      </div>
      {differentAccount}
    </InviteCard>;
  }

  return <InviteCard>
    <h1>Accept your school invitation</h1>
    <p>You’re signed in as <b>{email || 'your account'}</b>. The invitation only works for the email address it was sent to.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="invite-actions">
      <Button onClick={acceptInvite} disabled={accept.isPending} testId="button-accept-invite">{accept.isPending ? 'Accepting…' : 'Accept invitation'}</Button>
      {differentAccount}
    </div>
    <button className="text-button" onClick={() => { pendingInvite.clear(); setLocation('/home', { replace: true }); }}>Not now</button>
  </InviteCard>;
}
