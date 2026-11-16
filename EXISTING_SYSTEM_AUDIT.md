# Tushciemat: Existing System Audit Report

**Date**: December 2024  
**Scope**: Comprehensive technical audit of the Tushciemat codebase  
**Environment**: Monorepo with React frontend, Express API backend, PostgreSQL database

---

## 1. Project Structure & Tech Stack

### 1.1 Project Layout
```
tushciemat/
├── artifacts/              # Production applications
│   ├── api-server/        # Express API backend (Node.js/TypeScript)
│   ├── tushciemat/        # React frontend web application
│   └── mockup-sandbox/    # Development/testing sandbox
├── lib/                    # Shared libraries
│   ├── db/                # Drizzle ORM database layer
│   ├── api-client-react/  # React hooks for API calls (TanStack Query)
│   └── api-zod/           # Zod validation schemas for API contracts
├── scripts/               # Utility scripts
├── docs/                  # Documentation
└── .local/                # Development utilities and audit scripts

```

### 1.2 Technology Stack

**Frontend:**
- **Framework**: React 19.1.0 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **HTTP Client**: TanStack React Query v5.90.21 with custom API client hooks
- **UI Components**: Radix UI (comprehensive component library)
- **Styling**: Tailwind CSS v4.1.14 with custom utilities
- **Forms**: React Hook Form with Zod validation
- **Charts**: Recharts v2.15.2 for data visualization
- **Icons**: Lucide React, react-icons
- **Animation**: Framer Motion v12.23.24
- **Auth**: Firebase v13.3.0
- **Build Tool**: Vite v7.3.2

**Backend:**
- **Runtime**: Node.js with TypeScript
- **Framework**: Express v5.3.0
- **Database ORM**: Drizzle ORM v0.45.2
- **Database**: PostgreSQL 17 (embedded for development)
- **Validation**: Zod v3.25.76
- **Authentication**: JWT (jose v6.2.17)
- **Security**: Helmet v8.3.0, express-rate-limit v8.7.4
- **Logging**: Pino v9.14.0
- **CORS**: Express CORS v2.8.6

**Package Manager**: pnpm with workspace configuration  
**Build System**: TypeScript v5.9.3, esbuild  
**Supply Chain Security**: Minimum release age 1440 minutes (1 day)

---

## 2. Database Schema

### 2.1 Core Identity & School Management

**Tables:**
- `user_profiles` - Firebase auth users, platform roles (admin, support)
- `schools` - School organizations with metadata (name, slug, category, curriculum, location)
- `school_memberships` - User roles in schools (owner, admin, principal, teacher, parent, student, etc.)
- `school_join_requests` - Application workflow for new members (pending/approved/rejected)
- `membership_capabilities` - Fine-grained capabilities per admin role
- `audit_logs` - All school-level changes logged by actor, action, entity

**Roles Defined:**
```typescript
owner, school_admin, principal, academic_admin, bursar, teacher, parent, student, tutor
```

**Capabilities:**
```typescript
students.manage, academics.manage, attendance.manage, people.manage, 
requests.review, settings.manage, announcements.manage, assessments.manage, 
results.publish, resources.manage, records.delete, staff.manage, 
workload.manage, communications.manage
```

### 2.2 Students & Guardians

**Tables:**
- `students` - Learner records with admission number, class assignment, account link
- `guardians` - Parent/guardian records with contact details
- `student_guardians` - Junction table with relationship types (mother, father, guardian, grandparent, sibling, sponsor)
  - Enforces: one primary guardian per student
  - Supports: multiple guardians per student

**Key Features:**
- Students linked to auth account only when accepting invitation
- Guardians linked to auth account separately
- Status tracking: active, transferred, graduated, inactive

### 2.3 Academic Structure

**Tables:**
- `academic_years` - School years (start/end dates, current year flag)
- `terms` - Terms within academic years (start/end dates, current term flag)
- `school_classes` - Class records (name, grade, stream, academic year)
- `class_teacher_assignments` - Teacher role assignments
  - Roles: class_teacher (one per class), subject_teacher (multiple per subject)
  - Unique constraint on class + teacher + subject
  - Subject field required only for subject_teachers

