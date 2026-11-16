import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { useListMyJoinRequests, type SchoolRole } from '@workspace/api-client-react';
import { AppLoading, AppShell, ErrorState, basePath } from '@/components/shell';
import { ErrorBoundary } from '@/components/error-boundary';
import { apiMessage } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { GUARDIAN_VIEWERS, MANAGERS, STAFF, hasAny, homePathFor } from '@/lib/roles';
import { SessionProvider, pendingInvite, useSession } from '@/lib/session';
import { AcceptInviteSignedIn, AcceptInviteSignedOut } from '@/pages/accept-invite';
import { AttendancePage } from '@/pages/attendance';
import { CalendarPage } from '@/pages/calendar';
import { ClassesPage } from '@/pages/classes';
import { AnnouncementsPage, NotificationsPage } from '@/pages/communications';
import { CreateSchoolPage, FindSchoolPage, JoinSchoolPage, OnboardingPage } from '@/pages/onboarding';
import { OverviewPage } from '@/pages/overview';
import { PeoplePage } from '@/pages/people';
import { FamilyPage, LearnPage, PlatformPage } from '@/pages/portals';
import { LandingPage, LandingSkeleton, NotFound, SignInPage, SignUpPage, VerifyEmailPage } from '@/pages/public';
import { AccessRequestsPage, MyRequestsPage } from '@/pages/requests';
import { SchoolSettingsPage } from '@/pages/school-settings';
import { StudentsPage } from '@/pages/students';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Signed({ children }: { children: ReactNode }) {
  return <SessionProvider loading={<AppLoading />} failed={(error, retry) => <main className="page"><ErrorState message={apiMessage(error, 'Your account could not be loaded. Please check your connection and try again.')} retry={retry} /></main>}>{children}</SessionProvider>;
}

function AuthGate({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  if (!ready) return <AppLoading />;
  return user ? <Signed>{children}</Signed> : <Redirect to="/" />;
}

function HomeRedirect() {
  const { ready, user } = useAuth();
  if (!ready) return <LandingSkeleton />;
  return user ? <Redirect to="/home" /> : <LandingPage />;
}

function HomeResolver() {
  const { me, roles } = useSession();
  const invitation = pendingInvite.get();
  const portal = homePathFor(roles);
  const needsSchool = !portal && !me.platformRole && me.schools.length === 0 && !invitation;
  const requests = useListMyJoinRequests({ query: { enabled: needsSchool, staleTime: 0 } });
  if (invitation) return <Redirect to="/accept-invite" replace />;
  if (portal || me.platformRole) return <Redirect to={portal ?? '/platform'} replace />;
  if (needsSchool && (requests.isLoading || requests.isFetching)) return <AppLoading />;
  if (needsSchool && requests.isError) return <AppShell title="School access" portal={null}><main className="page"><ErrorState message={apiMessage(requests.error, 'Your school access requests could not be checked.')} retry={() => { void requests.refetch(); }} /></main></AppShell>;
  return <Redirect to={requests.data?.some((r) => r.status === 'pending') ? '/onboarding/requests' : '/onboarding'} replace />;
}

function AcceptInviteRoute() {
  const { ready, user } = useAuth();
  if (!ready) return <AppLoading />;
  return user ? <Signed><AcceptInviteSignedIn /></Signed> : <AcceptInviteSignedOut />;
}

// The API enforces every role check; this only keeps people out of screens that would just fail.
function Guard({ roles: allowed = [], platform = false, children }: { roles?: readonly SchoolRole[]; platform?: boolean; children: ReactNode }) {
  const { me, roles } = useSession();
  const permitted = platform ? !!me.platformRole : hasAny(roles, allowed);
  return permitted ? <>{children}</> : <Redirect to="/home" replace />;
}

function Protected({ roles, platform, children }: { roles?: readonly SchoolRole[]; platform?: boolean; children: ReactNode }) {
  return <AuthGate><Guard roles={roles} platform={platform}>{children}</Guard></AuthGate>;
}

function Routes() {
  return <Switch>
    <Route path="/" component={HomeRedirect} />
    <Route path="/sign-in" component={SignInPage} />
    <Route path="/sign-up" component={SignUpPage} />
    <Route path="/verify-email" component={VerifyEmailPage} />
    <Route path="/accept-invite" component={AcceptInviteRoute} />
    <Route path="/home"><AuthGate><HomeResolver /></AuthGate></Route>
    <Route path="/onboarding"><AuthGate><OnboardingPage /></AuthGate></Route>
    <Route path="/onboarding/find"><AuthGate><FindSchoolPage /></AuthGate></Route>
    <Route path="/onboarding/create"><AuthGate><CreateSchoolPage /></AuthGate></Route>
    <Route path="/onboarding/join/:schoolId">{(params) => <AuthGate><JoinSchoolPage schoolId={params.schoolId} /></AuthGate>}</Route>
    <Route path="/onboarding/requests"><AuthGate><MyRequestsPage /></AuthGate></Route>
    <Route path="/notifications"><AuthGate><NotificationsPage /></AuthGate></Route>

    <Route path="/admin"><Protected roles={STAFF}><OverviewPage /></Protected></Route>
    <Route path="/admin/students"><Protected roles={GUARDIAN_VIEWERS}><StudentsPage portal="admin" /></Protected></Route>
    <Route path="/admin/classes"><Protected roles={STAFF}><ClassesPage portal="admin" /></Protected></Route>
    <Route path="/admin/attendance"><Protected roles={STAFF}><AttendancePage portal="admin" /></Protected></Route>
    <Route path="/admin/calendar"><Protected roles={GUARDIAN_VIEWERS}><CalendarPage /></Protected></Route>
    <Route path="/admin/people"><Protected roles={STAFF}><PeoplePage /></Protected></Route>
    <Route path="/admin/requests"><Protected roles={MANAGERS}><AccessRequestsPage /></Protected></Route>
    <Route path="/admin/settings"><Protected roles={MANAGERS}><SchoolSettingsPage /></Protected></Route>
    <Route path="/admin/announcements"><Protected roles={GUARDIAN_VIEWERS}><AnnouncementsPage portal="admin" /></Protected></Route>

    <Route path="/teach"><Protected roles={['teacher', 'tutor']}><ClassesPage portal="teach" /></Protected></Route>
    <Route path="/teach/attendance"><Protected roles={['teacher']}><AttendancePage portal="teach" /></Protected></Route>
    <Route path="/teach/students"><Protected roles={['teacher']}><StudentsPage portal="teach" /></Protected></Route>
    <Route path="/teach/announcements"><Protected roles={['teacher', 'tutor']}><AnnouncementsPage portal="teach" /></Protected></Route>

    <Route path="/family"><Protected roles={['parent']}><FamilyPage /></Protected></Route>
    <Route path="/family/announcements"><Protected roles={['parent']}><AnnouncementsPage portal="family" /></Protected></Route>
    <Route path="/learn"><Protected roles={['student']}><LearnPage /></Protected></Route>
    <Route path="/learn/announcements"><Protected roles={['student']}><AnnouncementsPage portal="learn" /></Protected></Route>
    <Route path="/platform"><Protected platform><PlatformPage /></Protected></Route>

    <Route component={NotFound} />
  </Switch>;
}

// Clears a caught page error when the route changes, so navigation recovers without a manual reload.
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

export default function App() {
  return <WouterRouter base={basePath}>
    <QueryClientProvider client={queryClient}>
      <AuthProvider><RoutedErrorBoundary><Routes /></RoutedErrorBoundary></AuthProvider>
    </QueryClientProvider>
  </WouterRouter>;
}
