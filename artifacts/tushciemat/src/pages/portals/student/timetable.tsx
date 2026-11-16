import { useState, useMemo, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import {
  useGetTimetableForDate,
  useGetTimetableForWeek,
  type LearnerSummary,
} from '@workspace/api-client-react';
import { Card, Button, Badge } from '@/components/ui';
import { SimpleToggleGroup } from '@/components/ui/toggle-group-wrapper';
import { formatDate } from '@/lib/api';

interface TimetableProps {
  studentData: LearnerSummary;
}

type ViewType = 'today' | 'week' | 'custom';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const PERIOD_TIMES = [
  '08:00 - 08:45',
  '08:50 - 09:35',
  '09:35 - 10:20',
  '10:25 - 11:10',
  '11:10 - 11:55',
  '12:00 - 12:45',
];

export default function Timetable({ studentData }: TimetableProps) {
  const [view, setView] = useState<ViewType>('today');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const selectedDateISO = selectedDate.toISOString().split('T')[0];
  const weekStartDate = new Date(selectedDate);
  weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay() + 1);
  const weekStartISO = weekStartDate.toISOString().split('T')[0];

  // Fetch data
  const todayTimetable = useGetTimetableForDate(selectedDateISO);
  const weekTimetable = useGetTimetableForWeek(weekStartISO);

  // Sort lessons by time
  const sortedTodayLessons = useMemo(() => {
    if (!todayTimetable.data) return [];
    return todayTimetable.data.sort((a, b) =>
      new Date(`2000-01-01T${a.startTime}`).getTime() -
      new Date(`2000-01-01T${b.startTime}`).getTime()
    );
  }, [todayTimetable.data]);

  // Determine lesson status
  const getPeriodStatus = (lesson: any): 'past' | 'current' | 'next' | 'future' => {
    const lessonStart = new Date(`2000-01-01T${lesson.startTime}`);
    const lessonEnd = new Date(`2000-01-01T${lesson.endTime}`);
    const now = new Date(`2000-01-01T${currentTime.toTimeString().slice(0, 5)}`);

    if (now >= lessonStart && now <= lessonEnd) return 'current';
    if (now < lessonStart) {
      const upcoming = sortedTodayLessons.filter(l =>
        new Date(`2000-01-01T${l.startTime}`).getTime() > now.getTime()
      );
      if (upcoming[0]?.startTime === lesson.startTime) return 'next';
      if (now < lessonStart) return 'future';
    }
    return 'past';
  };

  // Navigation handlers
  const handlePreviousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  };

  const handleNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  return (
    <div className="timetable-container space-y-6">
      {/* Header */}
      <div className="timetable-header">
        <h2 className="text-2xl font-bold text-gray-900">Timetable</h2>
        <p className="text-gray-600 mt-1">Your class schedule</p>
      </div>

      {/* View Toggle */}
      <Card title="Select View" className="view-toggle-card">
        <div className="flex flex-col sm:flex-row gap-4">
          <SimpleToggleGroup 
            value={view} 
            onChange={(val) => setView(val as ViewType)}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This Week' },
              { value: 'custom', label: 'Pick Date' },
            ]}
          />

          {view === 'custom' && (
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={selectedDateISO}
                onChange={(e) => setSelectedDate(new Date(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
            </div>
          )}

          {(view === 'today' || view === 'custom') && (
            <button
              onClick={handleToday}
              className="text-blue-600 hover:text-blue-900 font-medium transition-colors"
            >
              Today
            </button>
          )}
        </div>
      </Card>

      {/* Today View */}
      {(view === 'today' || (view === 'custom' && selectedDate.toDateString() === new Date().toDateString())) && (
        <div className="space-y-4">
          {/* Date Navigation */}
          <div className="flex items-center justify-between bg-blue-50 rounded-lg p-4 border border-blue-200">
            <button
              onClick={handlePreviousDay}
              className="p-2 hover:bg-blue-100 rounded transition-colors"
            >
              <ChevronLeft size={24} className="text-blue-900" />
            </button>

            <div className="text-center">
              <h3 className="text-lg font-semibold text-blue-900">
                {formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}
              </h3>
              {selectedDate.toDateString() === new Date().toDateString() && (
                <p className="text-sm text-blue-700 mt-1">Today</p>
              )}
            </div>

            <button
              onClick={handleNextDay}
              className="p-2 hover:bg-blue-100 rounded transition-colors"
            >
              <ChevronRight size={24} className="text-blue-900" />
            </button>
          </div>

          {/* Lessons List */}
          {todayTimetable.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-500 text-center">
                <div className="animate-spin mb-3">
                  <svg className="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <p>Loading schedule...</p>
              </div>
            </div>
          ) : todayTimetable.isError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-800">
              <p className="font-semibold">Could not load schedule</p>
              <Button onClick={() => todayTimetable.refetch()} className="mt-3">
                Retry
              </Button>
            </div>
          ) : !sortedTodayLessons.length ? (
            <div className="bg-gray-50 rounded-lg p-12 text-center">
              <Calendar size={48} className="mx-auto text-gray-400 mb-3" />
              <p className="text-gray-900 font-semibold">No classes scheduled</p>
              <p className="text-gray-600 text-sm mt-1">for this day</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedTodayLessons.map((lesson, idx) => {
                const status = getPeriodStatus(lesson);
                const statusStyles = {
                  current: 'border-l-4 border-l-green-500 bg-green-50 ring-2 ring-green-200',
                  next: 'border-l-4 border-l-blue-500 bg-blue-50 ring-2 ring-blue-200',
                  future: 'border-l-4 border-l-gray-300 bg-gray-50 hover:bg-gray-100',
                  past: 'border-l-4 border-l-gray-200 bg-gray-100 opacity-60',
                };

                return (
                  <div
                    key={idx}
                    className={`lesson-item p-4 rounded-lg transition-all ${statusStyles[status]}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`font-bold text-lg ${
                            status === 'current' ? 'text-green-900' :
                            status === 'next' ? 'text-blue-900' :
                            'text-gray-900'
                          }`}>
                            {lesson.startTime} - {lesson.endTime}
                          </div>
                          {status === 'current' && (
                            <Badge className="bg-green-500 text-white animate-pulse">
                              NOW
                            </Badge>
                          )}
                          {status === 'next' && (
                            <Badge className="bg-blue-500 text-white">
                              NEXT
                            </Badge>
                          )}
                        </div>

                        <h3 className="text-xl font-semibold text-gray-900">
                          {lesson.subject}
                        </h3>

                        <div className="mt-3 space-y-1 text-sm">
                          {lesson.teacher && (
                            <p className="text-gray-700">
                              <span className="font-medium">Teacher:</span> {lesson.teacher}
                            </p>
                          )}
                          {lesson.room && (
                            <p className="text-gray-700">
                              <span className="font-medium">Room:</span> {lesson.room}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <Clock size={24} className={
                          status === 'current' ? 'text-green-600' :
                          status === 'next' ? 'text-blue-600' :
                          'text-gray-600'
                        } />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Week View */}
      {view === 'week' && (
        <Card title="Weekly Schedule" className="week-view-card">
          {weekTimetable.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-500">Loading week schedule...</div>
            </div>
          ) : weekTimetable.isError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-800">
              <p className="font-semibold">Could not load schedule</p>
              <Button onClick={() => weekTimetable.refetch()} className="mt-3">
                Retry
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 px-4 py-3 bg-gray-50 border border-gray-200 font-semibold text-gray-900 text-left">
                      Time
                    </th>
                    {DAYS_OF_WEEK.map(day => (
                      <th
                        key={day}
                        className="px-4 py-3 bg-gray-50 border border-gray-200 font-semibold text-gray-900 min-w-[140px]"
                      >
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERIOD_TIMES.map((timeSlot, idx) => (
                    <tr key={idx}>
                      <td className="sticky left-0 px-4 py-3 bg-gray-50 border border-gray-200 font-medium text-gray-900 whitespace-nowrap">
                        {timeSlot}
                      </td>
                      {DAYS_OF_WEEK.map((day, dayIdx) => {
                        const lesson = weekTimetable.data?.find(
                          l => l.dayOfWeek === day && l.periodNumber === idx + 1
                        );

                        return (
                          <td
                            key={day}
                            className="px-4 py-3 border border-gray-200 text-center align-top bg-white hover:bg-gray-50 transition-colors"
                          >
                            {lesson ? (
                              <div className="bg-blue-100 rounded-lg p-2 border border-blue-300">
                                <p className="font-semibold text-blue-900 text-sm">
                                  {lesson.subject}
                                </p>
                                {lesson.teacher && (
                                  <p className="text-blue-800 text-xs mt-1">
                                    {lesson.teacher}
                                  </p>
                                )}
                                {lesson.room && (
                                  <p className="text-blue-700 text-xs mt-0.5">
                                    Room {lesson.room}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400 text-lg">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Legend */}
      <Card title="Legend" className="legend-card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-l-4 border-l-green-500 bg-green-50 rounded"></div>
            <span className="text-gray-700">Current class</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-l-4 border-l-blue-500 bg-blue-50 rounded"></div>
            <span className="text-gray-700">Next class</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-l-4 border-l-gray-300 bg-gray-50 rounded"></div>
            <span className="text-gray-700">Upcoming</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
