const pool = require('../config/db');
const { WEIGHTS, MIN_SAMPLE_SIZE, rankMentors } = require('../utils/mentorRanking');

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const rankingQuery = "WITH approved_mentors AS (\n  SELECT u.id AS mentor_id, u.full_name, u.username, u.avatar_url, u.university\n  FROM users u\n  WHERE u.role = 'mentor' AND u.is_mentor = TRUE AND u.is_active = TRUE\n    AND EXISTS (\n      SELECT 1 FROM mentor_verifications mv\n      WHERE mv.user_id = u.id AND mv.scholarship_id = $1 AND mv.status = 'approved'\n    )\n),\nlatest_applications AS (\n  SELECT DISTINCT ON (ma.mentor_id, ma.mentee_id)\n         ma.id, ma.mentor_id, ma.mentee_id, ma.scholarship_id,\n         ma.mentoring_started_at, ma.mentoring_completed_at,\n         ma.scholarship_outcome, ma.outcome_verified_at\n  FROM mentee_applications ma\n  WHERE ma.scholarship_id = $1\n  ORDER BY ma.mentor_id, ma.mentee_id, ma.created_at DESC, ma.id DESC\n),\napplication_counts AS (\n  SELECT mentor_id,\n     COUNT(*) FILTER (\n       WHERE outcome_verified_at IS NOT NULL\n         AND scholarship_outcome IN ('awarded', 'not_awarded')\n     )::int AS decided_count,\n     COUNT(*) FILTER (\n       WHERE outcome_verified_at IS NOT NULL AND scholarship_outcome = 'awarded'\n     )::int AS awarded_count,\n     COUNT(*) FILTER (WHERE mentoring_started_at IS NOT NULL)::int AS started_count,\n     COUNT(*) FILTER (WHERE mentoring_completed_at IS NOT NULL)::int AS completed_count\n  FROM latest_applications\n  GROUP BY mentor_id\n),\nreview_counts AS (\n  SELECT la.mentor_id,\n         COUNT(r.rating)::int AS rating_count,\n         ROUND(AVG(r.rating)::numeric, 2) AS avg_rating\n  FROM latest_applications la\n  JOIN LATERAL (\n    SELECT mr.rating FROM mentor_reviews mr\n    WHERE mr.application_id = la.id\n      AND mr.mentor_id = la.mentor_id AND mr.mentee_id = la.mentee_id\n    ORDER BY mr.created_at DESC, mr.id DESC LIMIT 1\n  ) r ON TRUE\n  GROUP BY la.mentor_id\n),\nresponse_counts AS (\n  SELECT la.mentor_id,\n         COUNT(rr.id)::int AS request_count,\n         COUNT(rr.responded_at)::int AS responded_count\n  FROM latest_applications la\n  JOIN mentoring_response_requests rr ON rr.application_id = la.id\n  GROUP BY la.mentor_id\n)\nSELECT am.mentor_id, am.full_name, am.username, am.avatar_url, am.university,\n       COALESCE(ac.decided_count, 0) AS decided_count,\n       COALESCE(ac.awarded_count, 0) AS awarded_count,\n       COALESCE(ac.started_count, 0) AS started_count,\n       COALESCE(ac.completed_count, 0) AS completed_count,\n       COALESCE(rc.rating_count, 0) AS rating_count,\n       rc.avg_rating,\n       COALESCE(resp.request_count, 0) AS request_count,\n       COALESCE(resp.responded_count, 0) AS responded_count\nFROM approved_mentors am\nLEFT JOIN application_counts ac ON ac.mentor_id = am.mentor_id\nLEFT JOIN review_counts rc ON rc.mentor_id = am.mentor_id\nLEFT JOIN response_counts resp ON resp.mentor_id = am.mentor_id\nORDER BY am.mentor_id";

exports.getRanking = async (req, res) => {
  const scholarshipId = positiveId(req.query?.scholarship_id);
  const page = req.query?.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query?.limit === undefined ? 20 : Number(req.query.limit);
  if (!scholarshipId || !Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({
      success: false,
      message: 'Cần scholarship_id nguyên dương, page >= 1 và limit từ 1 đến 100.'
    });
  }

  try {
    const scholarship = await pool.query(
      "SELECT id, title FROM scholarships WHERE id = $1 AND status = 'published'",
      [scholarshipId]
    );
    if (!scholarship.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy học bổng đã công khai!'
      });
    }

    const records = await pool.query(rankingQuery, [scholarshipId]);
    const ranking = rankMentors(records.rows);
    const offset = (page - 1) * limit;
    return res.json({
      success: true,
      scholarship: scholarship.rows[0],
      weights: WEIGHTS,
      minimum_sample_size: MIN_SAMPLE_SIZE,
      page,
      limit,
      total: ranking.length,
      totalPages: Math.ceil(ranking.length / limit),
      data: ranking.slice(offset, offset + limit)
    });
  } catch (error) {
    req.logError?.(error);
    return res.status(500).json({
      success: false,
      message: 'Không thể lấy Ranking Mentor. Kiểm tra migration Database.'
    });
  }
};
