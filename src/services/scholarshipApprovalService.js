const pool = require('../config/db');
const { normalizeStudyLevels, sanitizeScholarshipHtml } = require('../utils/scholarshipContent');

// Shared by the regular Admin and the Crawler's legacy approval endpoint.
// The row lock protects the final admin-edited content during publication.
async function approvePendingScholarship(scholarshipId, adminId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      "SELECT source_url, study_levels, content_html FROM scholarships WHERE id = $1 AND status = 'pending' FOR UPDATE",
      [scholarshipId]
    );
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const { source_url, study_levels, content_html } = current.rows[0];
    const safeHtml = sanitizeScholarshipHtml(content_html, source_url);
    const levels = normalizeStudyLevels(study_levels || ['unknown']);

    const updated = await client.query(
      "UPDATE scholarships " +
      "SET status = 'published', reviewed_by = $2, reviewed_at = NOW(), " +
      "published_at = COALESCE(published_at, NOW()), " +
      "updated_at = NOW(), rejection_reason = NULL, " +
      "content_html = $3, study_levels = $4 " +
      "WHERE id = $1 AND status = 'pending' RETURNING *",
      [scholarshipId, adminId, safeHtml, levels]
    );
    if (updated.rows.length) {
      await client.query(
        "INSERT INTO admin_review_audit (admin_id, target_type, target_id, decision) VALUES ($1, 'scholarship', $2, 'approved')",
        [adminId, scholarshipId]
      );
    }
    await client.query('COMMIT');
    return updated.rows[0] || null;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw error;
  } finally {
    client.release();
  }
}

async function rejectPendingScholarship(scholarshipId, adminId, reason) {
  return pool.query(
    `WITH updated AS (
       UPDATE scholarships
       SET status = 'rejected', reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP, rejection_reason = $3
       WHERE id = $1 AND status = 'pending'
       RETURNING *
     ), logged AS (
       INSERT INTO admin_review_audit (admin_id, target_type, target_id, decision, note)
       SELECT $2, 'scholarship', id, 'rejected', rejection_reason FROM updated
     )
     SELECT * FROM updated`,
    [scholarshipId, adminId, reason]
  );
}

module.exports = { approvePendingScholarship, rejectPendingScholarship };
