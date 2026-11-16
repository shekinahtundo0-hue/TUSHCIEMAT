# Tushciemat Student & Parent Portal Transformation — Implementation Plan

## Executive Summary

The audit reveals a solid foundational architecture with comprehensive database schemas but significant gaps in **API endpoints**, **business logic**, and **UI components**. 

**Status**: Database ✅ | API ⚠️ | Frontend ⚠️

**Transformation Approach**: Implement missing API layers, connect to existing database, build rich portal UIs without unnecessary rework of already-working features.

---

## Part A — Current State Assessment

### What's Already Working (Don't Touch)
- ✅ School creation and administration
- ✅ Student registration and guardian linking
- ✅ Academic calendar (years and terms)
- ✅ Class management and teacher assignments
- ✅ Attendance marking and student viewing
- ✅ Basic announcements
- ✅ Authentication and role-based access
- ✅ Multi-tenant data isolation

### What Exists But Is Incomplete
- ⚠️ Student Portal (`/learn`) — exists but has no meaningful content
- ⚠️ Parent Portal (`/family`) — exists but has no meaningful content
- ⚠️ Database schemas for results, learning resources, assignments — fully designed but APIs missing

### What Must Be Built
1. **Results & Assessments API** — marks, grades, publishing workflows
2. **Learning Resources API** — document management, access control
3. **Assignments API** — creation, submission, grading, deadline enforcement
4. **Student/Parent Portal Pages & Components** — rich dashboards, detailed views
5. **Timetable/Scheduling API** — class schedules, lesson management
6. **Staff Management API** — staff records, qualifications (schema exists)

---

## Part B — Implementation Phases

### PHASE 1: API Completion (Weeks 1-2)

#### 1.1 Results & Grading Endpoints

**Files to Create/Modify**:
- `api-server/src/modules/results/router.ts` (new)
- `api-server/src/modules/results/handlers.ts` (new)
- `api-server/src/modules/results/service.ts` (new)
- `api-spec/` — add endpoint schemas

**Endpoints to Implement**:

```
GET    /api/v1/results/my-assessments
       Returns: list of assessments for current student's class in current term
       
GET    /api/v1/results/published
       Returns: published marks for authenticated student (own records only)
       
GET    /api/v1/results/by-subject/:subject
       Returns: marks by subject with trends
       
GET    /api/v1/results/term/:termId
       Returns: term summary for student
       
GET    /api/v1/results/assessment/:assessmentId
       Returns: detailed assessment info + student's mark + feedback
       
POST   /api/v1/results/publish
       Role: admin/principal only
       Body: { termId, classId, assessmentId?, status }
       Publishes marks for specified scope
```

**Database Operations**:
- Query `student_assessment_marks` filtered by:
  - Current student's ID
  - Published result_publications status = 'published'
  - Current academic term
- Join with `assessments`, `assessment_types`, `grading_scales`
- Calculate grades using grading scale
- Return student's own marks only (RLS enforcement)

**Security**:
- Students can only see their own published marks
- Parents can only see verified linked children's published marks
- Marks only visible if result_publications.status = 'published'

---

#### 1.2 Learning Resources Endpoints

**Files to Create**:
- `api-server/src/modules/classroom/resources-router.ts` (new)
- `api-server/src/modules/classroom/resources-service.ts` (new)

**Endpoints**:

```
GET    /api/v1/learning/resources
       Query: ?classId=X&subject=Y&resourceType=Z&limit=50&offset=0
       Returns: paginated list of visible learning resources
       
GET    /api/v1/learning/resources/:resourceId
       Returns: resource details + download URL
       
GET    /api/v1/learning/resources/:resourceId/download
       Returns: signed URL or file stream
       
POST   /api/v1/learning/resources
       Role: teacher/admin
       Body: { classId, title, resourceType, file, ... }
       Creates resource + uploads file to storage
       
GET    /api/v1/learning/resources/recent
       Returns: recently added resources for student's class
       
GET    /api/v1/learning/bookmarks
       Returns: resources bookmarked by current student
       
POST   /api/v1/learning/resources/:resourceId/bookmark
       Toggles bookmark for current student
       
POST   /api/v1/learning/resources/:resourceId/access-log
       Logs student access for analytics
```

