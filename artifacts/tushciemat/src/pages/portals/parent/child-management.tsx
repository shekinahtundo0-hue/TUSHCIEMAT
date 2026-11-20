import type { LearnerSummary } from '@workspace/api-client-react';
import { useSession } from '@/lib/session';
import './parent-pages.css';

interface ChildManagementProps {
  children: LearnerSummary[];
}

export const ChildManagement = ({ children }: ChildManagementProps) => {
  const { school } = useSession();

  return (
    <div>
      <div className="page-header">
        <h1>My Children</h1>
        <p>Manage verified child relationships</p>
      </div>

      {children.length === 0 ? (
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '40px 20px',
          textAlign: 'center',
          color: '#9ca3af',
        }}>
          <p>No linked children yet</p>
        </div>
      ) : (
        <div className="children-list">
          {children.map((child) => (
            <div key={child.studentId} className="child-card">
              <div className="header">
                <div className="avatar">{child.firstName[0]}{child.lastName[0]}</div>
                <div className="info">
                  <h3>{child.firstName} {child.lastName}</h3>
                  <p className="admission">Adm#: {child.admissionNumber}</p>
                </div>
              </div>
              <div className="details">
                <div className="detail-item">
                  <span className="label">School</span>
                  <span className="value">{school?.schoolName ?? '—'}</span>
                </div>
                <div className="detail-item">
                  <span className="label">Class</span>
                  <span className="value">{child.className ?? 'Not assigned'}</span>
                </div>
                <div className="detail-item">
                  <span className="label">Status</span>
                  <span className="value">
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 6px',
                      background: child.status === 'active' ? '#d1fae5' : '#fef3c7',
                      color: child.status === 'active' ? '#065f46' : '#92400e',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                    }}>
                      {child.status}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{
        background: '#f0fdf4',
        border: '1px solid #d1fae5',
        borderRadius: '12px',
        padding: '20px',
        marginTop: '24px',
        color: '#065f46',
      }}>
        <strong>About Child Linking</strong>
        <p style={{ margin: '8px 0 0 0', fontSize: '14px', lineHeight: '1.6' }}>
          Child relationships must be verified by school administration.
          If you need to add another child or believe there&apos;s an error, contact your school.
        </p>
      </div>
    </div>
  );
};