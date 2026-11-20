# Tushciemat Portals — Testing Guide

## Complete Testing Checklist

Use this guide to verify all functionality works correctly before deploying.

---

## SETUP

### Prerequisites
- [ ] Database migrations applied (`lib/db/pnpm run migrate`)
- [ ] API server running (`artifacts/api-server pnpm run dev`)
- [ ] Frontend dev server running (`artifacts/tushciemat pnpm run dev`)
- [ ] Test users created in Firebase auth
- [ ] Test data seeded in database

### Test Users

Create these test users:

**Student:**
- Email: `student@test.com`
- Password: `Test123!`
- Role: student
- School: Test School
- Class: Form 3B
- Admission: `STU001`

**Parent:**
- Email: `parent@test.com`
- Password: `Test123!`
- Role: parent
- Linked to: student@test.com

**Teacher:**
- Email: `teacher@test.com`
- Password: `Test123!`
- Role: teacher
- School: Test School

**Admin:**
- Email: `admin@test.com`
- Password: `Test123!`
- Role: principal/admin
- School: Test School

---

## STUDENT PORTAL TESTING

### 1. Authentication & Login

- [ ] Navigate to `/learn` — redirects to `/sign-in`
- [ ] Enter invalid email — error message appears
- [ ] Enter invalid password — error message appears
- [ ] Enter valid student credentials — redirects to `/learn`
- [ ] User stays logged in after page refresh
- [ ] Logout button works
- [ ] Cannot access `/family` as student — redirected to `/home`

**Expected**: ✓ User authenticated and session persists

### 2. Dashboard Page

```
Route: /learn
```

- [ ] Page loads within 2 seconds
- [ ] Welcome message shows student's first name
- [ ] Admission number displays correctly
- [ ] School name shows: "Test School"
- [ ] Class shows: "Form 3B"
- [ ] Today's date displays at top right
- [ ] No console errors

#### Today's Schedule Section
- [ ] Displays today's lessons from database
- [ ] Current lesson highlighted with "NOW" badge (if applicable)
- [ ] Next lesson highlighted with "NEXT" badge
- [ ] Lesson times show correctly (e.g., "9:00 - 9:45")
- [ ] Teacher names display
- [ ] Room numbers show

#### Academic Overview
- [ ] Shows correct number of subjects
- [ ] Attendance percentage displays (from database)
- [ ] Shows count of outstanding assignments
- [ ] Statistics load from real data (not mocked)

#### Attention Required Section
- [ ] Overdue assignments alert appears (if any)
- [ ] "Due soon" alert appears for assignments due in 3-5 days
- [ ] Results alert appears when results published
- [ ] Announcement alert shows unread count
- [ ] Each alert has a "View" button linking to relevant page
- [ ] "All caught up" message when no alerts

#### Quick Actions
- [ ] 4 buttons present: Learning, Assignments, Results, Timetable
- [ ] Each button links to correct page
- [ ] Buttons have proper styling

**Expected**: ✓ Dashboard loads with real student data

### 3. Learning Centre Page

```
Route: /learn/learning
```

- [ ] Page loads within 2 seconds
- [ ] Search bar is visible and functional
- [ ] Subject filter dropdown populated
- [ ] Resource type filter has options (PDF, PPTX, DOCX, Video, etc.)
- [ ] Tabs visible: All Materials, Recent, Bookmarked

#### Search Functionality
- [ ] Type text → resources filter in real-time
- [ ] Clear search → shows all resources
- [ ] No results → displays "No materials found"

#### Filters
- [ ] Select subject → resources filter
- [ ] Select type → shows only that type
- [ ] Combine filters → correct intersection
- [ ] Reset filters → shows all resources

#### Resource Cards
- [ ] Display resource icon based on type
- [ ] Show resource title
- [ ] Show description (if available)
- [ ] Show upload date
- [ ] Show file size
- [ ] Bookmark button toggles (star icon)
- [ ] View/Download buttons present

#### Pagination
- [ ] Shows 12 resources per page
- [ ] Previous/Next buttons work
- [ ] Page indicator shows current page
- [ ] Can jump between pages

#### Bookmarks Tab
- [ ] Click bookmark on resource
- [ ] Resource moves to Bookmarked tab
- [ ] Click again to unbookmark
- [ ] Bookmarks persist after refresh

**Expected**: ✓ All materials accessible and filterable

### 4. Assignments Page

```
Route: /learn/assignments
```

- [ ] Page loads within 2 seconds
- [ ] Lists all assignments for student's class

#### Status Badge Colors
- [ ] Not started — gray
- [ ] In progress — yellow
- [ ] Submitted — blue
- [ ] Graded — green
- [ ] Overdue — red