**Constraints:**
- One current academic year per school
- One current term per school
- One class teacher per class (unique index enforced)

### 2.4 Attendance Tracking

**Table: `attendance_records`**
- Uniqueness: student + date (one record per student per day)
- Status enum: present, absent, late, excused
- Fields: date, status, note, recorded_by_user, timestamps
- Indexes: school + date + class for efficient queries

### 2.5 Assessments & Results

**Tables:**
- `assessment_types` - Assessment template definitions (max_marks, weight)
- `assessments` - Assessment instances per class/term/subject
  - Uniqueness: class + term + subject + assessment_type
- `student_assessment_marks` - Individual scores
  - Status: pending, submitted, marked
  - Tracks: marks, marked_by_user, feedback, edit_count, edit_history
  - Uniqueness: assessment + student
- `grading_scales` - School-wide grading configuration (band-based, e.g., 0-40: F, 41-50: D)
- `result_publications` - Publication workflow with review/approval
  - Status: draft, pending_review, approved, published, rejected
  - Enforcement: status must match published flag and timestamps
- `student_term_aggregates` - Calculated totals (total_marks, percentage, grade, class_position)

**Workflow:**
1. Teachers mark assessments → student_assessment_marks (pending)
2. School reviews marks → result_publications (pending_review)
3. Principal approves → result_publications (approved)
4. Publish results → result_publications (published) + visible to parents/students
5. Results persist in student_term_aggregates for historical access

### 2.6 Learning Resources & Classroom

**Tables:**
- `class_lessons` - Lesson definitions (topic, unit, chapter, name, order)
- `learning_resources` - Course materials
  - Types: pdf, docx, pptx, image, video, link, other
  - Publishing: immediate, scheduled, or expiring
  - Visibility: per-class or restricted to specific students
  - Tracking: upload_time, publish_time, soft_delete (deleted_at)
- `resource_access_logs` - Student engagement (access_time, download, view_duration)
- `student_learning_progress` - Completion tracking (completed_at, bookmarked_at)
  - Uniqueness: student + lesson

### 2.7 Communications

**Tables:**
- `announcements_extended` - Broadcasting system
  - Targeting: all_school, specific_classes, specific_streams, specific_roles, specific_students
  - Status: draft, scheduled, published, archived
  - Tracking: delivered_count, read_count, total_recipients_count
  - Enforcement: status/publishing/archival timestamps must be consistent
- `announcement_attachments` - File attachments per announcement
- `announcement_deliveries` - Delivery tracking per recipient
  - Status: pending, delivered, failed
  - Read tracking: read_at timestamp
- `direct_messages` - One-to-one or broadcast to class
  - Can target: individual user OR class (mutually exclusive)
- `notifications` - User notification inbox (separate from announcements)
  - Events: request.submitted, request.approved, request.rejected, announcement.published
  - Read tracking: read_at timestamp

**Legacy Table:**
- `announcements` - Simple announcement model (superseded by announcements_extended)

### 2.8 Staff Management (Designed but Not UI-Implemented)

**Tables:**
- `staff_employment_records` - Staff profiles
  - Fields: designation, employment_type, hire_date, employment_end_date, status
  - Status: active, on_leave, on_sabbatical, resigned, retired, suspended
- `teacher_workload` - Per-term workload tracking
  - Fields: assigned_periods_count, max_allowed_periods, is_overloaded, workload_percentage
- `class_timeslots` - Timetable/schedule
  - Fields: day_of_week, period_number, subject, teacher, start_time, end_time, room
- `teacher_leave_requests` - Leave workflow
  - Types: sick, annual, unpaid, sabbatical, study, maternity, paternity, bereavement
  - Status: pending, approved, rejected, cancelled
- `teacher_leave_balances` - Leave entitlements per academic year

### 2.9 Community & Invitations

**Tables:**
- `invitations` - Invitation-based account onboarding
  - Stores: email, role, token_hash (SHA-256 of token), status
  - Status: pending, accepted, revoked
  - Link to: student or guardian (if applicable)
  - Token shown once; only hash stored permanently
  - Uniqueness: token_hash (globally), pending emails per school/role
