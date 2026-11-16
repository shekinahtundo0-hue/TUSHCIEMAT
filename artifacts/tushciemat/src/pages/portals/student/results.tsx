import { useState, useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Award, AlertCircle } from 'lucide-react';
import {
  useListPublishedResults,
  useListTerms,
  type LearnerSummary,
} from '@workspace/api-client-react';
import { Card, Select, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import { formatDate } from '@/lib/api';
import { StatCard } from '@/components/portals/student/StatCard';

interface ResultsViewerProps {
  studentData: LearnerSummary;
}

interface SubjectResult {
  subject: string;
  assessmentCount: number;
  maxMarks: number;
  minMarks: number;
  totalMarks: number;
  averagePercentage: number;
  grade: string;
  trend: 'up' | 'down' | 'stable';
}

interface AssessmentRecord {
  id: string;
  subject: string;
  assessmentType: string;
  date: string;
  marksObtained: number;
  maxMarks: number;
  grade: string;
  feedback?: string;
  percentage: number;
}

const GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'E', 'F'];
const GRADE_COLORS: Record<string, string> = {
  'A+': '#10b981',
  'A': '#059669',
  'B+': '#84cc16',
  'B': '#65a30d',
  'C+': '#f59e0b',
  'C': '#d97706',
  'D': '#ef4444',
  'E': '#dc2626',
  'F': '#991b1b',
};

const getGradeFromPercentage = (percentage: number): string => {
  if (percentage >= 90) return 'A+';
  if (percentage >= 85) return 'A';
  if (percentage >= 80) return 'B+';
  if (percentage >= 75) return 'B';
  if (percentage >= 70) return 'C+';
  if (percentage >= 65) return 'C';
  if (percentage >= 50) return 'D';
  if (percentage >= 40) return 'E';
  return 'F';
};

