-- Optional, one-time data correction for scholarships published/crawled before
-- canonical study_levels were introduced.
-- Back up your database before executing in pgAdmin.
-- Does not alter the schema, primary keys or scholarship publication status.
BEGIN;

UPDATE public.scholarships AS s
SET study_levels = ARRAY(
    SELECT DISTINCT
        CASE lower(btrim(v.level))
            WHEN 'cử nhân' THEN 'bachelor'
            WHEN 'thạc sĩ' THEN 'master'
            WHEN 'tiến sĩ' THEN 'doctoral'
            WHEN 'trao đổi ngắn hạn' THEN 'exchange'
            ELSE v.level
        END
    FROM unnest(s.study_levels) AS v(level)
),
updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
    SELECT 1 FROM unnest(s.study_levels) AS v(level)
    WHERE lower(btrim(v.level)) IN (
        'cử nhân', 'thạc sĩ', 'tiến sĩ', 'trao đổi ngắn hạn'
    )
);

COMMIT;
