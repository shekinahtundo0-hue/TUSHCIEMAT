# Tushciemat architecture and delivery plan

Tushciemat is a multi-school education platform for Kenya, designed around
school operations, academic progress, finance, digital learning and tutoring.
The first working release establishes the tenant boundary and daily school
records; later modules build on the same school membership and audit model.

## Architecture

- **Web:** React, TypeScript, Vite and Wouter. Clerk provides sign-in and
  account recovery; browser requests use the Clerk session cookie.
- **API:** the shared Express API, with generated request/response validation
  from the OpenAPI contract.
- **Data:** PostgreSQL and Drizzle. A school owns classes, students, attendance,
  memberships and audit events. Composite foreign keys prevent a class or
  student from being attached across schools.
- **Tenant boundary:** school membership is checked on every protected API
  operation. PostgreSQL row-level policies additionally scope school records
  to transaction-local, server-set Clerk user and school identifiers.
- **Privacy:** dashboard numbers come from database records. An empty school
  displays zero counts and empty states; it is never populated with sample
  student or financial data.

## Core relationships

```text
Clerk account
  └── school_memberships (one account can have multiple school roles)
        └── schools
              ├── school_classes
              │     └── students
              │           └── attendance_records
              ├── students
              ├── attendance_records
              └── audit_logs
```

Student admission numbers are unique within a school. Database checks ensure
class assignments and attendance link records from the same school. Every
attendance register is unique per student and calendar date.

## Role and permission matrix

| Role | Intended scope |
| --- | --- |
| Platform administrator | Platform-wide school onboarding, subscriptions, support and audit operations; not a school membership grant |
| School owner | Full school configuration and operational oversight |
| School administrator | School records, staff coordination and communications; finance is not automatically included |
| Principal | School operations and academic oversight |
| Academic administrator | Classes, subjects, examinations and academic reporting |
| Bursar | Fees, payments, expenses and financial reporting |
| Teacher | Assigned classes, attendance, assignments, marks and parent communication |
| Parent | Records for explicitly linked children only |
| Student | The student's own learning, attendance, assignments and released results |
| Tutor | The tutor's verified profile, availability and bookings |

The API enforces permissions; the frontend's hidden or disabled controls are
not treated as a security boundary. The initial owner role can create a school
workspace. Invitation and role-management flows are a later foundation step;
roles must not be granted from an unauthenticated form.

## Delivery phases

1. **Foundation and daily school records:** Clerk sign-in, school onboarding,
   membership context, tenant-safe school setup, student records, classes and
   attendance. This is the first implementation slice.
2. **Academic operations:** academic years, subjects, assessments, grading,
   marks, report cards and performance comparisons.
3. **School finance:** bursar permissions, fee accounts, receipts, payment
   allocation, arrears, expenses and audit-ready reconciliation. Payments
   remain pending until a real provider confirms them.
4. **Parent and learner access:** verified guardian links, student-specific
   portals, assignments, learning resources and notifications.
5. **Digital learning and AI:** curriculum-organised lessons, quizzes,
   practice exams and age-appropriate study assistance.
6. **Teacher and tutor workflows:** staff invitations, assignments, tutor
   verification, discovery, bookings and scheduling.
7. **Platform operations:** school subscriptions, multi-campus support,
   integrations and scale/performance work.

External payment, SMS, email, conferencing and AI providers are not reported as
connected unless their authorized integrations are configured and confirmed.