- `school_join_requests` - (Also referenced in community table)

---

## 3. Frontend Portals & Routes

### 3.1 Portal Architecture

The application implements four distinct portals with role-based access control:

#### **3.1.1 Student Portal (/learn)**
- **Route**: `/learn`
- **Required Role**: `student`
- **Page**: `LearnPage` (reads from `/portal/learner` API endpoint)

**Features Implemented:**
- ✅ WORKING: View learner record (name, class, admission number)
- ✅ WORKING: View attendance summary (present, absent, late, excused counts)
- ✅ WORKING: View recent attendance dates with status
- ✅ WORKING: Read announcements (`/learn/announcements`)
- ❌ MISSING: Learning resources viewer
- ❌ MISSING: Assignment submission interface
- ❌ MISSING: Results/marks viewer
- ❌ MISSING: Timetable viewer
- ❌ MISSING: Progress tracking

**Sub-routes:**
- `/learn/announcements` - Announcements (partially working - listed in route but limited functionality)

---

#### **3.1.2 Parent/Guardian Portal (/family)**
- **Route**: `/family`
- **Required Role**: `parent`
- **Page**: `FamilyPage` (reads from `/portal/children` API endpoint)

**Features Implemented:**
- ✅ WORKING: List all linked children
- ✅ WORKING: View child's attendance summary for each child
- ✅ WORKING: View recent attendance dates per child
- ✅ WORKING: View child's class assignment
- ✅ WORKING: Read announcements (`/family/announcements`)
- ❌ MISSING: Results/marks viewer for children
- ❌ MISSING: Assignment tracking
- ❌ MISSING: Communication with teachers
- ❌ MISSING: Fee/billing information

**Sub-routes:**
- `/family/announcements` - Announcements

---

#### **3.1.3 Teacher/Staff Portal (/teach)**
- **Route**: `/teach`
- **Required Roles**: `teacher`, `tutor`

**Features Implemented:**
- ✅ WORKING: View assigned classes (lists in sidebar via ClassesPage)
- ✅ WORKING: View students in class (`/teach/students`)
- ✅ WORKING: Record attendance per class/date (`/teach/attendance`)
- ✅ WORKING: Publish announcements (`/teach/announcements`)
- ❌ MISSING: Mark assessments/grades
- ❌ MISSING: Upload learning resources
- ❌ MISSING: View timetable
- ❌ MISSING: Submit leave requests
- ❌ MISSING: View workload

**Sub-routes:**
- `/teach/classes` - Assigned classes
- `/teach/students` - Class students
- `/teach/attendance` - Mark attendance
- `/teach/announcements` - Create/publish announcements

---

#### **3.1.4 School Administration Portal (/admin)**
- **Route**: `/admin`
- **Required Roles**: Various staff roles (STAFF, MANAGERS, GUARDIAN_VIEWERS)

**Features Implemented:**
- ✅ WORKING: Dashboard overview (`/admin`) - school summary
- ✅ WORKING: Student management (`/admin/students`) - register, edit, add guardians
- ✅ WORKING: Class management (`/admin/classes`) - create classes, assign teachers
- ✅ WORKING: School calendar (`/admin/calendar`) - manage academic years and terms
- ✅ WORKING: Attendance records (`/admin/attendance`) - view all attendance
- ✅ WORKING: Staff/People (`/admin/people`) - manage school members
- ✅ WORKING: Access requests (`/admin/requests`) - review join requests
- ✅ WORKING: Settings (`/admin/settings`) - school configuration
- ✅ WORKING: Announcements (`/admin/announcements`) - create/manage announcements
- ❌ MISSING: Results management/publication
- ❌ MISSING: Assessment management
- ❌ MISSING: Staff employment records
- ❌ MISSING: Leave request approvals
- ❌ MISSING: Workload management

---

#### **3.1.5 Platform Portal (/platform)**
- **Route**: `/platform`
- **Required**: Platform admin role

**Features Implemented:**
- ✅ WORKING: Directory of all schools with stats

---

### 3.2 Authentication & Public Routes

