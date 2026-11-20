import { useLocation } from 'wouter';
import {
  useListChildResults,
  useListAnnouncements,
  type LearnerSummary,
} from '@workspace/api-client-react';
import { useSession } from '@/lib/session';
import { apiMessage } from '@/lib/api';
import './parent-pages.css';

interface FamilyDashboardProps {
  child: LearnerSummary;
}

function attendancePercentage(child: LearnerSummary): number | null {
  const { present, absent, late, excused } = child.attendance;
  const marked = present + absent + late + excused;
  if (marked === 0) return null;
  return Math.round(((present + late) / marked) * 100);
}

export const FamilyDashboard = ({ child }: FamilyDashboardProps) => {
  const { school } = useSession();
  const [, navigate] = useLocation();

  const resultsQuery = useListChildResults(child.studentId);
  const results = resultsQuery.data?.data ?? [];
  const announcementsQuery = useListAnnouncements();
  const announcements = announcementsQuery.data ?? [];
  if (resultsQuery.isLoading || announcementsQuery.isLoading) {
    return <div className="family-dashboard" role="status">Loading your dashboard...</div>;
  }
  const error = resultsQuery.error ?? announcementsQuery.error;
  if (error) return <div className="family-dashboard" role="alert">{apiMessage(error, 'Unable to load your dashboard.')}</div>;

  const gradedMarks = results.filter((r) => r.marksObtained !== null && r.maxMarks > 0);
  const average = gradedMarks.length > 0
    ? Math.round(gradedMarks.reduce((sum, r) => sum + (r.marksObtained! / r.maxMarks) * 100, 0) / gradedMarks.length)
    : null;
  const attendance = attendancePercentage(child);

  return (
    <div className="family-dashboard">
      <div className="page-header">
        <h1>Family Portal</h1>
        <p>Welcome to {child.firstName}'s school information dashboard</p>
      </div>

      <div className="child-info-card">
        <div className="info-content">
          <div className="avatar">{child.firstName[0]}{child.lastName[0]}</div>
          <div>
            <h2>{child.firstName} {child.lastName}</h2>
            <p className="admission">Admission #: {child.admissionNumber}</p>
            <p className="class">{child.className || 'No class assigned'} {school?.schoolName ? `• ${school.schoolName}` : ''}</p>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3>Academic Overview</h3>
          <div className="stats">
            <div className="stat">
              <span className="label">Average Performance</span>
              <span className="value">{average !== null ? `${average}%` : '—'}</span>
            </div>
            <div className="stat">
              <span className="label">Attendance</span>
              <span className="value">{attendance === null ? '—' : `${attendance}%`}</span>
            </div>
            <div className="stat">
              <span className="label">Published Marks</span>
              <span className="value">{results.length}</span>
            </div>
          </div>
        </div>

        <div className="card alert-card">
          <h3>Attention Required</h3>
          {attendance !== null && attendance < 85 && (
            <div className="alert">
              <span>Attendance below 85%</span>
              <button onClick={() => navigate('/family/attendance')} className="link-btn">View</button>
            </div>
          )}
          {results.length > 0 && (
            <div className="alert">
              <span>Published results available</span>
              <button onClick={() => navigate('/family/academic')} className="link-btn">View</button>
            </div>
          )}
          {announcements.length > 0 && (
            <div className="alert">
              <span>School announcements</span>
              <button onClick={() => navigate('/family/communications')} className="link-btn">View</button>
            </div>
          )}
          {attendance === null && <p className="empty">No attendance recorded yet.</p>}
          {results.length === 0 && announcements.length === 0 && attendance !== null && attendance >= 85 && (
            <p className="empty">All monitored items are in good standing</p>
          )}
        </div>

        <div className="card">
          <h3>Recent Communications</h3>
          {announcements.length === 0 ? (
            <p className="empty">No recent announcements</p>
          ) : (
            <div className="announcements-list">
              {announcements.slice(0, 3).map((a) => (
                <div key={a.id} className="announcement-item">
                  <p className="title">{a.title}</p>
                  <p className="date">{new Date(a.createdAt).toLocaleDateString()}</p>
                </div>
              ))}
              {announcements.length > 3 && (
                <button onClick={() => navigate('/family/communications')} className="view-more-btn">
                  View all communications
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="quick-actions">
        <h3>Quick Access</h3>
        <div className="action-buttons">
          <button onClick={() => navigate('/family/academic')} className="action-btn">Academic Record</button>
          <button onClick={() => navigate('/family/attendance')} className="action-btn">Attendance</button>
          <button onClick={() => navigate('/family/assignments')} className="action-btn">Assignments</button>
          <button onClick={() => navigate('/family/communications')} className="action-btn">Communications</button>
        </div>
      </div>
    </div>
  );
};