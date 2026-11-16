import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MailPlus, ShieldCheck, UserPlus, Users } from 'lucide-react';
import {
  getListInvitationsQueryKey, getListMembersQueryKey, useCreateInvitation, useListInvitations, useListMembers,
  useRevokeInvitation, useSetMemberCapabilities, useUpdateMember,
  type CreatedInvitation, type Invitation, type Member, type SchoolCapability, type SchoolRole,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, InviteLink, LoadingBlock, Modal, PageHeader, StatusBadge } from '@/components/shell';
import { apiMessage, formatDate } from '@/lib/api';
import { CAPABILITY_LABELS, DELEGABLE_CAPABILITIES, MANAGERS, ROLE_LABELS, hasAny } from '@/lib/roles';
import { useSession } from '@/lib/session';

// Parent and learner invitations are tied to a record, so they start from the student page.
const STAFF_INVITE_ROLES: SchoolRole[] = ['school_admin', 'principal', 'academic_admin', 'bursar', 'teacher', 'tutor'];

export function PeoplePage() {
  const { roles, capabilities, can } = useSession();
  const canManage = hasAny(roles, MANAGERS) && can('people.manage');
  const canViewMembers = can('people.manage') || can('academics.manage');
  const [inviting, setInviting] = useState(false);
  const awaitingDelegation = roles.includes('school_admin') && !hasAny(roles, ['owner', 'principal', 'academic_admin']) && capabilities.length === 0;
  return <AppShell title="People" portal="admin"><main className="page">
    <PageHeader kicker="SCHOOL TEAM" title="People" description="Everyone with access to this school, and the invitations waiting to be accepted."
      action={canManage ? <Button onClick={() => setInviting(true)} testId="button-invite-staff"><UserPlus size={16} /> Invite staff</Button> : undefined} />
    {awaitingDelegation
      ? <section className="panel"><EmptyState icon={ShieldCheck} title="No management access granted yet"
          text="Your school owner has not assigned you any management capabilities. Ask them to open People, choose your membership and grant the areas you should manage." /></section>
      : <MembersPanel canManage={canManage} canViewMembers={canViewMembers} />}
    {canManage && <InvitationsPanel />}
    {inviting && <InviteStaffModal close={() => setInviting(false)} />}
  </main></AppShell>;
}

function MembersPanel({ canManage, canViewMembers }: { canManage: boolean; canViewMembers: boolean }) {
  const { me, roles } = useSession();
  const members = useListMembers({ query: { enabled: canViewMembers } });
  const isOwner = roles.includes('owner');
  return <section className="panel records-panel"><div className="panel-heading"><h2>Members</h2></div>
    {!canViewMembers ? <EmptyState icon={ShieldCheck} title="Members are managed by the school owner" text="Ask the owner to grant you the People & invitations capability to see and manage this list." />
      : members.isLoading ? <LoadingBlock label="Loading school members" /> : members.isError ? <ErrorState message={apiMessage(members.error, 'Members could not be loaded.')} retry={() => members.refetch()} />
      : !members.data?.length ? <EmptyState icon={Users} title="No members yet" text="People appear here once they accept an invitation." />
      : <div className="table-wrap"><table className="data-table"><thead><tr><th>PERSON</th><th>ROLE</th><th>JOINED</th><th>STATUS</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>
        {members.data.map((m) => <MemberRow key={m.membershipId} member={m} canChange={canManage && m.authUserId !== me.authUserId && (m.role !== 'owner' || isOwner)} showActions={canManage} isOwner={isOwner} isSelf={m.authUserId === me.authUserId} />)}
      </tbody></table></div>}
  </section>;
}

function MemberRow({ member, canChange, showActions, isOwner, isSelf }: { member: Member; canChange: boolean; showActions: boolean; isOwner: boolean; isSelf: boolean }) {
  const update = useUpdateMember();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [editingAccess, setEditingAccess] = useState(false);
  const next = member.status === 'active' ? 'suspended' : 'active';
  const name = member.fullName || member.email || 'Member';
  const canDelegate = isOwner && !isSelf && member.role === 'school_admin';
  return <tr data-testid={`row-member-${member.membershipId}`}>
    <td><div className="student-cell"><span className="student-initial">{name[0].toUpperCase()}</span><span><b>{name}{isSelf ? ' (you)' : ''}</b><small>{member.email || 'No email on profile'}</small></span></div>{error && <small className="inline-error" role="alert">{error}</small>}</td>
    <td>{ROLE_LABELS[member.role]}
      {isOwner && member.role === 'school_admin' && <small className="capability-chips" data-testid={`capabilities-${member.membershipId}`}>
        {member.capabilities.length === 0 ? 'No capabilities granted'
          : member.capabilities.map((c) => CAPABILITY_LABELS[c]).join(' · ')}
      </small>}
    </td>
    <td>{formatDate(member.createdAt)}</td>
    <td><StatusBadge status={member.status} /></td>
    {showActions && <td>
      {canDelegate && <button className="text-button" data-testid={`button-member-access-${member.membershipId}`} onClick={() => setEditingAccess(true)}>Access</button>}
      {canChange && <button className="text-button" disabled={update.isPending} data-testid={`button-member-status-${member.membershipId}`} onClick={() => {
        if (next === 'suspended' && !window.confirm(`Suspend ${name}'s ${ROLE_LABELS[member.role].toLowerCase()} access? They will lose access to this school until reactivated.`)) return;
        setError('');
        update.mutate({ membershipId: member.membershipId, data: { status: next } }, {
          onSuccess: () => { void client.invalidateQueries({ queryKey: getListMembersQueryKey() }); },
          onError: (e) => setError(apiMessage(e, 'Access could not be changed.')),
        });
      }}>{next === 'suspended' ? 'Suspend' : 'Reactivate'}</button>}
      {editingAccess && <CapabilitiesModal member={member} close={() => setEditingAccess(false)} />}
    </td>}
  </tr>;
}

