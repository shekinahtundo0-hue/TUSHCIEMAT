import { useMemo } from 'react';
import { useListChildResults, type ChildMark, type LearnerSummary } from '@workspace/api-client-react';
import { apiMessage } from '@/lib/api';
import '../student/results.css';

interface AcademicMonitoringProps {
  child: LearnerSummary;
}

interface SubjectRow {
  subject: string;
  assessmentCount: number;
  averagePercentage: number | null;
}

const percentageOf = (mark: ChildMark): number | null =>
  mark.marksObtained !== null && mark.maxMarks > 0 ? (mark.marksObtained / mark.maxMarks) * 100 : null;

export const AcademicMonitoring = ({ child }: AcademicMonitoringProps) => {
  const query = useListChildResults(child.studentId);
  const marks = query.data?.data ?? [];

  const subjectRows = useMemo<SubjectRow[]>(() => {
    const bySubject = new Map<string, ChildMark[]>();
    for (const mark of marks) {
      const list = bySubject.get(mark.subject) ?? [];
      list.push(mark);
      bySubject.set(mark.subject, list);
    }
    return Array.from(bySubject.entries()).map(([subject, subjectMarks]) => {
      const percentages = subjectMarks.map(percentageOf).filter((p): p is number => p !== null);
      return {
        subject,
        assessmentCount: subjectMarks.length,
        averagePercentage: percentages.length > 0
          ? Math.round(percentages.reduce((sum, p) => sum + p, 0) / percentages.length)
          : null,
      };
    }).sort((a, b) => a.subject.localeCompare(b.subject));
  }, [marks]);

  const gradedPercentages = marks.map(percentageOf).filter((p): p is number => p !== null);
  const overallAverage = gradedPercentages.length > 0
    ? Math.round(gradedPercentages.reduce((sum, p) => sum + p, 0) / gradedPercentages.length)
    : null;
  const bestSubject = subjectRows.reduce<SubjectRow | null>(
    (best, row) => row.averagePercentage !== null && (best === null || (best.averagePercentage ?? -1) < row.averagePercentage) ? row : best,
    null,
  );

  if (query.isLoading) {
    return <div className="results-viewer"><p>Loading published results…</p></div>;
  }

  if (query.isError) {
    return (
      <div className="results-viewer">
        <div className="empty-state">
          <p>{apiMessage(query.error, 'Published results could not be loaded. Please try again.')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="results-viewer">
      <div className="page-header">
        <h1>{child.firstName}&apos;s Academic Record</h1>
        <p>Published assessment results and performance monitoring</p>
      </div>

      {marks.length === 0 ? (
        <div className="empty-state">
          <p>No published results yet</p>
        </div>
      ) : (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <span className="label">Average Performance</span>
              <span className="value">{overallAverage !== null ? `${overallAverage}%` : '—'}</span>
            </div>
            <div className="summary-card">
              <span className="label">Best Subject</span>
              <span className="value">{bestSubject?.subject ?? '—'}</span>
            </div>
            <div className="summary-card">
              <span className="label">Published Marks</span>
              <span className="value">{marks.length}</span>
            </div>
          </div>

          <div className="results-table-card">
            <h2>Subject Results</h2>
            <table className="results-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Assessments</th>
                  <th>Average</th>
                </tr>
              </thead>
              <tbody>
                {subjectRows.map((row) => (
                  <tr key={row.subject}>
                    <td className="subject-name">{row.subject}</td>
                    <td>{row.assessmentCount}</td>
                    <td>
                      <span className="percentage">{row.averagePercentage !== null ? `${row.averagePercentage}%` : '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="results-table-card">
            <h2>Recent Published Marks</h2>
            <table className="results-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Marks</th>
                  <th>Marked</th>
                </tr>
              </thead>
              <tbody>
                {[...marks]
                  .sort((a, b) => (b.markedAt ?? '').localeCompare(a.markedAt ?? ''))
                  .slice(0, 10)
                  .map((mark) => (
                    <tr key={mark.id}>
                      <td className="subject-name">{mark.subject}</td>
                      <td>{mark.marksObtained !== null ? `${mark.marksObtained} / ${mark.maxMarks}` : '—'}</td>
                      <td>{mark.markedAt ? new Date(mark.markedAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="results-table-card">
            <h2>Data Protection Notice</h2>
            <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.6', margin: '0' }}>
              You are viewing published assessment results only. Draft marks, internal moderation, and detailed feedback
              are not shown in the parent view. For detailed discussions about {child.firstName}&apos;s progress,
              please contact the relevant teachers directly.
            </p>
          </div>
        </>
      )}
    </div>
  );
};