#### Filters
- [ ] Status filter works (All, Not Started, In Progress, etc.)
- [ ] Subject filter works
- [ ] Due date filter works (All, This Week, Overdue)

#### Assignment Cards
- [ ] Show assignment title
- [ ] Show subject
- [ ] Show marks allocated
- [ ] Show due date with days remaining
- [ ] Show current status
- [ ] Show grade if graded
- [ ] "View Details" button clickable

#### Assignment Detail View
- [ ] Opens in panel on right (desktop) or modal (mobile)
- [ ] Shows full title and subject
- [ ] Shows marks and deadline
- [ ] Shows instructions
- [ ] Shows attached resources (if any)

#### Submission Form
- [ ] Text area for response
- [ ] File upload area
- [ ] "Submit for Grading" button
- [ ] "Clear" button resets form
- [ ] After submission:
  - [ ] "Submission confirmation" message appears
  - [ ] Status changes to "Submitted"
  - [ ] Can view submission
  - [ ] Cannot edit after submission

#### Graded Assignment
- [ ] Shows grade: `marks/total`
- [ ] Shows teacher feedback
- [ ] Shows submission timestamp
- [ ] No edit option

#### Overdue Assignment
- [ ] Shows "Deadline passed" alert
- [ ] Cannot submit new work
- [ ] Can view previous submission if exists

**Expected**: ✓ All assignments tracked correctly

### 5. Results Page

```
Route: /learn/results
```

- [ ] Page loads within 2 seconds
- [ ] Term selector shows available terms
- [ ] Current term pre-selected

#### Performance Summary
- [ ] Shows average grade percentage
- [ ] Shows best subject
- [ ] Shows subject needing improvement

#### Results Table
- [ ] Lists all subjects
- [ ] Shows assessment count
- [ ] Shows best mark
- [ ] Shows average percentage
- [ ] Shows grade letter
- [ ] Rows clickable

#### Subject Detail View
- [ ] Shows each assessment individually
- [ ] Shows date of assessment
- [ ] Shows marks obtained
- [ ] Shows calculated percentage
- [ ] Shows grade
- [ ] Shows teacher feedback (if any)

#### No Results State
- [ ] Shows friendly message when no results published
- [ ] Shows "Awaiting publication" hint

**Expected**: ✓ All published results visible

### 6. Timetable Page

```
Route: /learn/timetable
```

- [ ] Page loads within 2 seconds

#### Today View
- [ ] Shows all lessons for today
- [ ] Current lesson highlighted (if happening now)
- [ ] Next lesson highlighted (if any)
- [ ] Shows time, subject, teacher, room for each
- [ ] Lessons in chronological order

#### Week View
- [ ] Table displays Monday-Friday
- [ ] All periods shown (usually 7-8)
- [ ] Each cell shows subject and teacher
- [ ] Accurate days of the week
- [ ] Responsive on mobile (shows fewer columns)

#### View Toggle
- [ ] Button to switch between Today/Week
- [ ] Active view highlighted
- [ ] Switching views is instant

**Expected**: ✓ Timetable displays correct schedule

### 7. Profile Page

```
Route: /learn/profile
```

- [ ] Page loads within 2 seconds
- [ ] Shows student name (read-only)
- [ ] Shows admission number (read-only)
- [ ] Shows email (read-only)
- [ ] Shows school name (read-only)
- [ ] Shows class (read-only)

#### Change Password
- [ ] Current password field present
- [ ] New password field present
- [ ] Confirm password field present
- [ ] Submit button disabled when fields empty
- [ ] Password validation:
  - [ ] Min 8 characters required
  - [ ] New and confirm must match
  - [ ] Success message on update
  - [ ] Error message on failure
- [ ] Fields clear after successful update

#### Emergency Contacts
- [ ] Shows primary guardian name
- [ ] Shows guardian phone
- [ ] Shows guardian email

**Expected**: ✓ Profile information complete

### 8. Announcements Page

```
Route: /learn/announcements
```

- [ ] Page loads within 2 seconds
- [ ] Lists announcements for student's class
- [ ] Shows announcement title
- [ ] Shows full body text
- [ ] Shows publication date
- [ ] Shows read/unread status
- [ ] Can mark as read/unread
- [ ] Filter by read status works
- [ ] Search announcements works

**Expected**: ✓ Announcements reach intended students

### 9. Responsive Design - Student Portal

#### Mobile (320px)
- [ ] No horizontal scrolling
- [ ] Text readable
- [ ] Buttons tappable (48px minimum)
- [ ] Navigation drawer opens/closes
- [ ] Tables stack vertically

#### Tablet (768px)
- [ ] Good use of horizontal space
- [ ] 2-column layouts work
- [ ] Cards properly spaced