**Public Pages:**
- `/` - Landing page (redirects to /home if authenticated, shows landing if not)
- `/sign-in` - Firebase email/password sign-in
- `/sign-up` - Firebase account creation
- `/verify-email` - Email verification workflow
- `/accept-invite` - Invitation acceptance (signed-out flow or signed-in redirect)

**Post-Auth Onboarding:**
- `/home` - Home resolver (redirects to portal or onboarding)
- `/onboarding` - School discovery/creation/joining
- `/onboarding/find` - Find existing school
- `/onboarding/create` - Create new school
- `/onboarding/join/:schoolId` - Join via request
- `/onboarding/requests` - View pending join requests
- `/notifications` - User notification inbox (outside of school context)

---

## 4. API Endpoints

### 4.1 Authentication & Session
- `GET /api/v1/healthz` - Basic health check
- `GET /api/v1/readyz` - Database readiness check
- All authenticated endpoints require Firebase JWT in Authorization header

### 4.2 Academic Management
```
GET    /api/v1/academic-years             List academic years
POST   /api/v1/academic-years             Create academic year
POST   /api/v1/academic-years/:id/set-current  Set current year
GET    /api/v1/terms/:termId/set-current  Set current term
POST   /api/v1/terms                      Create term
GET    /api/v1/classes                    List classes
POST   /api/v1/classes                    Create class
POST   /api/v1/teachers/:userId/assign-to-class  Assign teacher
DELETE /api/v1/teachers/:userId/assignment  Remove teacher assignment
```

### 4.3 Student Management
```
GET    /api/v1/students                   List students (paginated)
GET    /api/v1/students/:studentId        Get student details
POST   /api/v1/students                   Create student
PATCH  /api/v1/students/:studentId        Update student
DELETE /api/v1/students/:studentId        Delete student
POST   /api/v1/students/:studentId/guardians      Add guardian link
DELETE /api/v1/students/:studentId/guardians/:guardianId  Remove guardian
```

### 4.4 Attendance
```
GET    /api/v1/attendance?classId=&date=  Get class attendance register
POST   /api/v1/attendance                 Save attendance records
```

### 4.5 Portal/Dashboard Endpoints
```
GET    /api/v1/portal/learner             Get student's own record (view as student)
GET    /api/v1/portal/children            Get parent's children (view as parent)
GET    /api/v1/dashboard                  Get school dashboard summary
```

### 4.6 School Management
```
GET    /api/v1/schools                    List accessible schools
GET    /api/v1/schools/:schoolId          Get school details
POST   /api/v1/schools                    Create school
PATCH  /api/v1/schools/:schoolId          Update school settings
GET    /api/v1/schools/:schoolId/members  List school members
PATCH  /api/v1/schools/:schoolId/members/:memberId  Update member role/status
POST   /api/v1/schools/:schoolId/members/:memberId/capabilities  Update admin capabilities
```

### 4.7 Invitations & Joining
```
POST   /api/v1/invitations                Send invitation
GET    /api/v1/invitations/:tokenHash     Validate invitation token
POST   /api/v1/invitations/:tokenHash/accept  Accept invitation
POST   /api/v1/join-requests              Submit join request
GET    /api/v1/join-requests              List requests (for reviewer)
POST   /api/v1/join-requests/:requestId/review  Approve or reject request
```

### 4.8 Communications
```
GET    /api/v1/announcements              List announcements
POST   /api/v1/announcements              Create announcement
GET    /api/v1/notifications              List user notifications
POST   /api/v1/notifications/:notificationId/mark-read  Mark read
```

### 4.9 User Profile
```
GET    /api/v1/me                         Get current user profile & schools
PATCH  /api/v1/me                         Update profile
```

---

## 5. Authentication & Authorization

### 5.1 Authentication Method
- **Firebase Authentication** (email/password, can be extended for social auth)
- Token stored as JWT in Authorization header: `Authorization: Bearer <token>`
- User identity: Firebase UID (auth_user_id in database)

### 5.2 Role-Based Access Control (RBAC)

**School Roles:**
```typescript
owner, school_admin, principal, academic_admin, bursar, teacher, parent, student, tutor
```

