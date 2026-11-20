import { useLocation } from 'wouter';
import {
  useGetMyLearnerRecord,
  useListAssignments,
  useListPublishedResults,
  useGetTimetableForDate,
  useListAnnouncements,
  type AssignmentSummary,
  type TimetableEntry,
} from '@workspace/api-client-react';
import { useSession } from '@/lib/session';
import { apiMessage, apiStatus } from '@/lib/api';
import './dashboard.css';

function attendancePercentage(attendance: { present: number; absent: number; late: number; excused: number } | undefined): number | null {
  if (!attendance) return null;
  const marked = attendance.present + attendance.absent + attendance.late + attendance.excused;
  if (marked === 0) return null;
  return Math.round(((attendance.present + attendance.late) / marked) * 100);
}

function lessonWindow(lesson: TimetableEntry) {
  const [startHour, startMin] = lesson.startTime.split(':').map(Number);
  const [endHour, endMin] = lesson.endTime.split(':').map(Number);
  const startTime = new Date();
  startTime.setHours(startHour, startMin, 0, 0);
  const endTime = new Date();
  endTime.setHours(endHour, endMin, 0, 0);
  return { startTime, endTime };
}

export const StudentDashboard = () => {
  const { school } = useSession();
  const [, navigate] = useLocation();

  const record = useGetMyLearnerRecord({ query: { retry: (count, error) => apiStatus(error) !== 404 && count < 2 } });
  const student = record.data;
  const today = useGetTimetableForDate();
  const todayTimetable: TimetableEntry[] = today.data?.data ?? [];
  const assignmentsQuery = useListAssignments();
  const assignments: AssignmentSummary[] = assignmentsQuery.data?.data ?? [];
  const resultsQuery = useListPublishedResults({ limit: 5 });
  const publishedResults = resultsQuery.data?.data ?? [];
  const announcementsQuery = useListAnnouncements();
  const announcements = announcementsQuery.data ?? [];
  const queries = [record, today, assignmentsQuery, resultsQuery, announcementsQuery];
  if (queries.some((query) => query.isLoading)) {
    return <div className="student-dashboard" role="status">Loading your dashboard...</div>;
  }
  if (apiStatus(record.error) === 404) {
    return <div className="student-dashboard"><p>Your account is not connected to a learner record at this school yet. Ask the school office for help.</p></div>;
  }
  const error = queries.find((query) => query.isError)?.error;
  if (error) return <div className="student-dashboard" role="alert">{apiMessage(error, 'Unable to load your dashboard.')}</div>;
  const attendance = attendancePercentage(student?.attendance);

  const outstanding = assignments.filter((a) => a.status === 'not_started' || a.status === 'in_progress' || a.status === 'overdue');
  const overdue = assignments.filter((a) => a.status === 'overdue');
  const dueSoon = outstanding.filter((a) => {
    const days = Math.ceil((new Date(`${a.deadlineDate}T23:59:59`).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 3;
  });

  const now = new Date();
  const currentLesson = todayTimetable.find((lesson) => {
    const { startTime, endTime } = lessonWindow(lesson);
    return now >= startTime && now <= endTime;
  });
  const nextLesson = todayTimetable.find((lesson) => lessonWindow(lesson).startTime > now);

  return (
    <div className="student-dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Welcome, {student?.firstName ?? 'learner'}!</h1>
          <p className="admission">Admission #: {student?.admissionNumber ?? '—'}</p>
          <p className="school-info">{school?.schoolName ?? ''} {student?.className ? `• ${student.className}` : ''}</p>
          <p className="date">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="header-avatar">
          <div className="avatar">{student?.firstName?.[0]}{student?.lastName?.[0]}</div>
        </div>
      </div>

      <div className="card today-lessons">
        <h2>Today's Schedule</h2>
        {todayTimetable.length === 0 ? (
          <p className="empty">No classes today</p>
        ) : (
          <div className="lessons-list">
            {currentLesson && (
              <div className="lesson-item current">
                <span className="badge">NOW</span>
                <span className="time">{currentLesson.startTime} - {currentLesson.endTime}</span>
                <span className="subject">{currentLesson.subject}</span>
                <span className="room">{currentLesson.room ? `Room ${currentLesson.room}` : ''}</span>
              </div>
            )}
            {nextLesson && (
              <div className="lesson-item next">
                <span className="badge">NEXT</span>
                <span className="time">{nextLesson.startTime} - {nextLesson.endTime}</span>
                <span className="subject">{nextLesson.subject}</span>
                <span className="room">{nextLesson.room ? `Room ${nextLesson.room}` : ''}</span>
              </div>
            )}
            {todayTimetable.map((lesson) => {
              if (lesson === currentLesson || lesson === nextLesson) return null;
              return (
                <div key={lesson.id} className="lesson-item">
                  <span className="time">{lesson.startTime} - {lesson.endTime}</span>
                  <span className="subject">{lesson.subject}</span>
                  <span className="room">{lesson.room ? `Room ${lesson.room}` : ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card academic-overview">
        <h2>Academic Overview</h2>
        <div className="stats-grid">
          <div className="stat">
            <span className="label">Outstanding Work</span>
            <span className="value">{outstanding.length}</span>
          </div>
          <div className="stat">
            <span className="label">Attendance</span>
            <span className="value">{attendance === null ? '—' : `${attendance}%`}</span>
          </div>
          <div className="stat">
            <span className="label">Recent Results</span>
            <span className="value">{publishedResults.length}</span>
          </div>
        </div>
      </div>

      <div className="card attention-required">
        <h2>Attention Required</h2>
        <div className="alerts">
          {overdue.length > 0 && (
            <div className="alert alert-error">
              <div className="content">
                <span className="title">{overdue.length} assignments overdue</span>
                <button className="action" onClick={() => navigate('/learn/assignments')}>View</button>
              </div>
            </div>
          )}
          {dueSoon.length > 0 && (
            <div className="alert alert-warning">
              <div className="content">
                <span className="title">{dueSoon.length} assignments due within 3 days</span>
                <button className="action" onClick={() => navigate('/learn/assignments')}>View</button>
              </div>
            </div>
          )}
          {publishedResults.length > 0 && (
            <div className="alert alert-info">
              <div className="content">
                <span className="title">New results published</span>
                <button className="action" onClick={() => navigate('/learn/results')}>View</button>
              </div>
            </div>
          )}
          {announcements.length > 0 && (
            <div className="alert alert-info">
              <div className="content">
                <span className="title">{announcements.length} school announcements</span>
                <button className="action" onClick={() => navigate('/learn/announcements')}>View</button>
              </div>
            </div>
          )}
          {overdue.length === 0 && dueSoon.length === 0 && publishedResults.length === 0 && announcements.length === 0 && (
            <p className="empty">All caught up!</p>
          )}
        </div>
      </div>

      <div className="card quick-actions">
        <h2>Quick Actions</h2>
        <div className="action-buttons">
          <button onClick={() => navigate('/learn/learning')} className="action-btn">Learning Materials</button>
          <button onClick={() => navigate('/learn/assignments')} className="action-btn">Assignments</button>
          <button onClick={() => navigate('/learn/results')} className="action-btn">Results</button>
          <button onClick={() => navigate('/learn/timetable')} className="action-btn">Timetable</button>
        </div>
      </div>
    </div>
  );
};