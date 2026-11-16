import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Megaphone } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getListAnnouncementsQueryKey, getListNotificationsQueryKey, useListAnnouncements,
  useListNotifications, useMarkNotificationRead, usePublishAnnouncement,
  type Notification,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/shell';
import { apiMessage, formatDate } from '@/lib/api';
import { MANAGERS, hasAny, portalsFor, type PortalKey } from '@/lib/roles';
import { useSession } from '@/lib/session';

export function NotificationsPage() {
  const notifications = useListNotifications({ query: { refetchInterval: 30_000 } });
  const unread = notifications.data?.filter((n) => !n.readAt).length ?? 0;
  return <AppShell title="Notifications" portal={null}><main className="page entry-page">
    <PageHeader kicker="YOUR ACCOUNT" title="Notifications" description="Your access updates and school announcements. This inbox is available even before you join a school." action={<Link href="/home" className="button button-outline">Back to workspace</Link>} />
    {notifications.data && <p className="muted-note inbox-count" role="status">{unread} unread in your inbox</p>}
    {notifications.isLoading ? <LoadingBlock label="Loading your notifications" /> : notifications.isError ? <ErrorState message={apiMessage(notifications.error, 'Notifications could not be loaded.')} retry={() => { void notifications.refetch(); }} /> : !notifications.data?.length ? <EmptyState icon={Bell} title="No notifications yet" text="School decisions and announcements addressed to your account will appear here." /> : <div className="request-list">{notifications.data.map((notification) => <NotificationCard key={notification.id} notification={notification} />)}</div>}
  </main></AppShell>;
}

function NotificationCard({ notification: n }: { notification: Notification }) {
  const { me, refreshMe, switchSchool } = useSession();
  const [, setLocation] = useLocation(); const client = useQueryClient(); const mark = useMarkNotificationRead();
  const [error, setError] = useState(''); const [opening, setOpening] = useState(false);
  const membership = me.schools.find((s) => s.schoolId === n.schoolId);
  const managerRequest = n.type === 'request.submitted' && membership && hasAny(membership.roles, MANAGERS);
  const myRequest = n.type === 'request.approved' || n.type === 'request.rejected';
  const announcementPortal = n.type === 'announcement.published' && membership ? portalsFor(membership.roles)[0] : undefined;
  async function openSchoolUpdate() {
    setError(''); setOpening(true);
    try {
      const fresh = await refreshMe();
      const active = fresh?.schools.find((s) => s.schoolId === n.schoolId);
      if (!active) { setError('You no longer have active access to this school. Your notification remains here, but the school page cannot be opened.'); return; }
      const portal = portalsFor(active.roles)[0];
      if (n.type === 'request.submitted' && !hasAny(active.roles, MANAGERS)) { setError('Only a school owner or administrator can review these requests.'); return; }
      if (n.type === 'announcement.published' && !portal) { setError('No active school portal was returned for this account.'); return; }
      switchSchool(n.schoolId);
      setLocation(n.type === 'request.submitted' ? '/admin/requests' : `/${portal}/announcements`);
    } catch (e) { setError(apiMessage(e, 'Your access could not be checked. Try again.')); }
    finally { setOpening(false); }
  }
  return <article className={`panel notification-card ${!n.readAt ? 'is-unread' : ''}`}>
    <div className="section-with-action"><h2>{n.title}</h2>{!n.readAt && <span className="unread-label">Unread</span>}</div><p className="muted-note">{formatDate(n.createdAt)}{membership ? ` · ${membership.schoolName}` : ''}</p><p className="announcement-body">{n.body}</p>
    <div className="notification-actions">
      {myRequest && <Link href="/onboarding/requests" className="button button-outline">View my requests</Link>}
      {(managerRequest || announcementPortal) && <Button kind="outline" disabled={opening} onClick={() => { void openSchoolUpdate(); }}>{opening ? 'Checking access…' : managerRequest ? 'Review school requests' : 'Read school announcements'}</Button>}
      {!n.readAt && <Button kind="quiet" disabled={mark.isPending} onClick={() => {
        setError(''); mark.mutate({ notificationId: n.id }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getListNotificationsQueryKey() }); }, onError: (e) => setError(apiMessage(e, 'The notification could not be marked read.')) });
      }}>{mark.isPending ? 'Marking read…' : 'Mark as read'}</Button>}
    </div>
    {!myRequest && !managerRequest && !announcementPortal && (n.type === 'request.submitted' || n.type === 'announcement.published') && <p className="muted-note">The school page is not available with your current active access.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </article>;
}

export function AnnouncementsPage({ portal }: { portal: PortalKey }) {
  const { school, roles } = useSession();
  const canPublish = portal === 'admin' && hasAny(roles, MANAGERS);
  return <AppShell title="Announcements" portal={portal}><main className="page">
    <PageHeader kicker="SCHOOL NOTICES" title="Announcements" description={`Updates from ${school?.schoolName || 'your school'}. ${canPublish ? 'Published notices are shared with active school members.' : 'Read the notices published by your school administrators.'}`} />
    {school && <SchoolAnnouncements key={school.schoolId} canPublish={canPublish} />}
  </main></AppShell>;
}

function SchoolAnnouncements({ canPublish }: { canPublish: boolean }) {
  const { school } = useSession();
  const announcements = useListAnnouncements({ query: { enabled: !!school } });
  const publish = usePublishAnnouncement(); const client = useQueryClient();
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const form = event.currentTarget; const f = new FormData(form);
    const title = String(f.get('title') ?? '').trim(); const body = String(f.get('body') ?? '').trim();
    if (title.length < 2 || !body) { setError('Enter a title of at least 2 characters and a message.'); return; }
    try {
      await publish.mutateAsync({ data: { title, body } }); form.reset(); setNotice('Announcement published.');
      await Promise.all([client.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() }), client.invalidateQueries({ queryKey: getListNotificationsQueryKey() })]);
    } catch (e) { setError(apiMessage(e, 'The announcement could not be published.')); }
  }
  return <div className="announcements-layout">
    {canPublish && <form className="panel modal-form announcement-form" onSubmit={submit}><h2>Publish announcement</h2><label className="field"><span>Title <b>*</b></span><input name="title" required minLength={2} maxLength={160} /></label><label className="field"><span>Message <b>*</b></span><textarea name="body" required maxLength={5000} rows={6} /></label><p className="muted-note">Check your message before publishing. Editing and deleting published notices are not available.</p>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}<Button type="submit" disabled={publish.isPending}>{publish.isPending ? 'Publishing…' : 'Publish announcement'}</Button></form>}
    <section aria-label="Published announcements">{announcements.isLoading ? <LoadingBlock label="Loading school announcements" /> : announcements.isError ? <ErrorState message={apiMessage(announcements.error, 'Announcements could not be loaded.')} retry={() => { void announcements.refetch(); }} /> : !announcements.data?.length ? <EmptyState icon={Megaphone} title="No announcements yet" text={canPublish ? 'Publish the first notice for your school using the form above.' : 'Notices will appear here when your school publishes them.'} /> : <div className="request-list">{announcements.data.map((a) => <article key={a.id} id={`announcement-${a.id}`} className="panel announcement-card"><h2>{a.title}</h2><p className="muted-note">Published {formatDate(a.createdAt)}</p><p className="announcement-body">{a.body}</p></article>)}</div>}</section>
  </div>;
}
