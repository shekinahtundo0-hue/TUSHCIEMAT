import type { SchoolCapability, SchoolRole } from '@workspace/api-client-react';

// Mirrors the API's role gates so the UI only offers actions the server will accept.
export const MANAGERS: readonly SchoolRole[] = ['owner', 'school_admin'];
export const STAFF: readonly SchoolRole[] = ['owner', 'school_admin', 'principal', 'academic_admin'];
export const GUARDIAN_VIEWERS: readonly SchoolRole[] = [...STAFF, 'bursar'];
export const STUDENT_VIEWERS: readonly SchoolRole[] = [...STAFF, 'bursar', 'teacher'];
export const CLASS_VIEWERS: readonly SchoolRole[] = [...STAFF, 'teacher'];
export const ATTENDANCE_TAKERS: readonly SchoolRole[] = [...STAFF, 'teacher'];

export function hasAny(roles: readonly SchoolRole[], allowed: readonly SchoolRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

export const ROLE_LABELS: Record<SchoolRole, string> = {
  owner: 'Owner',
  school_admin: 'School administrator',
  principal: 'Principal',
  academic_admin: 'Academic administrator',
  bursar: 'Bursar',
  teacher: 'Teacher',
  parent: 'Parent',
  student: 'Learner',
  tutor: 'Tutor',
};

// records.delete is intentionally absent: permanent deletion is not enabled yet.
export const DELEGABLE_CAPABILITIES: readonly { key: SchoolCapability; label: string; description: string }[] = [
  { key: 'students.manage', label: 'Students', description: 'Add and edit learner records and guardians' },
  { key: 'academics.manage', label: 'Classes & calendar', description: 'Manage classes, academic years and terms' },
  { key: 'attendance.manage', label: 'Attendance', description: 'Record and correct attendance for any class' },
  { key: 'people.manage', label: 'People & invitations', description: 'Manage members and invite staff' },
  { key: 'requests.review', label: 'Join requests', description: 'Approve or reject requests to join the school' },
  { key: 'settings.manage', label: 'School settings', description: 'Edit the school profile and preferences' },
  { key: 'announcements.manage', label: 'Announcements', description: 'Publish announcements to the school' },
  { key: 'classroom.manage', label: 'Classroom', description: 'Manage learning resources, assignments and timetables' },
];

// Display-only labels for capabilities that exist in the API enum but are not delegable here
// (permanent deletion and the not-yet-built assessments/results/materials modules).
export const CAPABILITY_LABELS: Record<SchoolCapability, string> = Object.fromEntries(
  [...DELEGABLE_CAPABILITIES.map((c) => [c.key, c.label]),
    ['records.delete', 'Permanent deletion'],
    ['assessments.manage', 'Assessments'],
    ['results.publish', 'Publish results'],
    ['resources.manage', 'Learning materials'],
    ['staff.manage', 'Staff records'],
    ['workload.manage', 'Staff workload'],
    ['communications.manage', 'Communications']],
) as Record<SchoolCapability, string>;

export type PortalKey = 'admin' | 'teach' | 'family' | 'learn';

export const PORTALS: Record<PortalKey, { path: string; label: string; roles: readonly SchoolRole[] }> = {
  admin: { path: '/admin', label: 'School office', roles: [...STAFF, 'bursar'] },
  teach: { path: '/teach', label: 'Teaching', roles: ['teacher', 'tutor'] },
  family: { path: '/family', label: 'Family', roles: ['parent'] },
  learn: { path: '/learn', label: 'Learning', roles: ['student'] },
};

export function portalsFor(roles: readonly SchoolRole[]): PortalKey[] {
  return (Object.keys(PORTALS) as PortalKey[]).filter((key) => hasAny(roles, PORTALS[key].roles));
}

export function homePathFor(roles: readonly SchoolRole[]): string | null {
  const [first] = portalsFor(roles);
  if (!first) return null;
  if (first === 'admin' && !hasAny(roles, STAFF)) return '/admin/students';
  return PORTALS[first].path;
}
