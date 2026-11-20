import { useLocation } from 'wouter';
import { AppShell } from '@/components/shell';
import { StudentDashboard } from './student/dashboard';
import { LearningCentre } from './student/learning-centre';
import { AssignmentsHub } from './student/assignments';
import { ResultsViewer } from './student/results';
import { TimetablePage } from './student/timetable';
import { StudentProfile } from './student/profile';

export const LearnPage = () => {
  const [location] = useLocation();

  const renderContent = () => {
    if (location.startsWith('/learn/learning')) return <LearningCentre />;
    if (location.startsWith('/learn/assignments')) return <AssignmentsHub />;
    if (location.startsWith('/learn/results')) return <ResultsViewer />;
    if (location.startsWith('/learn/timetable')) return <TimetablePage />;
    if (location.startsWith('/learn/profile')) return <StudentProfile />;
    return <StudentDashboard />;
  };

  return (
    <AppShell title="My Learning" portal="learn">
      <main className="page">{renderContent()}</main>
    </AppShell>
  );
};