**Storage**:
- Supabase Storage bucket: `learning-resources/{schoolId}/{classId}/{resourceId}`
- Access control: signed URLs with expiry, storage policies per school

**Security**:
- Check `learning_resources.isVisibleToStudents = true`
- Check `publishedAt <= now() AND (expiresAt IS NULL OR expiresAt > now())`
- If `restrictedToStudentIds` is not empty, check student ID is in list
- Parents: read-only, see only for verified children's classes

---

#### 1.3 Assignments Endpoints

**Database Work First** — Create assignments table:

```sql
CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  instructions JSONB DEFAULT '[]', -- rich text blocks
  attached_resource_ids JSONB DEFAULT '[]', -- reference to learning_resources
  marks_allocated INTEGER,
  deadline_date DATE NOT NULL,
  deadline_time TIME, -- optional specific time
  allow_resubmission BOOLEAN DEFAULT false,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE assignment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  submission_text TEXT,
  submitted_files JSONB DEFAULT '[]', -- file metadata
  submitted_at TIMESTAMP,
  marked_at TIMESTAMP,
  marks_obtained DECIMAL(8,2),
  feedback TEXT,
  graded_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'not_started', -- not_started, in_progress, submitted, graded, overdue
  
  UNIQUE(assignment_id, student_id),
  INDEX(assignment_id),
  INDEX(student_id),
  INDEX(status)
);
```

**API Endpoints**:

```
GET    /api/v1/assignments
       Query: ?status=pending&limit=20
       Returns: assignments for current student, filtered by status
       
GET    /api/v1/assignments/:assignmentId
       Returns: full assignment details + current student's submission status
       
POST   /api/v1/assignments/:assignmentId/submit
       Body: { text?, fileIds: [] }
       Creates or updates submission
       
PUT    /api/v1/assignments/:assignmentId/submit
       Updates submission before deadline (if resubmission allowed)
       
GET    /api/v1/assignments/:assignmentId/submission
       Returns: current student's submission + feedback + marks
       
# For Teachers/Admin:
POST   /api/v1/assignments
       Role: teacher/admin
       Creates assignment
       
PUT    /api/v1/assignments/:assignmentId
       Updates assignment (only if no submissions yet)
       
GET    /api/v1/assignments/:assignmentId/submissions
       Returns: paginated list of all student submissions
       
POST   /api/v1/assignments/:assignmentId/submissions/:submissionId/mark
       Body: { marksObtained, feedback, approved }
       Grades submission
```

**Business Logic**:
- Enforce deadline: reject submissions after `deadline_date + deadline_time`
- Calculate status based on submission records
- Prevent duplicate submissions unless `allow_resubmission = true`
- Auto-expire to "overdue" status after deadline passes

---

#### 1.4 Timetable/Schedule Endpoints

**New Table**:

```sql
CREATE TABLE class_timetables (
  id UUID PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES school_classes(id),
  day_of_week INTEGER NOT NULL, -- 0 = Monday, 6 = Sunday
  period_number INTEGER NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  subject TEXT NOT NULL,
  teacher_user_id TEXT NOT NULL,
  room_location TEXT,
  
  UNIQUE(class_id, day_of_week, period_number),
  INDEX(class_id, day_of_week)
);
```

**Endpoints**:

```
GET    /api/v1/timetable/today
       Returns: today's schedule for current student's class
       
GET    /api/v1/timetable/week
       Returns: this week's timetable
       
GET    /api/v1/timetable
       Query: ?date=YYYY-MM-DD
       Returns: full timetable for specified date
```

**Security**: Student sees only own class timetable; parent sees verified children's timetables.

---

### PHASE 2: Student Portal UI (Weeks 2-3)

#### 2.1 Create Portal Pages Structure

