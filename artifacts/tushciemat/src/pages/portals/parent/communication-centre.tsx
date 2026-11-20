import { useListAnnouncements, type LearnerSummary } from '@workspace/api-client-react';
import { apiMessage } from '@/lib/api';
import './parent-pages.css';

interface CommunicationCentreProps {
  child: LearnerSummary;
}

export const CommunicationCentre = ({ child }: CommunicationCentreProps) => {
  const query = useListAnnouncements();
  const announcements = query.data ?? [];

  return (
    <div className="communications-section">
      <div className="page-header">
        <h1>School Communications for {child.firstName}</h1>
        <p>Important notices and school announcements</p>
      </div>

      {query.isLoading ? (
        <p style={{ color: '#6b7280' }}>Loading announcements…</p>
      ) : query.isError ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#991b1b' }}>
          <p>{apiMessage(query.error, 'Announcements could not be loaded. Please try again.')}</p>
        </div>
      ) : announcements.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: '#9ca3af',
        }}>
          <p style={{ fontSize: '16px', fontWeight: '500' }}>No announcements</p>
        </div>
      ) : (
        <div className="announcements-grid">
          {announcements.map((announcement) => (
            <div key={announcement.id} className="announcement-card">
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600', color: '#1f2937' }}>
                {announcement.title}
              </h3>
              <p className="body">{announcement.body}</p>
              <div className="meta">
                Published: {new Date(announcement.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};