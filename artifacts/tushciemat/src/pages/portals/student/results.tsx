import { useEffect, useState } from 'react';
import {
  useListAcademicYears,
  useGetTermResults,
  useGetSubjectResults,
  type Term,
} from '@workspace/api-client-react';
import { apiMessage, apiStatus } from '@/lib/api';
import './results.css';

export const ResultsViewer = () => {
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);

  const years = useListAcademicYears();
  const terms: Term[] = (years.data ?? []).flatMap((year) => year.terms);

  useEffect(() => {
    if (!selectedTermId && terms.length > 0) {
      const currentTerm = terms.find((t) => t.isCurrent) ?? terms[0];
      setSelectedTermId(currentTerm.id);
    }
  }, [terms, selectedTermId]);

  const termResults = useGetTermResults(
    selectedTermId ?? '',
    { query: { enabled: !!selectedTermId, retry: (count, error) => apiStatus(error) !== 403 && apiStatus(error) !== 404 && count < 2 } },
  );
  const subjectResults = useGetSubjectResults(
    selectedSubject ?? '',
    { query: { enabled: !!selectedSubject } },
  );

  const rows = termResults.data?.subjectResults ?? [];
  const graded = rows.filter((r) => r.averagePercentage !== null);
  const bestSubject = graded.length > 0 ? graded.reduce((max, r) => (r.averagePercentage! > max.averagePercentage! ? r : max)).subject : '—';
  const lowestSubject = graded.length > 0 ? graded.reduce((min, r) => (r.averagePercentage! < min.averagePercentage! ? r : min)).subject : '—';

  return (
    <div className="results-viewer">
      <div className="page-header">
        <h1>Results &amp; Academic Performance</h1>
        <p>View your published assessment results</p>
      </div>

      <div className="results-controls">
        <select
          value={selectedTermId ?? ''}
          onChange={(e) => { setSelectedTermId(e.target.value || null); setSelectedSubject(null); }}
          className="term-select"
        >
          <option value="">Select Term</option>
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name} {term.isCurrent ? '(Current)' : ''}
            </option>
          ))}
        </select>
      </div>

      {!selectedTermId ? (
        <div className="empty-state">
          <p>{years.isLoading ? 'Loading terms…' : 'No academic terms have been set up yet.'}</p>
        </div>
      ) : termResults.isLoading ? (
        <div className="empty-state"><p>Loading results…</p></div>
      ) : termResults.isError ? (
        <div className="empty-state">
          <p>{apiStatus(termResults.error) === 403
            ? 'Results for this term have not been published yet.'
            : apiMessage(termResults.error, 'Results could not be loaded.')}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No published results yet</p>
          <p className="hint">Awaiting teacher grading and publication</p>
        </div>
      ) : (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <span className="label">Overall Average</span>
              <span className="value">{termResults.data?.overallAverage !== null && termResults.data?.overallAverage !== undefined ? `${Math.round(termResults.data.overallAverage)}%` : '—'}</span>
            </div>
            <div className="summary-card">
              <span className="label">Best Subject</span>
              <span className="value">{bestSubject}</span>
            </div>
            <div className="summary-card">
              <span className="label">Needs Work</span>
              <span className="value highlight">{lowestSubject}</span>
            </div>
            {termResults.data?.classPosition !== null && termResults.data?.classPosition !== undefined && (
              <div className="summary-card">
                <span className="label">Class Position</span>
                <span className="value">{termResults.data.classPosition}</span>
              </div>
            )}
          </div>

          <div className="results-table-card">
            <h2>Subject Results — {termResults.data?.termName}</h2>
            <table className="results-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Total Marks</th>
                  <th>Average</th>
                  <th>Grade</th>
                  <th>Position</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.subject}
                    className={`clickable ${selectedSubject === row.subject ? 'selected' : ''}`}
                    onClick={() => setSelectedSubject(selectedSubject === row.subject ? null : row.subject)}
                  >
                    <td className="subject-name">{row.subject}</td>
                    <td>{row.totalMarks ?? '—'}</td>
                    <td>
                      <span className={`percentage ${(row.averagePercentage ?? 0) >= 70 ? 'high' : (row.averagePercentage ?? 0) >= 50 ? 'medium' : 'low'}`}>
                        {row.averagePercentage !== null ? `${Math.round(row.averagePercentage)}%` : '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`grade-badge grade-${row.grade?.toUpperCase() ?? 'NA'}`}>
                        {row.grade ?? '—'}
                      </span>
                    </td>
                    <td>{row.position ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedSubject && (
            <div className="subject-detail-card">
              <div className="card-header">
                <h2>{selectedSubject} — Detailed Record</h2>
                <button onClick={() => setSelectedSubject(null)} className="close-btn">✕</button>
              </div>
              {subjectResults.isLoading ? (
                <p>Loading assessment history…</p>
              ) : subjectResults.isError ? (
                <p>{apiMessage(subjectResults.error, 'Assessment history could not be loaded.')}</p>
              ) : (
                <table className="detail-table">
                  <thead>
                    <tr>
                      <th>Date Marked</th>
                      <th>Marks</th>
                      <th>Teacher Feedback</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(subjectResults.data?.data ?? []).map((mark) => (
                      <tr key={mark.id}>
                        <td>{mark.markedAt ? new Date(mark.markedAt).toLocaleDateString() : '—'}</td>
                        <td>{mark.marksObtained ?? '—'}</td>
                        <td>{mark.feedback || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};