```
/src/pages/portals/
├── LearnPage.tsx              # Main student portal shell
├── student/
│   ├── dashboard.tsx          # Welcome + overview
│   ├── learning-centre.tsx    # Learning resources
│   ├── assignments.tsx        # Assignment hub
│   ├── results.tsx            # Grades and performance
│   ├── attendance.tsx        # Already exists, refactor
│   ├── timetable.tsx          # Schedule
│   ├── announcements.tsx      # Already exists, refactor
│   ├── profile.tsx            # Account settings
│   └── requests.tsx           # Admin requests
└── FamilyPage.tsx            # Parent portal shell (next phase)
```

#### 2.2 Student Dashboard Component

**File**: `src/pages/portals/student/dashboard.tsx`

**Sections**:

```
┌─ Header ──────────────────────────────────────────────────┐
│ Welcome, [Name] | Admission #: 12345 | Class: Form 3B    │
└───────────────────────────────────────────────────────────┘

┌─ Today's Learning ────────────────────────────────────────┐
│ 9:00 AM - 9:45 AM: Mathematics (Mr. Smith) - Room 102    │
│ 10:00 AM - 10:45 AM: English (Ms. Jones) - Room 105      │
│ [Show next lesson indicator]                              │
└───────────────────────────────────────────────────────────┘

┌─ Academic Overview ───────────────────────────────────────┐
│ Subjects: 8 | Avg Performance: 75% | Attendance: 94%     │
│ [Link to detailed views]                                  │
└───────────────────────────────────────────────────────────┘

┌─ Things Requiring Attention ──────────────────────────────┐
│ • 3 assignments due this week                            │
│ • Math test results published today                      │
│ • 1 new school announcement                              │
│ • [Action buttons]                                        │
└───────────────────────────────────────────────────────────┘

┌─ Recent Activity ─────────────────────────────────────────┐
│ • Submitted: Geography essay (yesterday)                 │
│ • Graded: Term 1 Mathematics (75/100, A)                 │
│ • Accessed: Biology notes - Photosynthesis (today)       │
└───────────────────────────────────────────────────────────┘
```

**Data Queries**:

```typescript
// Get student info
useGetStudentProfile() // from api

// Get timetable for today
useGetTimetableForDate(new Date())

// Get pending assignments
useListAssignments({ status: ['pending', 'in_progress', 'overdue'] })

// Get published results (this term)
useListPublishedResults({ termId: currentTerm.id })

// Get attendance percentage
useGetAttendanceSummary()

// Get announcements (recent)
useListAnnouncements({ limit: 5, sort: 'recent' })
```

**UI/UX Features**:
- Countdown to next lesson
- Overdue assignment highlight
- Attendance alert if below threshold
- Quick-access cards to main features
- Mobile-responsive layout

---

#### 2.3 Learning Centre Component

**File**: `src/pages/portals/student/learning-centre.tsx`

**Layout**:

```
┌─ Header ──────────────────────────────────────────┐
│ Learning Centre | [Search] | Filter by: [Subject] │
└──────────────────────────────────────────────────┘

┌─ Navigation ──────────────────────────────────────┐
│ My Subjects | Recent | Bookmarked | Downloads    │
└──────────────────────────────────────────────────┘

┌─ Resource Grid / List ────────────────────────────┐
│ [Subject: Mathematics]                            │
│ • PDF: Quadratic Equations - 2 MB                │
│ • PPTX: Trigonometry - 5 MB                      │
│ • VIDEO: Calculus Basics - 45 min                │
│ • LINK: Khan Academy - Algebra                   │
│                                                  │
│ [Subject: English]                              │
│ ...                                              │
└──────────────────────────────────────────────────┘

[Pagination controls]
```

**Features**:
- View learning resources by subject
- Filter by type (PDF, PPTX, VIDEO, LINK)
- Search by title/content
- Bookmark resources
- Download where permitted
- File preview for PDFs/images
- Recent viewed items
- Download history tracking

**Data Queries**:
```typescript
useListLearningResources({
  classId: student.classId,
  subject: selectedSubject,
  resourceType: selectedType,
  limit: 20,
  offset: page * 20
})

useGetBookmarks() // for bookmarked section

useAccessResource(resourceId) // log access
```

---

#### 2.4 Assignments Centre Component

**File**: `src/pages/portals/student/assignments.tsx`

**Layout**:

