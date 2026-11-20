import type { LearnerSummary } from '@workspace/api-client-react';
import './parent-pages.css';

interface AttendanceMonitoringProps {
  child: LearnerSummary;
}

const STATUS_LABELS: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Excused',
};

const STATUS_COLORS: Record<string, { background: string; color: string }> = {
  present: { background: '#d1fae5', color: '#065f46' },
  absent: { background: '#fee2e2', color: '#991b1b' },
  late: { background: '#fef3c7', color: '#92400e' },
  excused: { background: '#e0e7ff', color: '#3730a3' },
};

export const AttendanceMonitoring = ({ child }: AttendanceMonitoringProps) => {
  const attendance = child.attendance;
  const markedDays = attendance.present + attendance.absent + attendance.late + attendance.excused;
  const percentage = markedDays > 0
    ? Math.round(((attendance.present + attendance.late) / markedDays) * 100)
    : null;
  const lowAttendance = percentage !== null && percentage < 85;

  return (
    <div className="attendance-section">
      <div className="page-header">
        <h1>{child.firstName}&apos;s Attendance</h1>
        <p>Monitor attendance and absence patterns</p>
      </div>

      <div className="attendance-summary">
        <div className="summary-card">
          <span className="label">Overall Attendance</span>
          <span className="value" style={lowAttendance ? { color: '#ef4444' } : undefined}>
            {percentage !== null ? `${percentage}%` : '—'}
          </span>
        </div>
        <div className="summary-card">
          <span className="label">Days Present</span>
          <span className="value">{attendance.present}</span>
        </div>
        <div className="summary-card">
          <span className="label">Days Absent</span>
          <span className="value">{attendance.absent}</span>
        </div>
        <div className="summary-card">
          <span className="label">Late Arrivals</span>
          <span className="value">{attendance.late}</span>
        </div>
        <div className="summary-card">
          <span className="label">Excused</span>
          <span className="value">{attendance.excused}</span>
        </div>
      </div>

      {lowAttendance && (
        <div style={{
          background: '#fee2e2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          padding: '16px',
          color: '#991b1b',
          marginBottom: '16px',
        }}>
          <strong>Low Attendance Alert</strong>
          <p style={{ margin: '8px 0 0 0', fontSize: '14px' }}>
            {child.firstName}&apos;s attendance is below 85%. Please contact the school for more information.
          </p>
        </div>
      )}

      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 600 }}>
          Recent Attendance{attendance.sinceDate ? ` (since ${new Date(attendance.sinceDate).toLocaleDateString()})` : ''}
        </h3>
        {attendance.recent.length === 0 ? (
          <p style={{ color: '#9ca3af', margin: 0, fontSize: '14px' }}>No attendance has been recorded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                <th style={{ padding: '8px 4px', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                <th style={{ padding: '8px 4px', borderBottom: '1px solid #e5e7eb' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {attendance.recent.map((entry) => {
                const colors = STATUS_COLORS[entry.status] ?? { background: '#f3f4f6', color: '#374151' };
                return (
                  <tr key={entry.date}>
                    <td style={{ padding: '8px 4px', borderBottom: '1px solid #f3f4f6' }}>
                      {new Date(entry.date).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '8px 4px', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                        background: colors.background,
                        color: colors.color,
                      }}>
                        {STATUS_LABELS[entry.status] ?? entry.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{
        background: '#f0fdf4',
        border: '1px solid #d1fae5',
        borderRadius: '8px',
        padding: '16px',
        color: '#065f46',
      }}>
        <strong>Information</strong>
        <p style={{ margin: '8px 0 0 0', fontSize: '14px' }}>
          Attendance is recorded by the school. If you notice any discrepancies, please contact your school administration.
        </p>
      </div>
    </div>
  );
};