import { useMemo } from 'react';
import { AlertCircle, Clock, TrendingUp, BookOpen, CheckCircle, AlertTriangle } from 'lucide-react';
import {
  useGetTimetableForDate,
  useListAssignments,
  useGetAttendanceSummary,
  useListPublishedResults,
  useListAnnouncements,
  type LearnerSummary,
} from '@workspace/api-client-react';
import { formatDate } from '@/lib/api';
import { Card, Badge, Button } from '@/components/ui';
import { AlertItem } from '@/components/portals/student/AlertItem';
import { StatCard } from '@/components/portals/student/StatCard';
import { ActivityFeed } from '@/components/portals/student/ActivityFeed';

interface DashboardProps {
  studentData: LearnerSummary;
}

export default function Dashboard({ studentData }: DashboardProps) {
  const today = new Date();
  const todayISOString = today.toISOString().split('T')[0];

  // Fetch data
  const timetable = useGetTimetableForDate(todayISOString);
  const assignments = useListAssignments();
  const attendance = useGetAttendanceSummary();
  const results = useListPublishedResults({ query: { refetchInterval: 60000 } });
  const announcements = useListAnnouncements({ query: { refetchInterval: 60000 } });

  // Calculate metrics
  const todayLessons = useMemo(() => {
    if (!timetable.data) return [];
    return timetable.data.sort((a, b) => 
      new Date(`2000-01-01T${a.startTime}`).getTime() - 
      new Date(`2000-01-01T${b.startTime}`).getTime()
    );
  }, [timetable.data]);

  const currentTime = new Date();
  const currentLesson = useMemo(() => {
    return todayLessons.find(lesson => {
      const start = new Date(`2000-01-01T${lesson.startTime}`);
      const end = new Date(`2000-01-01T${lesson.endTime}`);
      return currentTime >= start && currentTime <= end;
    });
  }, [todayLessons, currentTime]);

  const nextLesson = useMemo(() => {
    return todayLessons.find(lesson => {
      const start = new Date(`2000-01-01T${lesson.startTime}`);
      return start > currentTime;
    });
  }, [todayLessons, currentTime]);

  const pendingAssignments = useMemo(() => {
    if (!assignments.data) return [];
    return assignments.data.filter(a => 
      a.submission?.status !== 'graded' && 
      new Date(a.deadlineDate) > today
    );
  }, [assignments.data, today]);

  const overdueAssignments = useMemo(() => {
    if (!assignments.data) return [];
    return assignments.data.filter(a => 
      !a.submission?.submitted && 
      new Date(a.deadlineDate) < today
    );
  }, [assignments.data, today]);

  const dueSoonAssignments = useMemo(() => {
    if (!assignments.data) return [];
    const threeDaysFromNow = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
    return assignments.data.filter(a => {
      const deadline = new Date(a.deadlineDate);
      return !a.submission?.submitted && 
             deadline >= today && 
             deadline <= threeDaysFromNow &&
             !overdueAssignments.find(oa => oa.id === a.id);
    });
  }, [assignments.data, today, overdueAssignments]);

  const avgPercentage = useMemo(() => {
    if (!results.data || results.data.length === 0) return 0;
    const total = results.data.reduce((sum, r) => sum + (r.marksObtained / r.maxMarks * 100), 0);
    return Math.round(total / results.data.length);
  }, [results.data]);

  const attendancePercentage = useMemo(() => {
    if (!attendance.data) return 0;
    const { present, absent, late, excused } = attendance.data;
    const total = present + absent + late + excused;
    if (total === 0) return 0;
    return Math.round((present + late + excused) / total * 100);
  }, [attendance.data]);

  const newResults = useMemo(() => {
    if (!results.data) return [];
    const today = new Date();
    const twentyFourHoursAgo = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return results.data.filter(r => new Date(r.markedAt) > twentyFourHoursAgo);
  }, [results.data]);

  const unreadAnnouncements = useMemo(() => {
    if (!announcements.data) return 0;
    return announcements.data.filter(a => !a.readAt).length;
  }, [announcements.data]);

  // Combine recent activities
  const recentActivities = useMemo(() => {
    const activities = [];

    if (newResults.length > 0) {
      activities.push({
        id: 'results-' + newResults[0].id,
        type: 'results',
        title: `New result published: ${newResults[0].subject}`,
        description: `You scored ${newResults[0].marksObtained}/${newResults[0].maxMarks}`,
        timestamp: new Date(newResults[0].markedAt),
      });
    }

    if (unreadAnnouncements > 0) {
      const latestAnnouncement = announcements.data?.[0];
      if (latestAnnouncement) {
        activities.push({
          id: 'announcement-' + latestAnnouncement.id,
          type: 'announcement',
          title: 'New announcement',
          description: latestAnnouncement.title,
          timestamp: new Date(latestAnnouncement.createdAt),
        });
      }
    }

    if (overdueAssignments.length > 0) {
      activities.push({
        id: 'overdue',
        type: 'overdue',
        title: `${overdueAssignments.length} overdue assignment${overdueAssignments.length > 1 ? 's' : ''}`,
        description: 'These need immediate attention',
        timestamp: new Date(),
      });
    }

    return activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10);
  }, [newResults, unreadAnnouncements, overdueAssignments, announcements.data]);

  return (
    <div className="dashboard-container space-y-6">
      {/* Welcome Header */}
      <div className="dashboard-header bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 border border-blue-100">
        <h1 className="text-3xl font-bold text-gray-900">
          Welcome, {studentData.firstName}!
        </h1>
        <p className="text-lg text-gray-600 mt-2">
          Admission #: {studentData.admissionNumber} • {studentData.className} • Term (Current)
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Today: {formatDate(today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* Today's Schedule */}
      <Card title="Today's Schedule" className="schedule-card">
        {timetable.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Loading schedule...</div>
          </div>
        ) : timetable.isError ? (
          <div className="text-red-600 text-sm py-4">Could not load today's schedule</div>
        ) : !todayLessons || todayLessons.length === 0 ? (
          <div className="text-gray-500 py-4">No classes scheduled for today</div>
        ) : (
          <div className="lessons-list space-y-3">
            {todayLessons.map((lesson, idx) => {
              const lessonStart = new Date(`2000-01-01T${lesson.startTime}`);
              const lessonEnd = new Date(`2000-01-01T${lesson.endTime}`);
              const isCurrent = currentTime >= lessonStart && currentTime <= lessonEnd;
              const isNext = !isCurrent && lessonStart > currentTime && 
                !todayLessons.slice(0, idx).some(l => {
                  const start = new Date(`2000-01-01T${l.startTime}`);
                  return start > currentTime;
                });

              return (
                <div 
                  key={idx}
                  className={`lesson-item p-4 rounded-lg border-l-4 ${
                    isCurrent 
                      ? 'border-l-green-500 bg-green-50' 
                      : isNext 
                        ? 'border-l-blue-500 bg-blue-50'
                        : 'border-l-gray-300 bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock size={16} className={isCurrent ? 'text-green-600' : isNext ? 'text-blue-600' : 'text-gray-600'} />
                        <span className={`font-semibold ${isCurrent ? 'text-green-900' : isNext ? 'text-blue-900' : 'text-gray-900'}`}>
                          {lesson.startTime} - {lesson.endTime}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">{lesson.subject}</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {lesson.teacher && `Mr/Ms ${lesson.teacher}`}
                        {lesson.room && ` • Room ${lesson.room}`}
                      </p>
                    </div>
                    {isCurrent && (
                      <Badge className="bg-green-500 text-white">NOW</Badge>
                    )}
                    {isNext && (
                      <Badge className="bg-blue-500 text-white">NEXT</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Academic Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard 
          label="Subjects" 
          value={studentData.subjectsCount || '—'} 
          icon={BookOpen}
        />
        <StatCard 
          label="Avg Performance" 
          value={`${avgPercentage}%`}
          icon={TrendingUp}
        />
        <StatCard 
          label="Attendance" 
          value={`${attendancePercentage}%`}
          icon={CheckCircle}
        />
        <StatCard 
          label="Pending Work" 
          value={pendingAssignments.length}
          icon={Clock}
        />
      </div>

      {/* Alerts & Attention Required */}
      {(overdueAssignments.length > 0 || dueSoonAssignments.length > 0 || newResults.length > 0 || unreadAnnouncements > 0) && (
        <Card title="Attention Required" className="alert-card">
          <div className="space-y-3">
            {overdueAssignments.length > 0 && (
              <AlertItem 
                type="overdue"
                severity="critical"
                message={`${overdueAssignments.length} assignment${overdueAssignments.length > 1 ? 's' : ''} overdue`}
                action={{
                  label: 'View Now',
                  onClick: () => window.location.href = '/learn/assignments',
                }}
              />
            )}
            {dueSoonAssignments.length > 0 && (
              <AlertItem 
                type="due-soon"
                severity="warning"
                message={`${dueSoonAssignments.length} assignment${dueSoonAssignments.length > 1 ? 's' : ''} due within 3 days`}
                action={{
                  label: 'View Now',
                  onClick: () => window.location.href = '/learn/assignments',
                }}
              />
            )}
            {newResults.length > 0 && (
              <AlertItem 
                type="results"
                severity="info"
                message={`${newResults.length} new result${newResults.length > 1 ? 's' : ''} published`}
                action={{
                  label: 'View Results',
                  onClick: () => window.location.href = '/learn/results',
                }}
              />
            )}
            {unreadAnnouncements > 0 && (
              <AlertItem 
                type="announcement"
                severity="info"
                message={`${unreadAnnouncements} new announcement${unreadAnnouncements > 1 ? 's' : ''}`}
                action={{
                  label: 'Read Now',
                  onClick: () => window.location.href = '/learn/announcements',
                }}
              />
            )}
          </div>
        </Card>
      )}

      {/* Recent Activity Feed */}
      {recentActivities.length > 0 && (
        <Card title="Recent Activity">
          <ActivityFeed activities={recentActivities} />
        </Card>
      )}

      {/* Quick Actions */}
      <Card title="Quick Actions">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Button 
            onClick={() => window.location.href = '/learn/assignments'}
            className="flex flex-col items-center justify-center gap-2 p-4 h-auto"
          >
            <BookOpen size={24} />
            <span className="text-sm">Assignments</span>
          </Button>
          <Button 
            onClick={() => window.location.href = '/learn/results'}
            className="flex flex-col items-center justify-center gap-2 p-4 h-auto"
          >
            <TrendingUp size={24} />
            <span className="text-sm">Results</span>
          </Button>
          <Button 
            onClick={() => window.location.href = '/learn/timetable'}
            className="flex flex-col items-center justify-center gap-2 p-4 h-auto"
          >
            <Clock size={24} />
            <span className="text-sm">Timetable</span>
          </Button>
          <Button 
            onClick={() => window.location.href = '/learn/learning'}
            className="flex flex-col items-center justify-center gap-2 p-4 h-auto"
          >
            <BookOpen size={24} />
            <span className="text-sm">Materials</span>
          </Button>
        </div>
      </Card>
    </div>
  );
}
