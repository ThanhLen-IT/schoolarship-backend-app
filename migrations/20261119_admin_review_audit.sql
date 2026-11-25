BEGIN;
CREATE TABLE IF NOT EXISTS public.admin_review_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id bigint NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('scholarship', 'mentor_verification')),
  target_id bigint NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS admin_review_audit_recent
  ON public.admin_review_audit (created_at DESC, id DESC);
COMMIT;