**Role Hierarchy (Approximate):**
- `owner` ≈ Full school permissions
- `school_admin` ≈ Administrative access (can assign capabilities)
- `principal` ≈ Educational leadership + approvals
- `academic_admin` ≈ Academic records management
- `teacher` ≈ Teach classes + record attendance
- `parent` ≈ View child records
- `student` ≈ View own record

**Platform Roles:**
- `platform_admin` - Manage platform, view all schools
- `platform_support` - Support staff
- (Both assigned to user_profiles, not school-specific)

### 5.3 Fine-Grained Permissions (Capabilities)

Capabilities assigned per school admin membership:
```
students.manage, academics.manage, attendance.manage, people.manage,
requests.review, settings.manage, announcements.manage, assessments.manage,
results.publish, resources.manage, records.delete, staff.manage, 
workload.manage, communications.manage
```

Enforcement: API routes check both role AND capability (if required).

### 5.4 Row-Level Security (RLS)

**Implemented via Database:**
- `membership_capabilities` table has `.enableRLS()` directive
- Multi-tenant data isolation via `school_id` foreign keys
- Users can only access data within their school(s)

**Enforced in API:**
- Every route validates `X-School-Id` header or derives school from context
- `inSchool()` helper enforces school isolation at database transaction level

---

## 6. Feature Implementation Status

### 6.1 Fully Working Features ✅

| Feature | Endpoints | UI Pages | Notes |
|---------|-----------|----------|-------|
| **School Creation** | POST /schools | /onboarding/create | Can create school |
| **School Discovery** | GET /schools (directory), POST /join-requests | /onboarding/find, /onboarding/join | Browse and join schools |
| **School Invitations** | POST /invitations, GET /accept | /accept-invite | Invite via email |
| **Student Registration** | POST /students, GET /students | /admin/students | Create, edit, view students |
| **Guardian Linking** | POST /students/:id/guardians | /admin/students (modal) | Link parent/guardian to student |
| **Class Management** | POST /classes, GET /classes | /admin/classes | Create and view classes |
| **Teacher Assignment** | POST /teachers/assign-to-class | /admin/classes (modal) | Assign teacher to class |
| **Academic Calendar** | POST /academic-years, POST /terms | /admin/calendar | Manage years and terms |
| **Attendance Recording** | GET /attendance, POST /attendance | /teach/attendance, /admin/attendance | Mark attendance per class |
| **Attendance Viewing** | GET /portal/learner, /portal/children | /learn, /family | View attendance records |
| **Announcements** | POST /announcements, GET /announcements | /teach/announcements, /family/announcements, /admin/announcements | Create & view announcements |
| **School Dashboard** | GET /dashboard | /admin | Admin overview |
| **School Settings** | PATCH /schools/:id | /admin/settings | School configuration |
| **People Management** | GET /members, PATCH /members/:id | /admin/people | Manage staff & members |
| **Join Requests** | POST /join-requests, GET /join-requests, POST /review | /admin/requests | Review membership requests |
| **Notifications** | GET /notifications | /notifications | User inbox (request approvals, etc.) |
| **Access Control** | Role checks, capability checks | Portal guarding | RBAC enforcement |

### 6.2 Partially Working / Limited Scope ⚠️

| Feature | Status | Notes |
|---------|--------|-------|
| **Announcements** | Partially working | Basic create/list works; targeting & scheduling UI incomplete |
| **Student Record Visibility** | Partially working | Students see own record, parents see children, but no detailed results view |
| **Class Student View** | Partially working | Teachers can list students in class, but no grading/feedback interface |

### 6.3 Designed but Not Implemented ❌