```
┌─ Filters ───────────────────────────────────────┐
│ Status: [All▼] | Subject: [All▼] | Due: [▼]    │
└────────────────────────────────────────────────┘

┌─ Assignment Cards ──────────────────────────────┐
│ [OVERDUE - Red] Mathematics: Algebra Problem Set│
│ Due: Yesterday | 2 marks | Not started         │
│ [View] [Submit]                                 │
│                                                 │
│ [SUBMITTED - Blue] English: Essay Submission   │
│ Due: Fri, 29 Nov | 10 marks | Submitted       │
│ Grade: Awaiting | [View Feedback]              │
│                                                 │
│ [IN PROGRESS - Yellow] Science: Lab Report    │
│ Due: Sun, 1 Dec | 15 marks | Draft saved      │
│ [Continue] [Submit]                            │
│                                                 │
│ [GRADED - Green] History: Project              │
│ Due: Wed, 28 Nov | 20 marks | Grade: 18/20 (A)│
│ [View Details] [View Feedback]                 │
└────────────────────────────────────────────────┘
```

**Statuses** (color-coded):
- Not started — gray
- In progress — yellow
- Submitted — blue
- Graded — green
- Overdue — red
- Awaiting review — orange

**Assignment Detail View**:

```
┌─ Header ──────────────────────────────────────┐
│ Mathematics: Algebra Problem Set               │
│ Subject: Mathematics | Marks: 2 | Deadline: ▢ │
└──────────────────────────────────────────────┘

┌─ Instructions ────────────────────────────────┐
│ Solve the following problems using the ...    │
│ [Attached Resources: 3 files]                 │
│   - chapter-5-notes.pdf                       │
│   - worked-examples.docx                      │
│   - formulas-reference.pdf                    │
└──────────────────────────────────────────────┘

┌─ Your Submission ─────────────────────────────┐
│ Status: Not started                            │
│ Due: Tomorrow at 11:59 PM (18 hours left)     │
│                                                │
│ [Text input or file upload area]              │
│                                                │
│ [Save Draft] [Submit for Grading]             │
│                                                │
│ OR                                             │
│                                                │
│ Grade: 18/20 (A) | Submitted: 28 Nov 3:45 PM │
│ Feedback: Great work! Minor improvements...   │
└──────────────────────────────────────────────┘
```

**Submission Flow**:
1. Student views assignment
2. Downloads attached resources
3. Enters response (text or uploads files)
4. Saves draft (auto-save every 30s)
5. Submits for grading (locks further edits unless resubmission allowed)
6. Receives mark and feedback after teacher grades

**Data Queries**:
```typescript
useListAssignments(filters) // paginated list
useGetAssignmentDetail(assignmentId) // full details
useSubmitAssignment(assignmentId, submission) // POST
useListSubmissionHistory(assignmentId) // for re-submissions
```

---

#### 2.5 Results Component

**File**: `src/pages/portals/student/results.tsx`

**Layout**:

```
┌─ Term Selector ──────────────────────────────┐
│ Current Term: Term 1, 2025 [Dropdown]        │
│ Academic Year: 2024/2025                     │
└────────────────────────────────────────────┘

┌─ Performance Summary ────────────────────────┐
│ Average Grade: B+ (78%)                      │
│ Best Subject: Mathematics (92%)              │
│ Needs Improvement: Languages (62%)           │
│ Class Position: 5th out of 42                │
└────────────────────────────────────────────┘

┌─ Subject Results ───────────────────────────┐
│ Subject | Assessments | Best | Avg  | Grade │
├─────────┼─────────────┼─────┼─────┼──────┤
│ Maths   │ 4 taken     │ 95  │ 82  │ A    │
│ English │ 3 taken     │ 88  │ 75  │ B    │
│ Science │ 5 taken     │ 92  │ 78  │ B+   │
│ History │ 2 taken     │ 85  │ 72  │ C+   │
│ PE      │ 1 taken     │ 88  │ 88  │ A-   │
└────────────────────────────────────────────┘

[Charts showing performance trends over time]
```

**Charts** (Chart.js or Recharts):
1. Subject Performance Comparison (bar chart)
2. Assessment Trend (line chart over time)
3. Grade Distribution (pie chart)
4. Progress Over Terms (multi-line chart)