#### Desktop (1024px+)
- [ ] Sidebar navigation visible
- [ ] Content area properly sized
- [ ] No huge empty spaces

**Expected**: ✓ All breakpoints responsive

---

## PARENT PORTAL TESTING

### 1. Authentication & Login

- [ ] Navigate to `/family` — redirects to `/sign-in`
- [ ] Enter parent credentials
- [ ] Redirects to `/family` dashboard
- [ ] Session persists after refresh
- [ ] Cannot access `/learn` as parent

**Expected**: ✓ Parent authenticated

### 2. Family Dashboard

```
Route: /family
```

- [ ] Page loads within 2 seconds
- [ ] Shows "Family Portal" title

#### Child Selector
- [ ] Shows all verified linked children
- [ ] Currently viewing child highlighted
- [ ] Clicking child updates all sections
- [ ] Child name displayed in dropdown

#### Child Info Card
- [ ] Shows selected child's name
- [ ] Shows child's admission number
- [ ] Shows school name
- [ ] Shows class

#### Academic Overview
- [ ] Shows average performance (%)
- [ ] Shows attendance percentage
- [ ] Shows number of outstanding assignments

#### Attention Centre
- [ ] Shows alerts for:
  - [ ] Overdue assignments (if any)
  - [ ] Low attendance (if < 85%)
  - [ ] New results
  - [ ] New announcements
- [ ] Each alert has "View" button
- [ ] Clicking "View" navigates to correct page

#### Recent Communications
- [ ] Shows 3 most recent announcements
- [ ] Shows "View all" button
- [ ] Clicking expands or navigates

#### Quick Access Buttons
- [ ] 4 buttons: Academic, Attendance, Assignments, Communications
- [ ] Each links to correct page

**Expected**: ✓ Family dashboard functional

### 3. Academic Monitoring Page

```
Route: /family/academic
```

- [ ] Page loads within 2 seconds
- [ ] Shows selected child's name in header

#### Published Results Only
- [ ] **Shows**: Published results
- [ ] **Does NOT show**: Draft marks
- [ ] **Does NOT show**: Pending review marks
- [ ] **Does NOT show**: Internal moderation notes

#### Performance Summary
- [ ] Shows average grade percentage
- [ ] Shows best subject
- [ ] Shows subject needing work

#### Results Table
- [ ] Lists subjects
- [ ] Shows assessment count
- [ ] Shows average percentage
- [ ] Shows grade

#### Data Protection Notice
- [ ] Visible and informative
- [ ] Explains what is/isn't shown
- [ ] Suggests contacting teachers for details

**IMPORTANT**: ✓ Verify unpublished results are NOT visible

### 4. Attendance Monitoring

```
Route: /family/attendance
```

- [ ] Page loads within 2 seconds
- [ ] Shows overall attendance percentage
- [ ] Shows days present
- [ ] Shows days absent
- [ ] Shows late arrivals

#### Alerts
- [ ] If attendance < 85%: red alert appears
- [ ] Alert suggests contacting school
- [ ] Alert is not dismissible (persistent)

**Expected**: ✓ Attendance data accurate

### 5. Assignment Monitoring

```
Route: /family/assignments
```

- [ ] Page loads within 2 seconds
- [ ] Lists all assignments for child

#### What Parents CAN See
- [ ] Assignment title
- [ ] Subject
- [ ] Due date
- [ ] Marks allocated
- [ ] Submission status (not started, submitted, graded)
- [ ] Grade (if graded)

#### What Parents CANNOT See
- [ ] Assignment instructions (locked)
- [ ] Student's work/submission text (locked)
- [ ] Teacher's detailed feedback (locked)

#### Alerts
- [ ] Overdue assignments alert
- [ ] Assignments due soon alert
- [ ] Privacy notice explaining limitations

**IMPORTANT**: ✓ Verify assignment work is hidden

### 6. Communication Centre

```
Route: /family/communications
```

- [ ] Page loads within 2 seconds
- [ ] Lists announcements for child's class
- [ ] Shows only relevant class announcements
- [ ] Does NOT show announcements from other classes

#### Announcements
- [ ] Title visible
- [ ] Body text visible
- [ ] Publication date shown
- [ ] Attachment count shown (if any)

**Expected**: ✓ Correct announcements filtered

### 7. Child Management

```
Route: /family/children
```

- [ ] Lists all verified linked children
- [ ] Shows each child's:
  - [ ] Name
  - [ ] Admission number
  - [ ] School
  - [ ] Class
  - [ ] Relationship
  - [ ] Status

#### Multiple Children
- [ ] Verify parent can have multiple children
- [ ] Each child card distinct
- [ ] Information accurate for each

**Expected**: ✓ All children listed

### 8. Child Switching

