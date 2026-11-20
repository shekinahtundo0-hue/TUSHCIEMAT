# Tushciemat Portals — Quick Start Guide

## For Developers: Getting Started with the New Portals

### Directory Structure

```
artifacts/tushciemat/src/
├── pages/portals/
│   ├── LearnPage.tsx           # Student portal shell
│   ├── FamilyPage.tsx          # Parent portal shell
│   ├── student/
│   │   ├── dashboard.tsx       # Student welcome & overview
│   │   ├── learning-centre.tsx # Learning materials
│   │   ├── assignments.tsx     # Assignment hub
│   │   ├── results.tsx         # Grades & results
│   │   ├── timetable.tsx       # Schedule
│   │   ├── profile.tsx         # Account settings
│   │   └── *.css               # Styles
│   └── parent/
│       ├── family-dashboard.tsx        # Parent overview
│       ├── academic-monitoring.tsx     # Grades view
│       ├── attendance-monitoring.tsx   # Attendance view
│       ├── assignment-monitoring.tsx   # Assignment view
│       ├── communication-centre.tsx    # Announcements
│       ├── child-management.tsx        # Child linking
│       └── parent-pages.css            # Shared styles
│
├── components/portals/
│   ├── StudentPortalNav.tsx    # Student navigation
│   ├── FamilyPortalNav.tsx     # Parent navigation
│   └── portal-nav.css          # Nav styles
```

### Key Routes

**Student Portal:**
- `/learn` — Dashboard
- `/learn/learning` — Learning centre
- `/learn/assignments` — Assignments
- `/learn/results` — Results
- `/learn/timetable` — Timetable
- `/learn/announcements` — Announcements
- `/learn/profile` — Profile

**Parent Portal:**
- `/family` — Family dashboard
- `/family/academic` — Academic monitoring
- `/family/attendance` — Attendance
- `/family/assignments` — Assignments
- `/family/communications` — Communications
- `/family/children` — My children

### Running the App

```bash
# Install dependencies
pnpm install

# Build database schema
cd lib/db
pnpm run generate
pnpm run migrate

# Start development server
cd artifacts/tushciemat
pnpm run dev

# Start API server
cd artifacts/api-server
pnpm run dev
```

### API Endpoints Reference

#### Results
- `GET /api/v1/results/my-assessments` — Get assessments
- `GET /api/v1/results/published` — Get published marks
- `GET /api/v1/results/term/:termId` — Get term summary
- `POST /api/v1/results/publish` — Publish results (admin)

#### Learning Resources
- `GET /api/v1/learning/resources` — List resources
- `GET /api/v1/learning/resources/:resourceId` — Get resource
- `GET /api/v1/learning/resources/:resourceId/download` — Download
- `POST /api/v1/learning/resources` — Create (teacher)
- `POST /api/v1/learning/resources/:resourceId/bookmark` — Bookmark

#### Assignments
- `GET /api/v1/assignments` — List assignments
- `GET /api/v1/assignments/:assignmentId` — Get assignment
- `POST /api/v1/assignments/:assignmentId/submit` — Submit work
- `POST /api/v1/assignments/:assignmentId/submissions/:submissionId/mark` — Grade (teacher)

#### Timetable
- `GET /api/v1/timetable/today` — Today's schedule
- `GET /api/v1/timetable/week` — This week
- `GET /api/v1/timetable?date=YYYY-MM-DD` — Specific date
- `POST /api/v1/timetable` — Create/update (admin)

### Key React Hooks Used

```typescript
// Data fetching (from @workspace/api-client-react)
useGetStudentProfile()
useListAssignments(filters)
useListPublishedResults(filters)
useGetAttendanceSummary()
useGetTimetableForDate(date)
useListLearningResources(filters)
useListAnnouncements(filters)
useListLinkedChildren()

// Session & Auth (from @/lib/session)
useSession()          // Current user & roles
useAuth()             // Auth state

// Navigation (from wouter)
useLocation()         // Current route & navigate
```