**Detail View** — Click a subject:

```
┌─ Mathematics - Detailed Record ──────────────┐
│ Term 1, 2025 Results                         │
│                                              │
│ Assessment | Date  | Marks | Grade | Trend  │
├────────────┼───────┼───────┼───────┼────────┤
│ Midterm    │ 15 Sep│ 85/95 │ A-    │ ↑     │
│ Coursework │ 22 Oct│ 80/85 │ A-    │ →     │
│ Assignment │ 1 Nov │ 92/95 │ A     │ ↑     │
│ Exam       │ 10 Nov│ 75/95 │ B+    │ ↓     │
│ TERM AVG   │       │ 82/95 │ A-    │       │
│ Teacher: Mr. Smith                         │
│ Comments: Good progress overall...         │
└────────────────────────────────────────────┘
```

**Restrictions**:
- Only published results visible
- Show "Not yet published" for pending marks
- No internal moderation notes visible
- Clear "This is your data only" messaging

---

#### 2.6 Refactor Existing Pages

- `attendance.tsx` — enhance with monthly summary view
- `announcements.tsx` — add filters, read/unread status
- `profile.tsx` — add account verification, emergency contact update

---

### PHASE 3: Parent Portal UI (Weeks 3-4)

#### 3.1 Family Dashboard

**File**: `src/pages/portals/parent/family-dashboard.tsx`

**Layout**:

```
┌─ Welcome ──────────────────────────────────────────┐
│ Welcome, Jane Smith | Parent Portal                │
│ School: Sunshine High School                       │
└────────────────────────────────────────────────────┘

┌─ Children Overview ────────────────────────────────┐
│ [Select Child ▼] Currently viewing: John (Form 3B)│
│                                                    │
│ Your Children:                                     │
│ • John Smith - Form 3B - Active ✓                │
│ • Sarah Smith - Form 1A - Active ✓               │
│ • [Add child request] (if enabled)                │
└────────────────────────────────────────────────────┘

┌─ Academic Overview (John) ─────────────────────────┐
│ Current Term: Term 1, 2025                        │
│ Average Performance: 78%                          │
│ Attendance: 94%                                   │
│ Outstanding Assignments: 2                        │
│ Latest Results: Published Today                   │
│ [View Full Academic Record]                       │
└────────────────────────────────────────────────────┘

┌─ Attention Required ───────────────────────────────┐
│ • 2 assignments approaching deadline (3-5 days)   │
│ • 1 absence recorded (28 Nov)                     │
│ • New announcements from school                   │
│ • Request response pending                        │
└────────────────────────────────────────────────────┘

┌─ Recent Communications ────────────────────────────┐
│ • School announcement: Term 2 Dates (Today)       │
│ • Class notice: PE uniform change (Yesterday)     │
│ • Important: Exam schedule published (2 days ago) │
│ [View All Communications]                         │
└────────────────────────────────────────────────────┘
```

**Child Switching Behavior**:
- When parent selects a different child, ALL child-specific sections update
- Query parameters or state management: `?child=sarah-id`
- No data leakage between children

---

#### 3.2 Academic Monitoring (Parent View)

**File**: `src/pages/portals/parent/academic-monitoring.tsx`

**Read-Only Sections**:
- Published results only
- Assignment submission deadlines (not submission details)
- Grades and feedback
- Performance trends

**Permission Model**:
```
Parent can see:
✓ Published exam results
✓ Assignment deadlines and submission status
✓ Teacher comments on published results
✓ Grade history and trends

Parent CANNOT see:
✗ Teacher's draft marks or internal notes
✗ Detailed work content/writing (if applicable)
✗ Fellow student comparisons or class rankings
✗ Ungraded/pending assessment submissions
```

---

#### 3.3 Attendance Monitoring (Parent View)

**Features**:
- Monthly attendance calendar
- Attendance percentage trend
- Breakdown: Present | Absent | Late | Excused
- Absence explanation (if school allows submission)