function CapabilitiesModal({ member, close }: { member: Member; close: () => void }) {
  const save = useSetMemberCapabilities();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<SchoolCapability>>(() => new Set(member.capabilities));
  const name = member.fullName || member.email || 'this administrator';
  function toggle(key: SchoolCapability) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const capabilities = DELEGABLE_CAPABILITIES.filter((c) => selected.has(c.key)).map((c) => c.key);
    // Never drop grants that are not delegable in this UI (permanent deletion, unbuilt modules).
    for (const cap of member.capabilities) if (!capabilities.includes(cap) && !DELEGABLE_CAPABILITIES.some((d) => d.key === cap)) capabilities.push(cap);
    save.mutate({ membershipId: member.membershipId, data: { capabilities } }, {
      onSuccess: () => { void client.invalidateQueries({ queryKey: getListMembersQueryKey() }); close(); },
      onError: (e) => setError(apiMessage(e, 'Capabilities could not be saved.')),
    });
  }
  return <Modal kicker="DELEGATED ACCESS" title={`Management access for ${name}`}
    subtitle="Choose exactly what this co-administrator can manage. Changes apply immediately and are recorded in the audit log." close={close}>
    <form className="modal-form" onSubmit={submit}>
      <div className="capability-list">
        {DELEGABLE_CAPABILITIES.map((c) => <label key={c.key} className="capability-option">
          <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} data-testid={`capability-${c.key}`} />
          <span><b>{c.label}</b><small>{c.description}</small></span>
        </label>)}
      </div>
      <p className="muted-note">Owners always have full access. Principals and academic administrators keep their standard academic duties regardless of these grants.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button kind="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={save.isPending} testId="button-save-capabilities">{save.isPending ? 'Saving…' : 'Save access'}</Button></div>
    </form>
  </Modal>;
}

function InvitationsPanel() {
  const invitations = useListInvitations();
  return <section className="panel records-panel"><div className="panel-heading"><h2>Invitations</h2></div>
    {invitations.isLoading ? <LoadingBlock label="Loading invitations" /> : invitations.isError ? <ErrorState message={apiMessage(invitations.error, 'Invitations could not be loaded.')} retry={() => invitations.refetch()} />
      : !invitations.data?.length ? <EmptyState icon={MailPlus} title="No invitations yet" text="Invite staff here. Parent and learner invitations start from a student’s record." />
      : <div className="table-wrap"><table className="data-table"><thead><tr><th>EMAIL</th><th>ROLE</th><th>FOR</th><th>EXPIRES</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {invitations.data.map((inv) => <InvitationRow key={inv.id} invitation={inv} />)}
      </tbody></table></div>}
  </section>;
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const revoke = useRevokeInvitation();
  const client = useQueryClient();
  const [error, setError] = useState('');
  return <tr data-testid={`row-invitation-${invitation.id}`}>
    <td className="mono-cell">{invitation.email}{error && <small className="inline-error" role="alert">{error}</small>}</td>
    <td>{ROLE_LABELS[invitation.role]}</td>
    <td>{invitation.studentName || invitation.guardianName || <span className="muted-cell">—</span>}</td>
    <td>{formatDate(invitation.expiresAt)}</td>
    <td><StatusBadge status={invitation.status} /></td>
    <td>{invitation.status === 'pending' && <button className="text-button" disabled={revoke.isPending} onClick={() => {
      if (!window.confirm(`Revoke the invitation for ${invitation.email}? The link will stop working.`)) return;
      setError('');
      revoke.mutate({ invitationId: invitation.id }, {
        onSuccess: () => { void client.invalidateQueries({ queryKey: getListInvitationsQueryKey() }); },
        onError: (e) => setError(apiMessage(e, 'The invitation could not be revoked.')),
      });
    }}>Revoke</button>}</td>
  </tr>;
}

function InviteStaffModal({ close }: { close: () => void }) {
  const { roles } = useSession();
  const create = useCreateInvitation();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const options = roles.includes('owner') ? ['owner' as SchoolRole, ...STAFF_INVITE_ROLES] : STAFF_INVITE_ROLES;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const f = new FormData(event.currentTarget);
    create.mutate({ data: { email: String(f.get('email')).trim(), role: String(f.get('role')) as SchoolRole } }, {
      onSuccess: (result) => { setCreated(result); void client.invalidateQueries({ queryKey: getListInvitationsQueryKey() }); },
      onError: (e) => setError(apiMessage(e, 'The invitation could not be created.')),
    });
  }
  return <Modal kicker="SCHOOL TEAM" title="Invite a staff member" subtitle="They join this school with the role you choose once they accept." close={close}>
    {created ? <><InviteLink acceptPath={created.acceptPath} email={created.invitation.email} /><div className="modal-actions"><Button kind="outline" onClick={close}>Done</Button></div></> :
    <form className="modal-form" onSubmit={submit}>
      <div className="form-row"><label className="field"><span>Email address <b>*</b></span><input type="email" name="email" required maxLength={254} data-testid="input-staff-email" /></label>
        <label className="field"><span>Role <b>*</b></span><select name="role" required defaultValue="teacher" data-testid="select-staff-role">{options.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label></div>
      <p className="muted-note">They must sign in with this email address to accept. Tushciemat does not send email yet, so you will get a link to share with them yourself.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button kind="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={create.isPending} testId="button-create-staff-invite">{create.isPending ? 'Creating…' : 'Create invitation link'}</Button></div>
    </form>}
  </Modal>;
}
