import { useState } from 'react';
import { useLocation } from 'wouter';
import { BookOpen } from 'lucide-react';
import { useGetMyLearnerRecord } from '@workspace/api-client-react';
import { AppShell, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/shell';
import { apiMessage, apiStatus } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PortalNav } from '@/components/portals/PortalNav';
import Dashboard from './student/dashboard';
import LearningCentre from './student/learning-centre';
import AssignmentsHub from './student/assignments';
import ResultsViewer from './student/results';
import Timetable from './student/timetable';
import Profile from './student/profile';
import { AnnouncementsPage } from '@/pages/communications';

export function LearnPage() {
  const record = useGetMyLearnerRecord({ query: { retry: (count, error) => apiStatus(error) !== 404 && count < 2 } });
  const [location, navigate] = useLocation();
  const { me, school } = useSession();

  // Parse the current route to determine which sub-page to show
  const getRoutePath = () => {
    if (location.startsWith('/learn/learning')) return 'learning';
    if (location.startsWith('/learn/assignments')) return 'assignments';
    if (location.startsWith('/learn/results')) return 'results';
    if (location.startsWith('/learn/timetable')) return 'timetable';
    if (location.startsWith('/learn/announcements')) return 'announcements';
    if (location.startsWith('/learn/profile')) return 'profile';
    return 'dashboard';
  };

  const currentRoute = getRoutePath();
  const isLoading = record.isLoading;
  const isError = record.isError;
  const isNotFound = apiStatus(record.error) === 404;

  return (
    <AppShell title="My Learning" portal="learn">
      <main className="page">
        <PageHeader 
          kicker="LEARNER PORTAL" 
          title="My Learning"
          description={`${me?.firstName || 'Student'} • Admission #${record.data?.admissionNumber || '-'} • ${school?.schoolName || 'Your School'}`}
        />

        {isLoading ? (
          <LoadingBlock label="Loading your learning portal" />
        ) : isNotFound ? (
          <EmptyState 
            icon={BookOpen} 
            title="Your record isn't linked yet" 
            text="Your account is not connected to a learner record at this school. Ask the school office for help."
          />
        ) : isError || !record.data ? (
          <ErrorState 
            message={apiMessage(record.error, 'Your learning portal could not be loaded.')} 
            retry={() => record.refetch()}
          />
        ) : (
          <div className="portal-layout">
            <nav className="portal-nav">
              <PortalNav portal="learn" currentRoute={currentRoute} navigate={navigate} />
            </nav>
            
            <div className="portal-content">
              {currentRoute === 'dashboard' && <Dashboard studentData={record.data} />}
              {currentRoute === 'learning' && <LearningCentre studentData={record.data} />}
              {currentRoute === 'assignments' && <AssignmentsHub studentData={record.data} />}
              {currentRoute === 'results' && <ResultsViewer studentData={record.data} />}
              {currentRoute === 'timetable' && <Timetable studentData={record.data} />}
              {currentRoute === 'announcements' && <AnnouncementsPage portal="learn" />}
              {currentRoute === 'profile' && <Profile studentData={record.data} />}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