```
┌─ Monthly Attendance: November ─────────────────────┐
│ Attendance Rate: 94% (5 absences, 1 late)        │
│                                                   │
│ [Calendar grid showing each day]                 │
│ ✓ = Present | ✗ = Absent | ⧖ = Late | ~ = Excused│
│                                                   │
│ [If absence can be explained]                    │
│ [Request Absence Explanation form]               │
└───────────────────────────────────────────────────┘
```

---

#### 3.4 Assignment Monitoring (Parent View)

**Features**:
- Upcoming assignments for selected child
- Due dates, marks allocated
- Submission status (submitted/not started/overdue)
- **Not**: detailed assignment instructions or student work

```
┌─ John's Upcoming Assignments ──────────────────────┐
│ Subject | Assignment | Due Date | Status | Marks   │
├─────────┼────────────┼──────────┼────────┼─────────┤
│ English │ Essay      │ Wed 29   │ Draft  │ 10      │
│ Maths   │ Problems   │ Thu 30   │ Over   │ 2       │
│ Science │ Lab Report │ Fri 1    │ Pend.  │ 15      │
│ History │ Project    │ Sun 3    │ ✓ Done │ 20      │
└────────────────────────────────────────────────────┘

[Information: Parents see submission deadlines but not draft content]
```

---

#### 3.5 Communication Centre (Parent View)

**Features**:
- School-wide announcements
- Class announcements for each child
- Read/unread status
- Mark as important for follow-up

---

### PHASE 4: Cross-System Integration & QA (Week 5)

#### 4.1 Backend Verification

**Checklist**:
- [ ] All API endpoints return correct data
- [ ] RLS policies enforce proper access control
- [ ] Student sees own data only
- [ ] Parent sees verified children only
- [ ] No cross-school data leakage
- [ ] Marks only visible when published

#### 4.2 Frontend Verification

**Student Portal**:
- [ ] Dashboard loads actual student info
- [ ] Correct class and subjects displayed
- [ ] Timetable shows real schedule
- [ ] Published results visible
- [ ] Assignments track actual deadlines
- [ ] Attendance history accurate
- [ ] Announcements reach correct students

**Parent Portal**:
- [ ] Child switching works correctly
- [ ] All data updates when child changes
- [ ] Published results visible
- [ ] Unpublished results protected
- [ ] Announcements filtered by child's class
- [ ] No data leakage between children

#### 4.3 Performance Optimization

- [ ] Lazy load components
- [ ] Paginate large lists
- [ ] Cache queries appropriately
- [ ] Optimize charts rendering
- [ ] Test on mobile/tablet

#### 4.4 Responsive Design Verification

- [ ] 320px screens: no clipping, usable navigation
- [ ] 375px screens: readable text, accessible buttons
- [ ] Tablet: good use of space
- [ ] Desktop: professional layout
- [ ] Charts adapt to screen size

---

## Part C — Acceptance Criteria

### Student Portal Must Demonstrate:

1. **Dashboard loads with student's real data**
   - Correct name, admission number, class
   - Today's actual timetable
   - Real assignments with real deadlines
   - Published results showing real marks

2. **Learning Centre works**
   - Resources appear for student's class
   - Can search and filter
   - Can bookmark and download

3. **Assignments track correctly**
   - Pending work shows as pending
   - Submitted work shows as submitted with timestamp
   - Graded work shows marks and feedback
   - Overdue shows with deadline context

4. **Results accurate**
   - Shows published marks only
   - Matches database records
   - No fabricated data

5. **No system errors**
   - All routes load
   - No console errors
   - No 500 errors

---

### Parent Portal Must Demonstrate:

1. **Child linking works**
   - Shows verified linked children
   - Cannot access unlinked children
   - Can switch between children

2. **Data updates on child switch**
   - Academic records change
   - Attendance changes
   - Announcements change
   - All info pertains to selected child

3. **Data protection**
   - Cannot see other families' children
   - Cannot see unpublished results
   - Cannot see unverified children

4. **Communication reaches correctly**
   - Sees school announcements
   - Sees class announcements for each child's class
   - Does not see other classes' announcements

---

## Part D — Technical Architecture

### Database Changes Required

