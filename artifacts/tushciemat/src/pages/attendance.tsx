import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, ShieldCheck, Users } from 'lucide-react';
import { useSearch } from 'wouter';
import {
  getGetAttendanceRegisterQueryKey, getGetDashboardQueryKey, useGetAttendanceRegister, useListClasses, useSaveAttendance,
  type AttendanceStatus,
} from '@workspace/api-client-react';
import { AppShell, Button, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/shell';
import { apiMessage, formatDate, todayLocal, todayInSchoolTimezone } from '@/lib/api';

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];
const MAX_REGISTER = 200;

export function AttendancePage({ portal }: { portal: 'admin' | 'teach' }) {
  const search = useSearch();
  const [classId, setClassId] = useState(() => new URLSearchParams(search).get('class') ?? '');
  const [date, setDate] = useState(todayInSchoolTimezone());
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [success, setSuccess] = useState('');
  const [saveError, setSaveError] = useState('');
  const dirty = useRef(false);
  const classes = useListClasses();
  const params = useMemo(() => ({ classId, date }), [classId, date]);
  const register = useGetAttendanceRegister(params, { query: { enabled: !!classId && !!date, queryKey: getGetAttendanceRegisterQueryKey(params) } });
  const save = useSaveAttendance();
  const client = useQueryClient();
  const entries = useMemo(() => register.data?.entries ?? [], [register.data]);

  useEffect(() => {
    // A post-save refetch must not wipe marks the teacher has already changed but not yet saved.
    if (dirty.current) return;
    const next: Record<string, AttendanceStatus> = {};
    for (const entry of entries) if (entry.status) next[entry.studentId] = entry.status;
    setMarks(next);
  }, [entries]);

  useEffect(() => { dirty.current = false; setSuccess(''); setSaveError(''); }, [classId, date]);

  const total = entries.length;
  const completed = entries.filter((e) => marks[e.studentId]).length;
  const tooMany = total > MAX_REGISTER;
  const counts = entries.reduce((acc, e) => { const s = marks[e.studentId]; if (s) acc[s] += 1; return acc; }, { present: 0, absent: 0, late: 0, excused: 0 });

  function mark(studentId: string, status: AttendanceStatus) { dirty.current = true; setSaveError(''); setSuccess(''); setMarks((prev) => ({ ...prev, [studentId]: status })); }
  function saveRegister() {
    if (!classId || total === 0 || completed !== total || tooMany) return;
    const notes = new Map(entries.map((e) => [e.studentId, e.note]));
    save.mutate({ data: { classId, date, records: entries.map((e) => ({ studentId: e.studentId, status: marks[e.studentId], note: notes.get(e.studentId) ?? null })) } }, {
      onSuccess: () => { dirty.current = false; setSuccess('Register saved. Your class attendance is up to date.'); void client.invalidateQueries({ queryKey: getGetAttendanceRegisterQueryKey(params) }); void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); },
      onError: (error) => setSaveError(apiMessage(error, 'The register could not be saved. Your changes are still here; please try again.')),
    });
  }

  return <AppShell title="Attendance" portal={portal}><main className="page"><PageHeader kicker="DAILY CLASS REGISTER" title="Attendance" description="Take a date-specific register for each class group." />
    <section className="panel register-panel"><div className="register-controls">
      <label className="field"><span>Class group</span><select value={classId} onChange={(e) => setClassId(e.target.value)} data-testid="select-attendance-class"><option value="">Choose a class group</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.academicYear}</option>)}</select></label>
      <label className="field"><span>Register date</span><input type="date" value={date} max={todayInSchoolTimezone()} onChange={(e) => setDate(e.target.value)} data-testid="input-attendance-date" /></label>
      <div className="register-summary"><span className="summary-count">{completed}<small> / {total}</small></span><span>marked</span></div></div>
      {classes.isError ? <ErrorState message={apiMessage(classes.error, 'Class groups could not be loaded.')} retry={() => classes.refetch()} />
        : !classId ? <EmptyState icon={ClipboardCheck} title="Choose a class to begin" text={classes.data?.length === 0 ? 'There are no class groups you can take a register for yet.' : 'Select a class group to open its register.'} />
        : register.isLoading ? <LoadingBlock label="Loading this class register" />
        : register.isError ? <ErrorState message={apiMessage(register.error, 'The class register could not be loaded.')} retry={() => register.refetch()} />
        : total === 0 ? <EmptyState icon={Users} title="No learners in this group" text="There are no active learners assigned to this class yet." />
        : <>
        {tooMany && <div className="register-limit-note"><AlertTriangle size={15} /> This class has more learners than one register can save at once. Please contact your school administrator for help.</div>}
        <div className="register-progress"><div><span>REGISTER COMPLETION</span><b>{Math.round(completed / total * 100)}%</b></div><div className="progress-track"><i style={{ transform: `scaleX(${completed / total})` }} /></div><div className="register-status-counts"><span><i className="legend-present" /> Present <b>{counts.present}</b></span><span><i className="legend-absent" /> Absent <b>{counts.absent}</b></span><span><i className="legend-other" /> Other <b>{counts.late + counts.excused}</b></span></div></div>
        {success && <div className="success-message" role="status"><CheckCircle2 size={17} />{success}</div>}{saveError && <div className="register-error-message" role="alert"><AlertTriangle size={16} />{saveError}</div>}
        <div className="table-wrap attendance-table-wrap"><table className="data-table attendance-table"><thead><tr><th>LEARNER</th><th>ADMISSION NO.</th><th>REGISTER STATUS</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.studentId} data-testid={`attendance-student-${entry.studentId}`}>
          <td><div className="student-cell"><span className="student-initial">{entry.studentName.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span><span><b>{entry.studentName}</b></span></div></td>
          <td className="mono-cell">{entry.admissionNumber}</td>
          <td><div className="attendance-options">{STATUSES.map((status) => <button key={status} className={`attendance-choice ${marks[entry.studentId] === status ? `choice-${status}` : ''}`} onClick={() => mark(entry.studentId, status)} aria-pressed={marks[entry.studentId] === status} data-testid={`attendance-${status}-${entry.studentId}`}>{status[0].toUpperCase() + status.slice(1)}</button>)}</div></td>
        </tr>)}</tbody></table></div>
        <div className="register-footer"><div><ShieldCheck size={15} /><span>{completed === total ? `All learners marked for ${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}.` : `${total - completed} learner${total - completed === 1 ? '' : 's'} still need a register status.`}</span></div><Button onClick={saveRegister} disabled={save.isPending || completed !== total || tooMany} testId="button-save-attendance">{save.isPending ? 'Saving register…' : <>Save register <Check size={16} /></>}</Button></div>
      </>}
    </section>
  </main></AppShell>;
}
