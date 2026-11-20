import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useListMyChildren, type LearnerSummary } from '@workspace/api-client-react';
import { AppShell, EmptyState, ErrorState, LoadingBlock } from '@/components/shell';
import { apiMessage } from '@/lib/api';
import { UserRound } from 'lucide-react';
import { FamilyDashboard } from './parent/family-dashboard';
import { AcademicMonitoring } from './parent/academic-monitoring';
import { AttendanceMonitoring } from './parent/attendance-monitoring';
import { AssignmentMonitoring } from './parent/assignment-monitoring';
import { CommunicationCentre } from './parent/communication-centre';
import { ChildManagement } from './parent/child-management';

export const FamilyPage = () => {
  const [location] = useLocation();
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const children = useListMyChildren();
  const linkedChildren: LearnerSummary[] = children.data ?? [];

  useEffect(() => {
    if (!selectedChildId && linkedChildren.length > 0) {
      setSelectedChildId(linkedChildren[0].studentId);
    }
  }, [linkedChildren, selectedChildId]);

  const selectedChild = linkedChildren.find((c) => c.studentId === selectedChildId) ?? null;

  const renderContent = () => {
    if (location.startsWith('/family/children')) return <ChildManagement children={linkedChildren} />;
    if (!selectedChild) {
      return <EmptyState icon={UserRound} title="No learners linked yet" text="Your school links learners to your guardian record. Ask the school office if a child is missing." />;
    }
    if (location.startsWith('/family/academic')) return <AcademicMonitoring child={selectedChild} />;
    if (location.startsWith('/family/attendance')) return <AttendanceMonitoring child={selectedChild} />;
    if (location.startsWith('/family/assignments')) return <AssignmentMonitoring child={selectedChild} />;
    if (location.startsWith('/family/communications')) return <CommunicationCentre child={selectedChild} />;
    return <FamilyDashboard child={selectedChild} />;
  };

  return (
    <AppShell title="Family Portal" portal="family">
      <main className="page">
        {children.isLoading ? (
          <LoadingBlock label="Loading your children’s records" />
        ) : children.isError ? (
          <ErrorState message={apiMessage(children.error, 'Your children’s records could not be loaded.')} retry={() => children.refetch()} />
        ) : (
          <>
            {linkedChildren.length > 1 && !location.startsWith('/family/children') && (
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <label htmlFor="family-child-select" style={{ fontWeight: 600 }}>Viewing:</label>
                <select
                  id="family-child-select"
                  value={selectedChildId ?? ''}
                  onChange={(e) => setSelectedChildId(e.target.value)}
                  style={{ minWidth: 0, maxWidth: '100%', flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', font: 'inherit' }}
                >
                  {linkedChildren.map((child) => (
                    <option key={child.studentId} value={child.studentId}>
                      {child.firstName} {child.lastName} · {child.className || 'No class'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {renderContent()}
          </>
        )}
      </main>
    </AppShell>
  );
};