| Feature | Schema | API | UI | Notes |
|---------|--------|-----|-----|-------|
| **Results & Grading** | ✅ Full schema | ❌ Endpoints missing | ❌ No UI | Assessment marking, publication workflow, grades calculator |
| **Learning Resources** | ✅ Full schema | ❌ Upload/download endpoints missing | ❌ No resource viewer | Course materials, file management, student access tracking |
| **Staff Management** | ✅ Full schema | ❌ No endpoints | ❌ No UI | Employment records, leave requests, leave balances |
| **Timetable/Schedule** | ✅ Partial schema (class_timeslots) | ❌ No endpoints | ❌ No UI | Class schedule, period management, room allocation |
| **Digital Classroom** | ❌ No schema | ❌ No endpoints | ❌ No UI | Live class sessions, video conferencing, interactive lessons |
| **Assignments** | ❌ No schema | ❌ No endpoints | ❌ No UI | Assignment distribution, student submissions, grading |
| **Leave Management** | ✅ Full schema | ❌ No endpoints | ❌ No UI | Teacher leave requests, approval workflow, balance tracking |
| **Workload Tracking** | ✅ Full schema | ❌ No endpoints | ❌ No UI | Teacher workload calculation, overload detection |

### 6.4 Audit & Logging
- **Implemented**: `audit_logs` table tracks all school-level changes
- **Status**: Schema present, API logging via middleware exists, but no UI for audit log viewer

---

## 7. Data Flow Examples

### 7.1 Student Onboarding Flow
```
1. School admin registers student → POST /api/v1/students
   Stored in: students table
   
2. School sends invitation → POST /api/v1/invitations
   Stored in: invitations table (with token_hash, role='student')
   Linked to: students.id via invitation.studentId
   
3. Student accepts invite → POST /api/v1/invitations/:tokenHash/accept
   Updated: students.authUserId = firebase_uid
   Created: school_membership (role='student')
   
4. Student logs in → session loads via GET /api/v1/me
   
5. Student views record → GET /api/v1/portal/learner
   Returns: student name, class, attendance summary
```

### 7.2 Attendance Recording Flow
```
1. Teacher opens /teach/attendance
   
2. Teacher selects class & date
   Fetches: GET /api/v1/attendance?classId=X&date=YYYY-MM-DD
   Returns: students in class with previous attendance (if any)
   
3. Teacher marks attendance
   Submits: POST /api/v1/attendance
   Payload: [{ studentId, status: 'present'|'absent'|'late'|'excused' }, ...]
   
4. API validates:
   - Teacher is assigned to class
   - Date is valid
   
5. Database stores:
   attendance_records (with recorded_by, date, status)
   
6. Parent can see aggregate: GET /api/v1/portal/children
   Returns: attendance counts per child
```

### 7.3 School Membership Approval Flow
```
1. User submits join request → POST /api/v1/join-requests
   Status: pending
   Stored: school_join_requests
   
2. School admin reviews → GET /api/v1/join-requests
   
3. Admin approves → POST /api/v1/join-requests/:id/review
   Decision: approved | rejected
   
4. If approved:
   - Creates: school_membership (role='student'|'teacher'|'parent')
   - Creates: student or guardian record (if applicable)
   - Status: active
   - Notification sent to user
   
5. User gets redirect to new portal on next login
```

---

## 8. Missing/Incomplete Core Functionality

### 8.1 Critical (High Impact)

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| **Results Publication** | Parents can't see grades | High | Schema ready, needs API + UI |
| **Learning Resources** | No course materials | High | Schema ready, needs upload/download/viewing |
| **Assignments** | No assignment workflow | Very High | No schema; needs design + full implementation |
| **Staff Leave Management** | Can't process teacher leave | Medium | Schema ready, needs API + UI |

### 8.2 Important (Medium Impact)

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| **Timetable** | Teachers/students can't see schedule | Medium | Partial schema (class_timeslots), needs API + UI |
| **Workload Tracking** | Admin can't monitor teacher load | Medium | Schema ready, needs API + UI |
| **Digital Classroom** | No online learning capability | Very High | Requires infrastructure (video, real-time) |

### 8.3 Quality of Life (Lower Impact)

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| **Audit Log Viewer** | Hard to track who changed what | Low | API exists, just needs UI |
| **Export/Reports** | Can't generate standard reports | Medium | Needs report generation + export |
| **Multi-class Support** | Teachers assigned to one class at a time | Low | Design decision; can extend |
| **Bulk Student Import** | Must register students one-by-one | Low | CSV/Excel import UI |

---

## 9. Database Integrity & Constraints