- [ ] In `/family`, click different child
- [ ] Dashboard updates with new child's data
- [ ] Navigate to `/family/academic`
- [ ] Results are for new child (not previous)
- [ ] Navigate to `/family/attendance`
- [ ] Attendance is for new child
- [ ] Navigate to `/family/assignments`
- [ ] Assignments are for new child
- [ ] Switching is seamless with no loading errors

**CRITICAL**: ✓ No data leakage between children

### 9. Responsive Design - Parent Portal

Same as student portal (see section 8 above)

---

## SECURITY TESTING

### 1. Data Isolation

#### Student Cannot Access Other Student's Data
- [ ] Log in as student1
- [ ] Get student1's assignment ID
- [ ] Log in as student2
- [ ] Try to navigate to student1's assignment (by URL)
- [ ] Should be forbidden or show student2's data only
- [ ] Check database — RLS policy blocks access

#### Parent Cannot Access Other Parent's Children
- [ ] Log in as parent1
- [ ] Get child1's ID
- [ ] Log in as parent2
- [ ] Try to view child1's data
- [ ] Should show "not linked" or forbidden
- [ ] Check database — student_guardians relationship enforced

### 2. Cross-School Isolation

- [ ] Create student in School A
- [ ] Create student in School B
- [ ] Create parent for student in School A
- [ ] Log in as parent
- [ ] Verify parent CANNOT see student from School B
- [ ] Verify announcements only show School A's class
- [ ] Verify timetable only shows School A's schedule

**Expected**: ✓ Complete data isolation by school

### 3. Published Results Protection

- [ ] As admin, create result with status='draft'
- [ ] Log in as student
- [ ] Verify result NOT visible
- [ ] As admin, change status to 'published'
- [ ] Log in as student
- [ ] Verify result NOW visible

**Expected**: ✓ Draft results protected

### 4. Assignment Deadline Enforcement

- [ ] Create assignment with past deadline
- [ ] Log in as student
- [ ] Attempt to submit work
- [ ] Should show "deadline passed" error
- [ ] Create assignment with future deadline
- [ ] Should allow submission
- [ ] Navigate past deadline
- [ ] Should block new submissions

**Expected**: ✓ Deadlines enforced server-side

### 5. Role-Based Access

- [ ] Student cannot access `/admin` routes
- [ ] Student cannot access `/teach` routes
- [ ] Parent cannot access `/learn` routes
- [ ] Parent cannot access `/admin` routes
- [ ] Teacher cannot access `/family` routes

**Expected**: ✓ Roles properly enforced

---

## PERFORMANCE TESTING

### Load Times

Measure in browser DevTools Network tab:

- [ ] Dashboard: < 2 seconds
- [ ] Learning Centre: < 2 seconds
- [ ] Assignments: < 2 seconds
- [ ] Results: < 2 seconds
- [ ] Timetable: < 2 seconds

### API Response Times

Measure in browser Network tab:

- [ ] GET assignments: < 500ms
- [ ] GET results: < 500ms
- [ ] GET resources: < 500ms
- [ ] POST submit: < 800ms

### Database Query Performance

- [ ] No queries > 200ms
- [ ] No N+1 queries
- [ ] Pagination used on large lists

---

## BROWSER COMPATIBILITY

Test in:
- [ ] Chrome/Chromium (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

**Expected**: ✓ No console errors in any browser

---

## FINAL CHECKLIST

Before deploying to production:

### Code Quality
- [ ] No TypeScript errors (`pnpm run typecheck`)
- [ ] No console errors
- [ ] No console warnings
- [ ] All components load
- [ ] All routes functional

### Functionality
- [ ] All STUDENT portal features work ✓
- [ ] All PARENT portal features work ✓
- [ ] Child switching works correctly ✓
- [ ] No data leakage ✓

### Security
- [ ] RLS policies enabled in Postgres ✓
- [ ] Students see own data only ✓
- [ ] Parents see verified children only ✓
- [ ] Published results enforced ✓
- [ ] Cross-school isolation ✓

### Performance
- [ ] Pages load < 2 seconds ✓
- [ ] APIs respond < 500ms ✓
- [ ] No N+1 queries ✓

### Responsive Design
- [ ] Mobile (320px) ✓
- [ ] Tablet (768px) ✓
- [ ] Desktop (1024px+) ✓

### Documentation
- [ ] All features documented ✓
- [ ] User guide clear ✓
- [ ] API endpoints documented ✓

---

## SIGN-OFF

Testing Completed By: ___________________
Date: ___________________
Status: ✅ APPROVED / ❌ NEEDS WORK

**Notes:**
```
[Space for testing notes]
```

---

**Ready for Production Deployment? ✅ YES / ❌ NO**

If NO, list blockers:
1. 
2. 
3.