export default function ResultsViewer({ studentData }: ResultsViewerProps) {
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const terms = useListTerms();
  const results = useListPublishedResults({
    query: { refetchInterval: 60000 },
  });

  // Set default term if not selected
  const termOptions = useMemo(() => {
    if (!terms.data) return [];
    return terms.data.map(t => ({ value: t.id, label: t.name }));
  }, [terms.data]);

  const activeTermId = selectedTermId || terms.data?.[0]?.id || null;

  // Filter results by term
  const termResults = useMemo(() => {
    if (!results.data) return [];
    if (!activeTermId) return [];
    return results.data.filter(r => r.termId === activeTermId);
  }, [results.data, activeTermId]);

  // Group results by subject
  const subjectResults = useMemo(() => {
    const grouped: Record<string, AssessmentRecord[]> = {};

    termResults.forEach(result => {
      if (!grouped[result.subject]) {
        grouped[result.subject] = [];
      }
      grouped[result.subject].push({
        id: result.id,
        subject: result.subject,
        assessmentType: result.assessmentType,
        date: result.markedAt,
        marksObtained: result.marksObtained,
        maxMarks: result.maxMarks,
        grade: result.grade || getGradeFromPercentage((result.marksObtained / result.maxMarks) * 100),
        feedback: result.feedback,
        percentage: Math.round((result.marksObtained / result.maxMarks) * 100),
      });
    });

    // Calculate aggregated subject stats
    const subjects: SubjectResult[] = Object.entries(grouped).map(([subject, assessments]) => {
      const totalMarks = assessments.reduce((sum, a) => sum + a.marksObtained, 0);
      const maxMarks = assessments.reduce((sum, a) => sum + a.maxMarks, 0);
      const percentages = assessments.map(a => a.percentage);
      const avgPercentage = Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length);

      // Determine trend
      const firstHalf = percentages.slice(0, Math.floor(percentages.length / 2));
      const secondHalf = percentages.slice(Math.floor(percentages.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (secondAvg > firstAvg + 5) trend = 'up';
      if (secondAvg < firstAvg - 5) trend = 'down';

      return {
        subject,
        assessmentCount: assessments.length,
        maxMarks,
        minMarks: Math.min(...assessments.map(a => a.marksObtained)),
        totalMarks,
        averagePercentage: avgPercentage,
        grade: getGradeFromPercentage(avgPercentage),
        trend,
      };
    });

    return subjects.sort((a, b) => b.averagePercentage - a.averagePercentage);
  }, [termResults]);

  // Calculate summary
  const summary = useMemo(() => {
    if (subjectResults.length === 0) {
      return {
        average: 0,
        bestSubject: '—',
        lowestSubject: '—',
        classPosition: '—',
        totalAssessments: 0,
      };
    }

    const avgPercentage = Math.round(
      subjectResults.reduce((sum, s) => sum + s.averagePercentage, 0) / subjectResults.length
    );

    return {
      average: avgPercentage,
      bestSubject: subjectResults[0].subject,
      lowestSubject: subjectResults[subjectResults.length - 1].subject,
      classPosition: studentData.classPosition || '—',
      totalAssessments: termResults.length,
    };
  }, [subjectResults, termResults, studentData]);

  // Data for charts
  const chartData = useMemo(() => {
    return subjectResults.map(s => ({
      subject: s.subject.substring(0, 10),
      percentage: s.averagePercentage,
      fullSubject: s.subject,
    }));
  }, [subjectResults]);

  const gradeDistribution = useMemo(() => {
    const distribution: Record<string, number> = {};
    GRADES.forEach(grade => {
      distribution[grade] = subjectResults.filter(s => s.grade === grade).length;
    });

    return GRADES
      .filter(grade => distribution[grade] > 0)
      .map(grade => ({
        name: grade,
        value: distribution[grade],
      }));
  }, [subjectResults]);

  const selectedSubjectDetail = useMemo(() => {
    if (!selectedSubject) return null;
    
    const subject = subjectResults.find(s => s.subject === selectedSubject);
    if (!subject) return null;

    const assessments = termResults
      .filter(r => r.subject === selectedSubject)
      .sort((a, b) => new Date(b.markedAt).getTime() - new Date(a.markedAt).getTime());

    return { subject, assessments };
  }, [selectedSubject, subjectResults, termResults]);

  return (
    <div className="results-viewer space-y-6">
      {/* Header */}
      <div className="results-header">
        <h2 className="text-2xl font-bold text-gray-900">Results</h2>
        <p className="text-gray-600 mt-1">View your assessment results and performance trends</p>
      </div>

      {/* Term Selector */}
      <Card title="Select Term" className="term-selector">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Current Term</label>
            <Select
              value={activeTermId || ''}
              onChange={(e) => setSelectedTermId(e.target.value)}
              options={termOptions.map(t => t.label)}
            />
          </div>
        </div>
      </Card>

      {/* Performance Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Average" value={`${summary.average}%`} icon={TrendingUp} />
        <StatCard label="Best Subject" value={summary.bestSubject} icon={Award} />
        <StatCard label="Needs Work" value={summary.lowestSubject} icon={TrendingDown} />
        <StatCard label="Total Assessments" value={summary.totalAssessments} icon={AlertCircle} />
      </div>

      {/* No Results State */}
      {termResults.length === 0 ? (
        <Card className="no-results-card">
          <div className="text-center py-12">
            <AlertCircle size={48} className="mx-auto text-gray-400 mb-3" />
            <h3 className="font-semibold text-gray-900">Results Not Yet Published</h3>
            <p className="text-gray-600 text-sm mt-1">
              Awaiting teacher grading and publication for this term
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Subject Results Table */}
          <Card title="Subject Performance" className="results-table-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-900">Subject</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-900">Assessments</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-900">Score</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-900">Average</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-900">Grade</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-900">Trend</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-900">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {subjectResults.map((subject) => (
                    <tr key={subject.subject} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{subject.subject}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{subject.assessmentCount}</td>
                      <td className="px-4 py-3 text-center text-gray-900 font-medium">
                        {subject.totalMarks}/{subject.maxMarks}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-gray-900">{subject.averagePercentage}%</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className="inline-block px-3 py-1 rounded font-semibold text-white"
                          style={{ backgroundColor: GRADE_COLORS[subject.grade] }}
                        >
                          {subject.grade}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {subject.trend === 'up' && (
                          <TrendingUp className="inline text-green-600" size={20} />
                        )}
                        {subject.trend === 'down' && (
                          <TrendingDown className="inline text-red-600" size={20} />
                        )}
                        {subject.trend === 'stable' && (
                          <div className="inline w-5 h-5 text-gray-400">—</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => {
                            setSelectedSubject(subject.subject);
                            setIsDetailModalOpen(true);
                          }}
                          className="text-blue-600 hover:text-blue-900 font-medium transition-colors"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar Chart - Subject Performance */}
            <Card title="Subject Performance Comparison" className="chart-card">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="subject" angle={-45} textAnchor="end" height={100} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#f3f4f6', border: '1px solid #d1d5db' }}
                    formatter={(value) => `${value}%`}
                    labelFormatter={(label) => {
                      const subject = chartData.find(c => c.subject === label);
                      return subject?.fullSubject || label;
                    }}
                  />
                  <Bar dataKey="percentage" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Grade Distribution */}
            {gradeDistribution.length > 0 && (
              <Card title="Grade Distribution" className="chart-card">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={gradeDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {gradeDistribution.map((entry) => (
                        <Cell key={`cell-${entry.name}`} fill={GRADE_COLORS[entry.name] || '#9ca3af'} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Subject Detail Modal */}
      {selectedSubjectDetail && (
        <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedSubjectDetail.subject.subject} - Detailed Record</DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {/* Subject Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-blue-50 rounded-lg p-4 border border-blue-200">
                <div>
                  <p className="text-xs text-blue-600 uppercase font-semibold">Average</p>
                  <p className="text-2xl font-bold text-blue-900 mt-1">
                    {selectedSubjectDetail.subject.averagePercentage}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-blue-600 uppercase font-semibold">Grade</p>
                  <p
                    className="text-2xl font-bold mt-1 text-white inline-block px-3 py-1 rounded"
                    style={{ backgroundColor: GRADE_COLORS[selectedSubjectDetail.subject.grade] }}
                  >
                    {selectedSubjectDetail.subject.grade}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-blue-600 uppercase font-semibold">Assessments</p>
                  <p className="text-2xl font-bold text-blue-900 mt-1">
                    {selectedSubjectDetail.subject.assessmentCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-blue-600 uppercase font-semibold">Trend</p>
                  <p className="mt-1">
                    {selectedSubjectDetail.subject.trend === 'up' && (
                      <span className="inline-flex items-center gap-1 text-green-600 font-semibold">
                        <TrendingUp size={20} /> Improving
                      </span>
                    )}
                    {selectedSubjectDetail.subject.trend === 'down' && (
                      <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                        <TrendingDown size={20} /> Declining
                      </span>
                    )}
                    {selectedSubjectDetail.subject.trend === 'stable' && (
                      <span className="text-gray-600 font-semibold">Stable</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Assessment Records Table */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Assessment Records</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-900">Assessment</th>
                        <th className="px-4 py-3 text-center font-semibold text-gray-900">Date</th>
                        <th className="px-4 py-3 text-center font-semibold text-gray-900">Score</th>
                        <th className="px-4 py-3 text-center font-semibold text-gray-900">Grade</th>
                        <th className="px-4 py-3 text-center font-semibold text-gray-900">Feedback</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {selectedSubjectDetail.assessments.map((record) => (
                        <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-gray-900">{record.assessmentType}</td>
                          <td className="px-4 py-3 text-center text-gray-600">
                            {formatDate(new Date(record.date))}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-gray-900">
                            {record.marksObtained}/{record.maxMarks} ({record.percentage}%)
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className="inline-block px-2 py-1 rounded font-semibold text-white text-xs"
                              style={{ backgroundColor: GRADE_COLORS[record.grade] }}
                            >
                              {record.grade}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {record.feedback ? (
                              <span className="text-blue-600 hover:text-blue-900 cursor-pointer">
                                View
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