### 9.1 Unique Constraints
- Academic year name per school
- Term name per academic year
- Class name per school + academic year
- Student admission number per school
- School membership (school + user + role)
- Teacher assignment per class (one class teacher)
- Invitation token hash (globally)
- Assessment (class + term + subject + assessment_type)
- Student assessment marks (assessment + student)
- Student term aggregates (student + term + subject)

### 9.2 Check Constraints
- Academic year end date > start date
- Term end date > start date
- Assessment max_marks > 0
- Assessment weight > 0 AND ≤ 100
- Student assessment marks ≥ 0
- Class timeslot end time > start time
- Teacher leave end date ≥ start date
- Result publication status/timestamp consistency
- Invitation status/publish workflow consistency
- Learning resource publishing rules (can't be both scheduled and immediate)

### 9.3 Indexes for Performance
- School + date + class (attendance queries)
- Academic year (current flag per school)
- Term (current flag per school)
- Student (school + admission number, school + name for search)
- Teacher (school + user for permission checks)
- Visible resources (class + published_at)
- Announcements (published state for directories)
- Notifications (recipient + date for inbox)

---

## 10. Security & Data Privacy

### 10.1 Authentication
- ✅ Firebase JWT validation on all endpoints
- ✅ Rate limiting (300 req/min per IP)
- ✅ Request ID tracking for audit trails
- ✅ Helmet security headers (CSP, X-Frame-Options, etc.)

### 10.2 Data Isolation
- ✅ Multi-tenant via school_id
- ✅ All queries scoped to authenticated school
- ✅ User can only access schools where they have membership
- ✅ Row-level security on membership_capabilities table

### 10.3 Secrets Management
- ✅ Environment variables via .env file
- ✅ Firebase credentials not in code
- ✅ Database credentials via DATABASE_URL

### 10.4 Audit Trail
- ✅ audit_logs table with actor, action, entity, metadata
- ✅ HTTP request logging via Pino
- ✅ Request ID in responses for tracing

### 10.5 Missing
- ❌ Encryption at rest for sensitive fields (PII)
- ❌ PII data masking in logs
- ❌ Two-factor authentication
- ❌ Session timeout enforcement
- ❌ Consent/GDPR workflows
- ❌ Data retention policies

---

## 11. Performance Considerations

### 11.1 Optimizations Present
- ✅ Pagination in student list (12 items per page)
- ✅ Query parameter filtering (search, page)
- ✅ Indexes on frequently queried columns
- ✅ Database connection pooling (via pg package)
- ✅ React Query caching with configurable refetch

### 11.2 Potential Bottlenecks
- ❌ No query result limits in some endpoints (e.g., all announcements)
- ❌ No pagination for announcements or members list
- ⚠️ Calculating student_term_aggregates on-demand (should be materialized)
- ⚠️ No caching headers for read-only endpoints
- ⚠️ Large file uploads for resources (no chunking/resumable upload)

---

## 12. Frontend Component Structure

### 12.1 Key Pages (in `/src/pages/`)
- `portals.tsx` - Student, Parent, Platform views
- `students.tsx` - Student management (admin/teacher)
- `attendance.tsx` - Attendance marking
- `calendar.tsx` - Academic year/term management
- `classes.tsx` - Class management and assignment
- `communications.tsx` - Announcements and notifications
- `people.tsx` - School member management
- `school-settings.tsx` - School configuration
- `overview.tsx` - Dashboard
- `accept-invite.tsx` - Invitation acceptance
- `onboarding.tsx` - School discovery/creation/joining
- `requests.tsx` - Join request review
- `public.tsx` - Landing, sign-in, sign-up

### 12.2 Shared Components (in `/src/components/`)
- `shell.tsx` - Layout wrapper (AppShell, PageHeader, etc.)
- `error-boundary.tsx` - Error handling
- Form components, modals, tables, status badges

### 12.3 Hooks & Utilities (in `/src/lib/`)
- `auth.tsx` - Firebase auth context
- `session.tsx` - User session & school access
- `roles.tsx` - Role permission helpers
- `api.tsx` - API response formatting

---

## 13. Build & Deployment

### 13.1 Build Output
- Backend: `artifacts/api-server/dist/index.mjs`
- Frontend: `artifacts/tushciemat/dist/`
- Both built via esbuild with source maps

### 13.2 Development Environment
- Embedded PostgreSQL (for local testing)
- `pnpm dev` in artifacts runs Vite + Express
- Hot module reloading available

### 13.3 Production Considerations
- Docker containers not configured (would need Dockerfile)
- Database migrations not automated (Drizzle kit available but not set up)
- No CI/CD pipeline in codebase

---

## 14. Known Issues & Technical Debt

### 14.1 Current Limitations
1. **Single class per teacher**: Schema assumes one class per teacher assignment, but real schools need multi-class support
2. **No streaming for large data**: Attendance, student lists load all-at-once
3. **No soft deletes for most entities**: Deletes are hard (except learning_resources)
4. **Announcement targeting incomplete**: API schema ready but UI doesn't support complex targeting
5. **No time zone handling** in calendar UI (backend uses config.timezone)
6. **Module loading**: Some API modules may have incomplete implementations

### 14.2 Code Quality
- ✅ TypeScript strict mode enabled
- ✅ Zod validation on all API inputs/outputs
- ⚠️ Limited test coverage (test files in `.local/` but not integrated in CI)
- ⚠️ Some error handling could be more specific
- ❌ No integration tests for API workflows

### 14.3 Documentation
- ❌ No API documentation (OpenAPI/Swagger)
- ❌ No database schema diagram
- ❌ Limited code comments
- ⚠️ Readme file exists but minimal content

---

## 15. Summary Table: Feature Completeness

| System Component | Schema | API | Frontend | Status |
|---|---|---|---|---|
| **Identity & Auth** | ✅ | ✅ | ✅ | WORKING |
| **School Management** | ✅ | ✅ | ✅ | WORKING |
| **Academic Structure** | ✅ | ✅ | ✅ | WORKING |
| **Student Management** | ✅ | ✅ | ✅ | WORKING |
| **Attendance** | ✅ | ✅ | ✅ | WORKING |
| **Announcements** | ✅ | ⚠️ Limited | ⚠️ Limited | PARTIAL |
| **Learning Resources** | ✅ | ❌ | ❌ | MISSING |
| **Assessments & Results** | ✅ | ❌ | ❌ | MISSING |
| **Staff Management** | ✅ | ❌ | ❌ | MISSING |
| **Timetable/Schedule** | ⚠️ Partial | ❌ | ❌ | MISSING |
| **Assignments** | ❌ | ❌ | ❌ | MISSING |
| **Digital Classroom** | ❌ | ❌ | ❌ | MISSING |
| **Leave Management** | ✅ | ❌ | ❌ | MISSING |
| **Workload Tracking** | ✅ | ❌ | ❌ | MISSING |

---

## 16. Recommendations for Next Phase

### Priority 1 (Essential for MVP)
1. **Implement Results/Grading Module**
   - Create API endpoints for marking assessments
   - Build result publication workflow UI
   - Add results viewer for students/parents

2. **Implement Learning Resources**
   - File upload endpoint (with virus scanning)
   - Resource visibility/scheduling UI
   - Student resource viewer
   - Download tracking

### Priority 2 (Important)
3. **Complete Announcements**
   - Implement targeting UI (specific classes, roles)
   - Add scheduling (publish at X time)
   - Add read receipts dashboard

4. **Implement Timetable**
   - Create class schedule entry UI
   - Add timetable viewer for students/teachers
   - Conflict detection (teacher in two places)

### Priority 3 (Nice to Have)
5. **Staff Leave & Workload**
   - Leave request UI
   - Approval workflow
   - Leave balance calculator
   - Workload analysis dashboard

6. **Assignments System**
   - Design assignment schema (consider: due date, submission, grading)
   - Create assignment distribution UI
   - Build submission/grading interface
   - Track late submissions

### Architecture Improvements
- Add database migration tooling (Drizzle Kit)
- Implement API documentation (OpenAPI)
- Set up automated testing (Jest + Supertest)
- Configure CI/CD (GitHub Actions, etc.)
- Add monitoring & error tracking (Sentry, etc.)

---

**End of Audit Report**