**New Tables**:
- `assignments` — assignment records
- `assignment_submissions` — student work submissions
- `class_timetables` — weekly class schedules

**Existing Tables to Use**:
- `students`, `student_guardians`, `guardians` ✓
- `school_classes`, `academic_years`, `terms` ✓
- `student_assessment_marks`, `assessments`, `grading_scales` ✓
- `learning_resources`, `class_lessons` ✓
- `announcements_extended`, `announcement_deliveries` ✓
- `attendance_records` ✓

### API Module Structure

```
api-server/src/modules/
├── results/
│   ├── router.ts
│   ├── handlers.ts
│   ├── service.ts
│   └── queries.ts
├── classroom/
│   ├── resources-router.ts
│   ├── resources-service.ts
│   ├── timetable-router.ts
│   └── timetable-service.ts
├── assignments/ (new)
│   ├── router.ts
│   ├── handlers.ts
│   ├── service.ts
│   └── queries.ts
└── portal/
    ├── student-router.ts (new)
    ├── parent-router.ts (new)
    └── queries.ts (new)
```

### Frontend Structure

```
src/pages/portals/
├── LearnPage.tsx (student portal shell)
├── FamilyPage.tsx (parent portal shell)
├── student/
│   ├── dashboard.tsx
│   ├── learning-centre.tsx
│   ├── assignments.tsx
│   ├── results.tsx
│   ├── timetable.tsx
│   ├── announcements.tsx
│   ├── attendance.tsx
│   └── profile.tsx
└── parent/
    ├── family-dashboard.tsx
    ├── academic-monitoring.tsx
    ├── attendance-monitoring.tsx
    ├── assignment-monitoring.tsx
    ├── communication-centre.tsx
    └── child-management.tsx
```

### Components (Reusable)

- `AssignmentCard` — display assignment in list
- `ResultsChart` — performance visualization
- `AttendanceCalendar` — monthly view
- `ResourceGrid` — learning materials layout
- `AnnouncementCard` — announcement display
- `ChildSelector` — parent portal child switcher

---

## Part E — Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Data leakage between students | RLS policies at database level, validated at API |
| Parent accessing other families | Foreign key constraints, verified linking only |
| Stale data in portals | React Query refetch on window focus, 5min default |
| Broken assignment deadlines | Server-side validation, not frontend-dependent |
| File upload security | Supabase storage policies, signed URLs |
| Performance with large datasets | Pagination, indexes on frequently-queried columns |

---

## Part F — Development Timeline

**Total Duration**: 5 weeks

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1-2 | API Completion | Results, Resources, Assignments, Timetable endpoints |
| 2-3 | Student Portal | Dashboard, Learning, Assignments, Results, Timetable pages |
| 3-4 | Parent Portal | Family Dashboard, Monitoring, Communication pages |
| 4-5 | Integration & QA | Cross-system testing, performance, responsive design |
| 5 | Final QA & Deploy | All acceptance criteria verified |

---

## Part G — What NOT To Do

- ❌ Do NOT rebuild working features (attendance, announcements, authentication)
- ❌ Do NOT duplicate database tables
- ❌ Do NOT skip RLS enforcement and rely on frontend checks alone
- ❌ Do NOT create mock data presented as real
- ❌ Do NOT implement features that can't be supported by backend
- ❌ Do NOT ignore responsive design until end
- ❌ Do NOT skip database migrations

---

## Success Definition

**The standard is simple**: 

A student should be able to use Tushciemat as their daily digital learning environment:
- See their schedule
- Access learning materials
- Submit assignments
- Check grades
- Track attendance
- Receive school communications

A parent should be able to use it as their reliable window into their child's school life:
- Monitor academic progress
- See attendance patterns
- Track assignments
- Receive school communications
- Verify multiple children's records

All powered by real data from the school management system, with proper security and no data leakage.

---

## Approval Checkpoint

Before proceeding to development:

- [ ] Plan is reviewed and understood
- [ ] Database structure for assignments approved
- [ ] API endpoint contracts defined
- [ ] Component architecture agreed upon
- [ ] Acceptance criteria locked in
- [ ] Team capacity confirmed for 5-week sprint

Proceed? **START PHASE 1**
