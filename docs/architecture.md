# Tushciemat architecture and delivery plan

Tushciemat is a multi-school education platform for Kenya. Implemented foundations
cover school operations; finance, digital learning and tutoring remain future work.

## Architecture

- **Web:** React, TypeScript, Vite and Wouter. The authorized Clerk replacement
  uses Firebase web Authentication: email/password registration and sign-in,
  plus Google sign-in. API authentication uses Firebase ID bearer tokens in
  `Authorization`, not session cookies; the SDK refreshes tokens.
- **API:** Express with generated OpenAPI request/response validation. Server-side
  `jose` verifies tokens against Google's public signing keys, allowing only
  RS256 and pinning audience to `FIREBASE_PROJECT_ID` and issuer to
  `https://securetoken.google.com/<project-id>`. Identity is the Firebase UID
  (`sub`), not an email or a browser-supplied role.
- **Data:** PostgreSQL and Drizzle. Constraints and integrity triggers enforce
  same-school relationships for classes, students, guardians and attendance.
- **Tenant boundary:** runtime connections use the dedicated `tushciemat_api`
  role (non-superuser, no BYPASSRLS). Protected transactions set
  `request.jwt.claims` locally with the verified UID in `sub`. The active school
  comes from `X-School-Id`, is membership/role-checked inside that transaction,
  and is passed to explicit query filters. It is **not** currently a separate
  transaction-local PostgreSQL school setting. RLS independently checks active
  profiles, school roles and teacher/guardian/student relationships.
- **Migrations:** Drizzle's `lib/db/migrations/` and journal are the sole schema
  and security-policy authority; no schema push followed by separate policies.
  Real Supabase migrations and deployment require separate explicit approval
  and are **NOT done** as part of this migration.
- **Privacy:** dashboard metrics use actual database records; empty schools show
  zeros and empty states, never fabricated student or financial records.

## Firebase operations and limits

- Use project `tushciemat-c4c14`, separate from `turiwa-app`; no billing upgrade
  is part of this migration. Standard email/password and Google Firebase Auth
  on Spark are no-cost within quotas. Quotas still matter; SMS authentication
  and paid infrastructure would add costs and require separate authorization.
- Firebase web config (`VITE_FIREBASE_*`) is public project/app identification,
  not authorization. Keep database credentials, owner connections, service
  accounts and service secrets out of browsers and documentation.
- Configure Firebase Auth authorized domains: `localhost`, `127.0.0.1` and the
  deployment hostname (hostnames only, no scheme or port). Local example files
  are `artifacts/tushciemat/.env.example` and
  `artifacts/api-server/.env.example`; see `replit.md` for commands and setup.
- Verification and password-reset emails use Firebase-hosted email action
  pages. Invitation links are copied/shared manually; no invitation mail sender
  is integrated. No user lifecycle webhook or service secret is used; local
  profiles sync from verified token claims on authenticated requests.
- Already-issued tokens for disabled/deleted Firebase accounts can remain valid
  for up to one hour: public-key verification does not check revocation/account
  state. Setting `user_profiles.status` to non-active blocks subsequent protected
  requests immediately, independently of Firebase token expiry.

## Core relationships

```text
Firebase account (UID)
  └── user_profiles → school_memberships (multiple school roles per account)
        └── schools
              ├── invitations → memberships / student or guardian account links
              ├── academic_years → terms / school_classes
              ├── school_classes → class_teacher_assignments / students
              ├── students → student_guardians → guardians
              ├── attendance_records → students / school_classes
              └── audit_logs
```

Admission numbers are unique per school; attendance is unique per student/date.
Invitation acceptance requires the signed-in account's verified email to match
and links parent/student accounts to the intended school records.

## School discovery and membership workflow

The existing school, profile, multi-role membership, invitation and audit tables
are reused. New `school_join_requests`, `notifications` and `announcements`
records support requests, decisions and school communications. Existing schools
remain unlisted until a manager opts in; listing exposes only the institution's
name, category, location, logo, description and genuine verification status.
Contact information and private records are not directory fields.

Authenticated users choose join or create, search the directory, select a role
and submit details. Requests do not grant membership. Verification of the account
email is required before requesting access or accepting an invitation. Review is
atomic, school-scoped and limited to an active owner or school administrator;
self-review is prohibited. Student and parent approvals require a deliberately
selected, same-school record, not an automatic admission-number or name match.
Administrators can create missing student/guardian records using existing tools
before reviewing. Teacher declarations never create class assignments.

Private, narrowly granted database routines perform the cross-membership actions
with verified-identity and permission checks. Ordinary API-role transactions
remain subject to RLS. Profiles are directly readable only by their account;
limited school roster projections preserve staff and class-teacher displays.
One-use hashed invitations retain expiry and email checks and recheck the
inviter's authority. Invitation acceptance from discovery also checks the
selected school and role before consuming the token.

Applicant status and recipient-specific in-app notifications work before a
school membership exists. Approved accounts refresh memberships and use the
existing school/portal switcher; changing schools clears scoped query caches.
Managers publish announcements to their school only. Notifications are database
records, not proof of email or SMS delivery; no external sender is configured.

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

This matrix includes future product scope, not a claim that every module exists.
The API enforces permissions; hidden frontend controls are not a security boundary.
School creation bootstraps an owner membership. Invitation creation, acceptance
and revocation, member role/status management, years/terms and guardian linking
are implemented; unauthenticated forms cannot grant roles.

## Delivery status

- **Implemented:** Firebase sign-in/recovery, onboarding, membership/school
  context, invitations and member management, academic years/terms, classes and
  teacher assignments, student/guardian records, attendance and linked portals.
- **Future academics and learning:** subjects, assessments, grading, report cards,
  assignments, resources, curriculum lessons and AI study assistance.
- **Future finance/payments:** fees, receipts, allocations, arrears, expenses and
  reconciliation; payments require real provider confirmation, not initiation.
- **Future services/platform:** tutor verification/bookings, notifications,
  subscriptions, multi-campus support and additional integrations.

Implementation does not mean every UI flow has been tested. Local API/RLS tests
use a local database and locally signed test tokens, not live Firebase browser
flows. External payment, SMS, invitation email, conferencing and AI providers
are not connected without authorized configuration and confirmation.
