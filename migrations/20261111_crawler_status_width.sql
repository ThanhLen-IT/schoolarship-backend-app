-- The crawler writes completed_with_errors (21 characters); Database-v1.0
-- declared varchar(20). Widen without changing existing records or statuses.
BEGIN;
ALTER TABLE public.scholarship_crawl_logs ALTER COLUMN status TYPE varchar(32);
COMMIT;
