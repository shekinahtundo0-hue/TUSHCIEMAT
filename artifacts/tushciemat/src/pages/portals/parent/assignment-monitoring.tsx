import type { LearnerSummary } from '@workspace/api-client-react';
import './parent-pages.css';

interface AssignmentMonitoringProps {
  child: LearnerSummary;
}

// The API has no guardian assignment endpoint yet (listAssignments is student-only),
// so this view states the gap honestly instead of showing data it cannot load.
export const AssignmentMonitoring = ({ child }: AssignmentMonitoringProps) => {
  return (
    <div className="assignments-section">
      <div className="page-header">
        <h1>{child.firstName}&apos;s Assignments</h1>
        <p>Monitor assignment deadlines and submission status (read-only)</p>
      </div>

      <div style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        padding: '40px 20px',
        textAlign: 'center',
        color: '#6b7280',
        marginBottom: '16px',
      }}>
        <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#374151' }}>
          Assignment monitoring is not yet available for parents
        </p>
        <p style={{ margin: '8px 0 0 0', fontSize: '14px', lineHeight: 1.6 }}>
          The school system does not currently share assignment records with parent accounts.
          Ask {child.firstName} to show their assignments from the student portal, or contact the
          class teacher for updates on upcoming deadlines.
        </p>
      </div>

      <div style={{
        background: '#f0fdf4',
        border: '1px solid #d1fae5',
        borderRadius: '8px',
        padding: '16px',
        color: '#065f46',
      }}>
        <strong>Privacy Notice</strong>
        <p style={{ margin: '8px 0 0 0', fontSize: '14px' }}>
          When this view becomes available, it will be read-only. Detailed assignment content and
          feedback remain visible to {child.firstName} only to encourage independent learning.
        </p>
      </div>
    </div>
  );
};