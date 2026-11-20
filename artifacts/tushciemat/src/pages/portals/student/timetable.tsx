import { useState } from 'react';
import {
  useGetTimetableForDate,
  useGetTimetableForWeek,
  type TimetableEntry,
} from '@workspace/api-client-react';
import './timetable.css';

function lessonWindow(lesson: TimetableEntry) {
  const [startH, startM] = lesson.startTime.split(':').map(Number);
  const [endH, endM] = lesson.endTime.split(':').map(Number);
  const startTime = new Date();
  startTime.setHours(startH, startM, 0, 0);
  const endTime = new Date();
  endTime.setHours(endH, endM, 0, 0);
  return { startTime, endTime };
}

export const TimetablePage = () => {
  const [view, setView] = useState<'today' | 'week'>('week');

  const today = useGetTimetableForDate();
  const week = useGetTimetableForWeek();
  const todayTimetable: TimetableEntry[] = today.data?.data ?? [];
  const weekDays = (week.data?.data ?? []).filter((day) => day.dayOfWeek <= 4);

  const now = new Date();
  const currentLesson = todayTimetable.find((lesson) => {
    const { startTime, endTime } = lessonWindow(lesson);
    return now >= startTime && now <= endTime;
  });
  const nextLesson = todayTimetable.find((lesson) => lessonWindow(lesson).startTime > now);

  const renderTodayView = () => (
    <div className="today-view">
      {today.isLoading ? (
        <div className="empty-day">Loading today's schedule…</div>
      ) : todayTimetable.length === 0 ? (
        <div className="empty-day">No classes today</div>
      ) : (
        <>
          {currentLesson && (
            <div className="lesson-block current">
              <div className="badge">NOW</div>
              <div className="content">
                <h4>{currentLesson.subject}</h4>
                <p className="time">{currentLesson.startTime} - {currentLesson.endTime}</p>
                <p className="room">{currentLesson.room ? `Room ${currentLesson.room}` : ''}</p>
              </div>
            </div>
          )}
          {nextLesson && (
            <div className="lesson-block next">
              <div className="badge">NEXT</div>
              <div className="content">
                <h4>{nextLesson.subject}</h4>
                <p className="time">{nextLesson.startTime} - {nextLesson.endTime}</p>
                <p className="room">{nextLesson.room ? `Room ${nextLesson.room}` : ''}</p>
              </div>
            </div>
          )}
          {todayTimetable.map((lesson) => {
            if (lesson === currentLesson || lesson === nextLesson) return null;
            return (
              <div key={lesson.id} className="lesson-block">
                <div className="content">
                  <h4>{lesson.subject}</h4>
                  <p className="time">{lesson.startTime} - {lesson.endTime}</p>
                  <p className="room">{lesson.room ? `Room ${lesson.room}` : ''}</p>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );

  const renderWeekView = () => (
    <div className="week-view">
      {week.isLoading ? (
        <div className="empty-day">Loading weekly schedule…</div>
      ) : (
        <table className="timetable">
          <thead>
            <tr>
              <th>Time</th>
              {weekDays.map((day) => (
                <th key={day.dayOfWeek}>{day.dayName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((period) => (
              <tr key={period}>
                <td className="period-label">Period {period}</td>
                {weekDays.map((day) => {
                  const lesson = day.classes.find((entry) => entry.period === period);
                  return (
                    <td key={day.dayOfWeek} className="lesson-cell">
                      {lesson ? (
                        <div className="lesson-compact">
                          <div className="subject">{lesson.subject}</div>
                          <div className="time">{lesson.startTime}</div>
                        </div>
                      ) : (
                        <div className="free">-</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="timetable-page">
      <div className="page-header">
        <h1>My Timetable</h1>
        <p>Your class schedule</p>
      </div>

      <div className="view-controls">
        <button className={`toggle-btn ${view === 'today' ? 'active' : ''}`} onClick={() => setView('today')}>
          Today
        </button>
        <button className={`toggle-btn ${view === 'week' ? 'active' : ''}`} onClick={() => setView('week')}>
          This Week
        </button>
      </div>

      <div className="timetable-content">
        {view === 'today' ? renderTodayView() : renderWeekView()}
      </div>
    </div>
  );
};