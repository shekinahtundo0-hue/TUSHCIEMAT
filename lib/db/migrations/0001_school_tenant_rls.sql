-- Tenant isolation for Tushciemat's school data.
-- The API sets these transaction-local values only after validating the
-- signed-in Clerk identity and membership. Requests without that context see
-- no school data, including when the database connection is reused.

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
ALTER TABLE school_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE school_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_classes FORCE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schools_select_member ON schools;
CREATE POLICY schools_select_member ON schools
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM school_memberships membership
      WHERE membership.school_id = schools.id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
    )
  );

DROP POLICY IF EXISTS schools_create_owner ON schools;
CREATE POLICY schools_create_owner ON schools
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND current_setting('app.school_creation', true) = 'true'
  );

DROP POLICY IF EXISTS schools_update_owner ON schools;
CREATE POLICY schools_update_owner ON schools
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM school_memberships membership
      WHERE membership.school_id = schools.id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
        AND membership.role IN ('owner', 'school_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM school_memberships membership
      WHERE membership.school_id = schools.id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
        AND membership.role IN ('owner', 'school_admin')
    )
  );

DROP POLICY IF EXISTS school_memberships_select_self ON school_memberships;
CREATE POLICY school_memberships_select_self ON school_memberships
  FOR SELECT
  USING (
    clerk_user_id = current_setting('app.current_user_id', true)
    OR (
      school_id::text = current_setting('app.current_school_id', true)
      AND current_setting('app.school_member_admin', true) = 'true'
    )
  );

DROP POLICY IF EXISTS school_memberships_create_school_owner ON school_memberships;
CREATE POLICY school_memberships_create_school_owner ON school_memberships
  FOR INSERT
  WITH CHECK (
    clerk_user_id = current_setting('app.current_user_id', true)
    AND role = 'owner'
    AND current_setting('app.school_creation', true) = 'true'
  );

DROP POLICY IF EXISTS school_classes_tenant_access ON school_classes;
CREATE POLICY school_classes_tenant_access ON school_classes
  FOR ALL
  USING (
    school_id::text = current_setting('app.current_school_id', true)
    AND EXISTS (
      SELECT 1 FROM school_memberships membership
      WHERE membership.school_id = school_classes.school_id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
    )
  )
  WITH CHECK (
    school_id::text = current_setting('app.current_school_id', true)
    AND EXISTS (
      SELECT 1 FROM school_memberships membership
      WHERE membership.school_id = school_classes.school_id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
    )
  );

DROP POLICY IF EXISTS students_tenant_access ON students;
CREATE POLICY students_tenant_access ON students
  FOR ALL
  USING (
    school_id::text = current_setting('app.current_school_id', true)
    AND EXISTS (
      SELECT 1 FROM school_memberships membership
      WHERE membership.school_id = students.school_id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
    )
  )
  WITH CHECK (
    school_id::text = current_setting('app.current_school_id', true)
    AND EXISTS (
      SELECT 1 FROM school_memberships membership
      WHERE membership.school_id = students.school_id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
    )
  );

DROP POLICY IF EXISTS attendance_tenant_access ON attendance_records;
CREATE POLICY attendance_tenant_access ON attendance_records
  FOR ALL
  USING (
    school_id::text = current_setting('app.current_school_id', true)
    AND EXISTS (
      SELECT 1 FROM school_memberships membership
      WHERE membership.school_id = attendance_records.school_id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
    )
  )
  WITH CHECK (
    school_id::text = current_setting('app.current_school_id', true)
    AND EXISTS (
      SELECT 1 FROM school_memberships membership
      WHERE membership.school_id = attendance_records.school_id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
    )
  );

DROP POLICY IF EXISTS audit_logs_select_tenant ON audit_logs;
CREATE POLICY audit_logs_select_tenant ON audit_logs
  FOR SELECT
  USING (
    school_id::text = current_setting('app.current_school_id', true)
    AND EXISTS (
      SELECT 1 FROM school_memberships membership
      WHERE membership.school_id = audit_logs.school_id
        AND membership.clerk_user_id = current_setting('app.current_user_id', true)
        AND membership.status = 'active'
    )
  );

DROP POLICY IF EXISTS audit_logs_insert_actor ON audit_logs;
CREATE POLICY audit_logs_insert_actor ON audit_logs
  FOR INSERT
  WITH CHECK (
    school_id::text = current_setting('app.current_school_id', true)
    AND actor_clerk_user_id = current_setting('app.current_user_id', true)
  );

-- Enforce same-school relationships independently of API validation.
CREATE OR REPLACE FUNCTION enforce_student_class_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.class_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM school_classes class_record
    WHERE class_record.id = NEW.class_id
      AND class_record.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'student class must belong to the same school'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_same_school_class_check ON students;
CREATE TRIGGER students_same_school_class_check
  BEFORE INSERT OR UPDATE OF school_id, class_id ON students
  FOR EACH ROW EXECUTE FUNCTION enforce_student_class_tenant();

CREATE OR REPLACE FUNCTION enforce_attendance_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM school_classes class_record
    WHERE class_record.id = NEW.class_id
      AND class_record.school_id = NEW.school_id
  ) OR NOT EXISTS (
    SELECT 1 FROM students student_record
    WHERE student_record.id = NEW.student_id
      AND student_record.school_id = NEW.school_id
      AND student_record.class_id = NEW.class_id
      AND student_record.status = 'active'
  ) THEN
    RAISE EXCEPTION 'attendance student and class must belong to the same school'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_same_school_check ON attendance_records;
CREATE TRIGGER attendance_same_school_check
  BEFORE INSERT OR UPDATE OF school_id, class_id, student_id ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION enforce_attendance_tenant();