### Styling System

All components use CSS modules or inline CSS. No Tailwind or other UI library dependencies.

**Color Palette:**
- Primary: `#1a5f42` (dark green)
- Accent: `#d4a574` (gold) — *not heavily used, reserved for future*
- Backgrounds: `#f9fafb`, `#ffffff`
- Borders: `#e5e7eb`
- Text: `#1f2937` (dark), `#6b7280` (medium), `#9ca3af` (light)

**Spacing:**
- `4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`

**Responsive Breakpoints:**
- Mobile: `< 480px`
- Tablet: `480px - 768px`
- Desktop: `768px - 1024px`
- Large: `1024px - 1400px`
- XL: `> 1400px`

### Common Patterns

#### Fetching Data
```typescript
const { data: items, isLoading, error } = useListItems({ limit: 20 });

if (isLoading) return <div>Loading...</div>;
if (error) return <div>Error: {error.message}</div>;
return <div>{items.map(item => ...)}</div>;
```

#### Form Submission
```typescript
const [text, setText] = useState('');
const mutation = useSubmitForm();

const handleSubmit = async () => {
  await mutation.mutateAsync({ text });
  setText('');
};
```

#### Conditional Rendering
```typescript
{status === 'graded' ? (
  <div>Grade: {mark}</div>
) : (
  <SubmissionForm />
)}
```

#### Dynamic Styling
```typescript
<div className={`item ${status === 'overdue' ? 'overdue' : ''}`}>
  {/* content */}
</div>
```

### Debugging

**Check React Query Devtools:**
```bash
# DevTools are auto-enabled in development
# Shortcut: press Ctrl+Shift+L (or Cmd+Shift+L on Mac)
```

**Console Logging:**
```typescript
// Log API calls
console.log('Fetching assignments:', filters);

// Log user session
const { me } = useSession();
console.log('Current user:', me);
```

**Network Tab:**
- All API calls go to `/api/v1/*`
- Check for 401 (auth) or 403 (permission) errors
- Verify response data format matches expectations

### Common Issues & Fixes

**Issue: Data not loading**
- Check: Is useSession() returning valid user?
- Check: Are API endpoints responding?
- Check: Is RLS policy allowing access?
- Fix: Verify user has correct role

**Issue: Child switching not updating**
- Check: Is selectedChildId being passed to all components?
- Check: Are queries refetching when child ID changes?
- Fix: Add `studentId` dependency to useEffect

**Issue: Styles not applying**
- Check: Is CSS file imported?
- Check: Is class name spelled correctly?
- Check: Check browser DevTools for specificity conflicts
- Fix: Use more specific selectors

**Issue: Button clicks not working**
- Check: Is onClick handler correct?
- Check: Is component re-rendering?
- Check: Is button disabled?
- Fix: Add console.log in handler

### Performance Tips

1. **Pagination** — Always use limit/offset for lists
2. **Caching** — React Query caches by default (staleTime: 0)
3. **Memoization** — Use React.memo() for expensive components
4. **Lazy Loading** — Use dynamic imports for large components
5. **Query Refetch** — Limit with refetchInterval or manual refetch()

### Testing Checklist

Before committing:
- [ ] No TypeScript errors (`pnpm run typecheck`)
- [ ] Component renders without console errors
- [ ] Data loads correctly
- [ ] Filters/searches work
- [ ] Mobile view is responsive
- [ ] No dead links or missing buttons

### Deployment

1. Build both frontend and API:
   ```bash
   pnpm run build
   ```

2. Test production build locally:
   ```bash
   pnpm run preview
   ```

3. Deploy to your hosting (Vercel, Replit, etc.)

4. Test in production environment

### Support

For issues:
1. Check COMPLETION_SUMMARY.md for detailed documentation
2. Check IMPLEMENTATION_PLAN.md for architecture decisions
3. Review existing component code for patterns
4. Search console/network errors for hints

---

**Last Updated:** 2025
**Status:** Production Ready ✅
