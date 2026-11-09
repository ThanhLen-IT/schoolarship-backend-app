-- Midterm Mentor Ranking: additive schema migration for Database-v1.0.
-- Run in pgAdmin on a backed-up STAGING/TEST database first.
-- No existing users, scholarships or application outcomes are changed.
BEGIN;

ALTER TABLE public.mentee_applications
  ADD COLUMN IF NOT EXISTS mentoring_started_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS mentoring_completed_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS scholarship_outcome varchar(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS outcome_verified_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS outcome_verified_by integer,
  ADD COLUMN IF NOT EXISTS outcome_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mentee_apps_outcome_check'
                 AND conrelid = 'public.mentee_applications'::regclass) THEN
    ALTER TABLE public.mentee_applications ADD CONSTRAINT mentee_apps_outcome_check
      CHECK (scholarship_outcome IN ('pending', 'awarded', 'not_awarded'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mentee_apps_completion_check'
                 AND conrelid = 'public.mentee_applications'::regclass) THEN
    ALTER TABLE public.mentee_applications ADD CONSTRAINT mentee_apps_completion_check
      CHECK (mentoring_completed_at IS NULL OR
             (mentoring_started_at IS NOT NULL AND mentoring_completed_at >= mentoring_started_at));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mentee_apps_outcome_verified_check'
                 AND conrelid = 'public.mentee_applications'::regclass) THEN
    ALTER TABLE public.mentee_applications ADD CONSTRAINT mentee_apps_outcome_verified_check
      CHECK (
        (scholarship_outcome = 'pending' AND outcome_verified_at IS NULL AND outcome_verified_by IS NULL)
        OR
        (scholarship_outcome IN ('awarded', 'not_awarded')
         AND outcome_verified_at IS NOT NULL AND outcome_verified_by IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mentee_apps_outcome_admin_fkey'
                 AND conrelid = 'public.mentee_applications'::regclass) THEN
    ALTER TABLE public.mentee_applications ADD CONSTRAINT mentee_apps_outcome_admin_fkey
      FOREIGN KEY (outcome_verified_by) REFERENCES public.users(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mentoring_response_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id integer NOT NULL REFERENCES public.mentee_applications(id) ON DELETE CASCADE,
  requested_by integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  request_note text NOT NULL,
  requested_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_by integer REFERENCES public.users(id) ON DELETE RESTRICT,
  response_note text,
  responded_at timestamp without time zone,
  CONSTRAINT mentoring_response_request_notes_check CHECK
    (char_length(btrim(request_note)) BETWEEN 1 AND 2000
     AND (response_note IS NULL OR char_length(btrim(response_note)) BETWEEN 1 AND 2000)),
  CONSTRAINT mentoring_response_timeliness_check CHECK
    (responded_at IS NULL OR responded_at >= requested_at),
  CONSTRAINT mentoring_response_pair_check CHECK
    ((responded_at IS NULL AND responded_by IS NULL AND response_note IS NULL)
     OR
     (responded_at IS NOT NULL AND responded_by IS NOT NULL AND response_note IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_mentee_apps_ranking_cohort
 ON public.mentee_applications (scholarship_id, mentor_id, mentee_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_mentor_reviews_application_rank
 ON public.mentor_reviews (application_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_mentoring_response_requests_app
 ON public.mentoring_response_requests (application_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentoring_response_requests_pending
 ON public.mentoring_response_requests (application_id) WHERE responded_at IS NULL;

COMMENT ON COLUMN public.mentee_applications.scholarship_outcome IS
  'Verified scholarship result: pending / awarded / not_awarded. Unverified results never count.';
COMMENT ON COLUMN public.mentee_applications.mentoring_completed_at IS
  'Only set when the mentee confirms that mentoring has completed.';
COMMENT ON TABLE public.mentoring_response_requests IS
  'Explicit mentee help requests and mentor replies. Ordinary chat does not count.';

COMMIT;
