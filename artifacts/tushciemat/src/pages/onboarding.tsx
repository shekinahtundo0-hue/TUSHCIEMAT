import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Building2, ChevronLeft, MapPin, Search, ShieldCheck, UserRound, Users } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getListMyJoinRequestsQueryKey, useCreateSchool, useGetDiscoverableSchool, useJoinWithInvitation,
  useListDiscoverableSchools, useSubmitJoinRequest,
  type DirectorySchool, type JoinRequestInput, type JoinRequestRole, type School, type SchoolSettingsInput,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/shell';
import { apiMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSession } from '@/lib/session';

export function JoinSteps({ current }: { current: number }) {
  return <ol className="process-strip" aria-label="Joining a school">
    {['Find your school', 'Choose role & send', 'School reviews'].map((label, i) => <li key={label} className={i === current ? 'is-current' : ''} aria-current={i === current ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}
  </ol>;
}

export function OnboardingLinks() {
  return <nav className="entry-links" aria-label="School access"><Link href="/home">Back to workspace</Link><Link href="/onboarding/find">Find a school</Link><Link href="/onboarding/create">Create school</Link><Link href="/onboarding/requests">My requests</Link></nav>;
}

export function OnboardingPage() {
  const { me } = useSession();
  return <AppShell title="Welcome" portal={null}><main className="page entry-page">
    <PageHeader kicker={me.schools.length ? 'YOUR NEXT SCHOOL' : 'WELCOME TO TUSHCIEMAT'} title="Your school starts here." description="Join a school that already uses Tushciemat, or create a workspace for a school you manage." />
    <div className="welcome-choices">
      <Link href="/onboarding/find" className="panel welcome-choice"><span className="choice-icon"><Search size={24} /></span><h2>Find my school</h2><p>Search the school directory, choose your role and ask the school to review your access.</p><span className="choice-action">Find my school <ArrowRight size={17} /></span></Link>
      <Link href="/onboarding/create" className="panel welcome-choice"><span className="choice-icon"><Building2 size={24} /></span><h2>Create school</h2><p>Set up a new school workspace. You become its owner and can invite your team.</p><span className="choice-action">Create school <ArrowRight size={17} /></span></Link>
    </div>
    <div className="entry-note"><p>Already have an invitation? Open the full link your school shared, or paste its token after selecting your school.</p><p>Choosing a role does not grant access. Your school reviews requests and links the right records.</p></div>
    <OnboardingLinks />
  </main></AppShell>;
}

/** Only metadata supported by the generated school settings input. Contacts are never public directory fields. */
export function SchoolMetadataFields({ school }: { school?: School }) {
  return <>
    <label className="field"><span>School name <b>*</b></span><input name="name" required minLength={2} maxLength={160} defaultValue={school?.name} data-testid="input-school-name" /></label>
    <div className="form-row"><label className="field"><span>School category <b>*</b></span><select name="category" required defaultValue={school?.category || ''}><option value="" disabled>Select a category</option>{['primary', 'secondary', 'mixed', 'tertiary', 'other'].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label><label className="field"><span>Curriculum <b>*</b></span><input name="curriculum" required minLength={2} maxLength={80} defaultValue={school?.curriculum} placeholder="e.g. CBC, IGCSE" /></label></div>
    <div className="form-row"><label className="field"><span>Country <b>*</b></span><input name="country" required minLength={2} maxLength={100} defaultValue={school?.country ?? 'Kenya'} /></label><label className="field"><span>County</span><input name="county" maxLength={100} defaultValue={school?.county ?? ''} /></label></div>
    <label className="field"><span>Town</span><input name="town" maxLength={100} defaultValue={school?.town ?? ''} /></label>
    <label className="field"><span>Description</span><textarea name="description" maxLength={2000} rows={3} defaultValue={school?.description ?? ''} /></label>
    <div className="form-row"><label className="field"><span>Logo URL</span><input name="logoUrl" type="url" pattern="https?://.*" maxLength={2048} defaultValue={school?.logoUrl ?? ''} placeholder="https://…" /></label><label className="field"><span>Website URL</span><input name="website" type="url" pattern="https?://.*" maxLength={2048} defaultValue={school?.website ?? ''} placeholder="https://…" /></label></div>
    <div className="form-row"><label className="field"><span>Contact email · private</span><input name="contactEmail" type="email" maxLength={254} defaultValue={school?.contactEmail ?? ''} /></label><label className="field"><span>Contact phone · private</span><input name="contactPhone" type="tel" pattern="[+0-9 ()\-]{7,30}" maxLength={30} defaultValue={school?.contactPhone ?? ''} /></label></div>
    <label className="check-field directory-consent"><input type="checkbox" name="discoverable" defaultChecked={school?.discoverable ?? false} /><span>List this school in the public directory</span></label>
    <p className="muted-note">Opting in makes the school name, category, country, county, town, logo, description and verification status public. Contact email, contact phone, website and school records stay out of the directory. Existing schools stay private unless opted in.</p>
  </>;
}

export function readSchoolFields(data: FormData): SchoolSettingsInput {
  const text = (key: string) => String(data.get(key) ?? '').trim();
  return {
    name: text('name'), category: text('category') as SchoolSettingsInput['category'], curriculum: text('curriculum'),
    country: text('country'), county: text('county') || null, town: text('town') || null,
    logoUrl: text('logoUrl') || null, website: text('website') || null, description: text('description') || null,
    contactEmail: text('contactEmail') || null, contactPhone: text('contactPhone') || null, discoverable: data.has('discoverable'),
  };
}

export function CreateSchoolPage() {
  const [, setLocation] = useLocation();
  const { refreshMe, switchSchool } = useSession();
  const create = useCreateSchool();
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const f = new FormData(event.currentTarget);
    const text = (key: string) => String(f.get(key) ?? '').trim();
    const startsOn = text('startsOn'); const endsOn = text('endsOn');
    if (endsOn <= startsOn) { setError('The academic year must end after it starts.'); return; }
    try {
      const result = await create.mutateAsync({ data: { ...readSchoolFields(f), academicYear: { name: text('yearName'), startsOn, endsOn } } });
      setOpening(true);
      const fresh = await refreshMe();
      if (!fresh?.schools.some((s) => s.schoolId === result.id && s.roles.includes('owner'))) throw new Error('Your school was created, but owner access could not be refreshed. Open your workspace to try again.');
      switchSchool(result.id); setLocation('/admin');
    } catch (e) { setError(apiMessage(e, 'We couldn’t create your school workspace. Review the details and try again.')); }
    finally { setOpening(false); }
  }
  return <AppShell title="Create school" portal={null}><main className="page onboarding-page">
    <div className="onboarding-intro"><Link href="/onboarding" className="back-link"><ChevronLeft size={16} /> Back to welcome</Link><p className="eyebrow">A NEW SCHOOL WORKSPACE</p><h1>Bring your school<br /><em>into focus.</em></h1><p>You become the owner of this workspace. Start with the school details and current academic year, then invite your team.</p><OnboardingLinks /></div>
    <form className="panel onboarding-form" onSubmit={submit}>
      <div className="form-step"><span>01</span><b>School details & directory choice</b><i /></div><div className="form-title"><h2>Tell us about your school</h2><p>Required fields are marked with an asterisk.</p></div>
      <SchoolMetadataFields />
      <div className="form-step"><span>02</span><b>Current academic year</b><i /></div>
      <label className="field"><span>Year name <b>*</b></span><input name="yearName" required minLength={2} maxLength={40} placeholder="e.g. 2026" /></label>
      <div className="form-row"><label className="field"><span>Starts on <b>*</b></span><input type="date" name="startsOn" required /></label><label className="field"><span>Ends on <b>*</b></span><input type="date" name="endsOn" required /></label></div>
      {error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={create.isPending || create.isSuccess || opening} testId="button-create-school">{create.isSuccess ? 'Opening workspace…' : create.isPending ? 'Creating workspace…' : 'Create school workspace'} <ArrowRight size={16} /></Button>
      {create.isSuccess && error && <Link href="/home" className="under-link">Open workspace to refresh access</Link>}
    </form>
  </main></AppShell>;
}

export function SchoolIdentity({ school }: { school: DirectorySchool }) {
  const [failed, setFailed] = useState(false);
  return <div className="school-identity"><span className="directory-logo">{school.logoUrl && !failed ? <img src={school.logoUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Building2 size={24} />}</span><div><h2>{school.name}</h2><div className="school-public-meta"><span className="academic-chip">{school.category}</span><span><MapPin size={13} />{[school.town, school.county, school.country].filter(Boolean).join(', ')}</span>{school.verificationStatus === 'verified' && <span className="verified-label"><ShieldCheck size={14} /> Verified</span>}</div></div></div>;
}

export function FindSchoolPage() {
  const [input, setInput] = useState('');
  const normalized = input.trim().replace(/\s+/g, ' ').toLowerCase();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(normalized); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [normalized]);
  const ready = normalized.length >= 2 && search.length >= 2 && normalized === search;
  const schools = useListDiscoverableSchools({ search, page }, { query: { enabled: ready } });
  return <AppShell title="Find my school" portal={null}><main className="page entry-page">
    <JoinSteps current={0} /><PageHeader kicker="PUBLIC SCHOOL DIRECTORY" title="Find my school" description="Search by school name. Only schools that opted into the directory appear here." />
    <label className="field directory-search"><span>School name</span><div className="search-field"><Search size={18} /><input type="search" value={input} maxLength={160} onChange={(e) => setInput(e.target.value)} placeholder="Type at least 2 characters" data-testid="input-school-search" /></div></label>
    <div aria-live="polite" className="directory-results">
      {normalized.length < 2 ? <EmptyState icon={Search} title="Which school are you looking for?" text="Enter at least 2 characters of a name to search the public directory." /> : !ready || schools.isLoading ? <LoadingBlock label="Finding schools" /> : schools.isError ? <ErrorState message={apiMessage(schools.error, 'The directory could not be loaded.')} retry={() => { void schools.refetch(); }} /> : !schools.data?.length ? <EmptyState icon={Search} title={page > 1 ? 'No more schools on this page' : 'No matching schools'} text="Try a different name. Private schools do not appear here; ask them for an invitation." /> : <div className="directory-grid">{schools.data.map((s) => <Link href={`/onboarding/join/${s.id}`} key={s.id} className="panel directory-card"><SchoolIdentity school={s} />{s.description && <p>{s.description}</p>}<span className="choice-action">Choose school <ArrowRight size={15} /></span></Link>)}</div>}
    </div>
    {ready && !schools.isLoading && !schools.isError && (page > 1 || schools.data?.length === 20) && <div className="entry-pagination"><Button kind="outline" disabled={page === 1 || schools.isFetching} onClick={() => setPage((p) => p - 1)}>Previous</Button><span>Page {page}</span><Button kind="outline" disabled={schools.data?.length !== 20 || schools.isFetching || page >= 101} onClick={() => setPage((p) => p + 1)}>Next</Button></div>}
    <p className="muted-note">Managing a school that isn’t here? <Link href="/onboarding/create" className="text-button">Create a school workspace</Link></p><OnboardingLinks />
  </main></AppShell>;
}

const ROLE_CHOICES = [
  { role: 'student', label: 'Student', text: 'Ask to link your existing learner record.', icon: BookOpen },
  { role: 'teacher', label: 'Teacher', text: 'Ask for teaching access; assignments come later.', icon: Users },
  { role: 'school_admin', label: 'School administrator', text: 'Ask for access to school management.', icon: ShieldCheck },
  { role: 'parent', label: 'Parent / guardian', text: 'Ask to link a guardian record held by the school.', icon: UserRound },
] as const;

export function JoinSchoolPage({ schoolId }: { schoolId: string }) {
  const school = useGetDiscoverableSchool(schoolId, { query: { retry: 1 } });
  return <AppShell title="Join school" portal={null}><main className="page entry-page"><JoinSteps current={1} />
    {school.isLoading ? <LoadingBlock label="Loading selected school" /> : school.isError || !school.data ? <><ErrorState message={apiMessage(school.error, 'This school may have been removed or made private. Find another school or ask the school for its invitation link.')} retry={() => { void school.refetch(); }} /><OnboardingLinks /></> : <JoinSchoolForm key={schoolId} school={school.data} />}
  </main></AppShell>;
}

function JoinSchoolForm({ school }: { school: DirectorySchool }) {
  const { me, refreshMe, switchSchool } = useSession();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const request = useSubmitJoinRequest(); const invite = useJoinWithInvitation();
  const [role, setRole] = useState<JoinRequestRole | null>(null);
  const [changeName, setChangeName] = useState(!me.fullName);
  const [name, setName] = useState(me.fullName ?? '');
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState(''); const [inviteError, setInviteError] = useState('');
  const [opening, setOpening] = useState(false); const [accepted, setAccepted] = useState(false);
  const emailReady = !!me.email && !!user?.emailVerified;
  const member = me.schools.find((s) => s.schoolId === school.id);
  async function openPortal() {
    setOpening(true); setInviteError('');
    try {
      const fresh = await refreshMe();
      if (!fresh?.schools.some((s) => s.schoolId === school.id && s.roles.length)) { setInviteError('No active access to this school was returned. Your membership may be suspended. Ask the school administrator to check your access.'); return; }
      switchSchool(school.id); setLocation('/home');
    } catch (e) { setInviteError(apiMessage(e, 'Your account could not be refreshed. Try opening the portal again.')); }
    finally { setOpening(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!role || !emailReady) return;
    const f = new FormData(event.currentTarget);
    const data: JoinRequestInput = { requestedRole: role, fullName: (changeName ? name : me.fullName ?? '').trim() };
    const keys: (keyof Omit<JoinRequestInput, 'requestedRole' | 'fullName'>)[] = role === 'student' ? ['admissionNumber', 'programme', 'academicYear'] : role === 'teacher' ? ['staffNumber', 'department', 'subjects', 'classes'] : role === 'school_admin' ? ['position', 'reason'] : ['admissionNumber', 'relationship', 'reason'];
    for (const key of keys) { const value = String(f.get(key) ?? '').trim(); if (value) data[key] = value; }
    if (data.fullName.length < 2) { setError('Enter your full name, at least 2 characters.'); return; }
    if (role === 'student' && !data.admissionNumber) { setError('Enter your admission number so the school can check its records.'); return; }
    if (role === 'school_admin' && (!data.position || (data.reason?.length ?? 0) < 3)) { setError('Enter your position and a reason of at least 3 characters.'); return; }
    try { await request.mutateAsync({ schoolId: school.id, data }); await client.invalidateQueries({ queryKey: getListMyJoinRequestsQueryKey() }); setLocation('/onboarding/requests'); }
    catch (e) { setError(apiMessage(e, 'Your access request could not be sent.')); }
  }
  async function useInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setInviteError('');
    if (!role || !emailReady) return;
    let token = tokenInput.trim();
    if (token.includes('#')) {
      try { token = decodeURIComponent(token.slice(token.indexOf('#') + 1)).trim(); }
      catch { setInviteError('Paste the raw invitation token or the full invitation link, including its fragment.'); return; }
    }
    if (!/^[A-Za-z0-9_-]{20,256}$/.test(token)) { setInviteError('This token is incomplete. Paste the raw token or the full link your school shared.'); return; }
    try {
      const result = await invite.mutateAsync({ schoolId: school.id, data: { token, role } });
      setTokenInput(''); invite.reset();
      if (result.schoolId !== school.id) { setInviteError('The invitation did not return access to the selected school. Ask your administrator to check it.'); return; }
      setAccepted(true);
      await openPortal();
    } catch (e) { setInviteError(apiMessage(e, 'This invitation could not be used. Check the school, selected role, email address and expiry with your administrator.')); }
  }
  const inputField = (key: string, label: string, maxLength: number, required = false) => <label className="field"><span>{label}{required && <b> *</b>}</span><input name={key} maxLength={maxLength} required={required} /></label>;
  return <>
    <section className="panel selected-school"><SchoolIdentity school={school} />{school.description && <p className="muted-note">{school.description}</p>}</section>
    {member ? <section className="panel access-form"><h2>You already belong to this school</h2><p className="muted-note">Open your portal using your active membership, rather than sending another request.</p><Button disabled={opening} onClick={() => { void openPortal(); }}>{opening ? 'Checking access…' : 'Open portal'}</Button>{inviteError && <p className="form-error" role="alert">{inviteError}</p>}</section> : <>
      <PageHeader kicker="YOUR ROLE AT THIS SCHOOL" title="How will you join?" description="Select the role the school should review. This choice alone gives no access." />
      <div className="join-role-grid" role="group" aria-label="Requested role">{ROLE_CHOICES.map(({ role: r, label, text, icon: Icon }) => <button key={r} className={`panel join-role ${role === r ? 'is-selected' : ''}`} aria-pressed={role === r} disabled={accepted || opening || request.isPending || invite.isPending} onClick={() => { setRole(r); setError(''); setInviteError(''); }}><Icon size={21} /><b>{label}</b><span>{text}</span></button>)}</div>
      {!emailReady && <div className="entry-note"><h2>Verify your email before joining</h2><p>{!me.email ? 'Your account does not yet have a verified email available to the school.' : 'Your sign-in email is not verified yet.'} The server requires a verified email for both access requests and invitations. Verification does not itself grant school access.</p><Link href="/verify-email" className="button button-outline">Verify email</Link></div>}
      {accepted ? <section className="panel access-form"><h2>Invitation accepted</h2><p className="muted-note">Your token has been cleared. Refresh your active access to open this school.</p>{inviteError && <p className="form-error" role="alert">{inviteError}</p>}<Button disabled={opening} onClick={() => { void openPortal(); }}>Open portal</Button></section> : role && <div className="join-form-layout">
        <form className="panel access-form modal-form" key={role} onSubmit={submit}><h2>Request {ROLE_CHOICES.find((r) => r.role === role)?.label.toLowerCase()} access</h2>
          {changeName ? <label className="field"><span>Full name <b>*</b></span><input name="fullName" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} autoComplete="name" /></label> : <p className="muted-note">Requesting as <b>{me.fullName}</b>. <button type="button" className="text-button" onClick={() => setChangeName(true)}>Adjust name</button></p>}
          <p className="muted-note">Account email: {me.email || 'Not verified yet'}. Your existing account is used; no need to enter your email again.</p>
          {role === 'student' && <>{inputField('admissionNumber', 'Admission number', 40, true)}{inputField('programme', 'Programme / course', 160)}{inputField('academicYear', 'Academic year', 40)}</>}
          {role === 'teacher' && <>{inputField('staffNumber', 'Staff number', 80)}{inputField('department', 'Department (optional)', 160)}{inputField('subjects', 'Subjects you teach (declaration)', 500)}{inputField('classes', 'Classes you teach (declaration)', 500)}<p className="muted-note">These free-text details help the school verify you. They do not assign classes, subjects or permissions.</p></>}
          {role === 'school_admin' && <>{inputField('position', 'Position', 160, true)}<label className="field"><span>Why do you need administrator access? <b>*</b></span><textarea name="reason" required minLength={3} maxLength={1000} rows={4} /></label></>}
          {role === 'parent' && <>{inputField('admissionNumber', 'Child’s admission number', 40)}{inputField('relationship', 'Relationship to learner', 80, true)}<label className="field"><span>Details for the school</span><textarea name="reason" maxLength={1000} rows={3} /></label><p className="muted-note">The school must verify and link a guardian record with your email. A name or admission number alone cannot grant access.</p></>}
          {error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={!emailReady || request.isPending || invite.isPending || opening}>{request.isPending ? 'Sending request…' : 'Send access request'}</Button><p className="muted-note">The school will review this request. Track its decision in My requests.</p>
        </form>
        <form className="panel access-form invitation-form modal-form" onSubmit={useInvitation}><h2>Have an invitation token?</h2><p className="muted-note">This is a separate way to join, only if the school has already invited you for the selected role. It does not send an access request.</p><label className="field"><span>Invitation token or copy/share link</span><input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} required autoComplete="off" spellCheck={false} /></label><p className="muted-note">The server checks the selected school, role and verified email. Invitations expire and work once. The token is never added to this page’s URL.</p>{inviteError && <p className="form-error" role="alert">{inviteError}</p>}<Button kind="outline" type="submit" disabled={!emailReady || invite.isPending || request.isPending || opening}>{invite.isPending ? 'Checking invitation…' : 'Join with invitation'}</Button></form>
      </div>}
    </>}
    <OnboardingLinks />
  </>;
}
