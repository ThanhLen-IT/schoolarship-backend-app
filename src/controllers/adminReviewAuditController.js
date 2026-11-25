const pool = require('../config/db');

async function listReviewAudit(req, res) {
  const { target_type: targetType = '', decision = '' } = req.query;
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  if (!['', 'scholarship', 'mentor_verification'].includes(targetType) ||
      !['', 'approved', 'rejected'].includes(decision) ||
      !Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ success: false, message: 'Bộ lọc hoặc phân trang không hợp lệ.' });
  }

  const filter = "WHERE ($1 = '' OR a.target_type = $1) AND ($2 = '' OR a.decision = $2)";
  try {
    const [count, result] = await Promise.all([
      pool.query(`SELECT count(*)::int AS total FROM admin_review_audit a ${filter}`, [targetType, decision]),
      pool.query(
        `SELECT a.id, a.admin_id, a.target_type, a.target_id, a.decision, a.note, a.created_at
         FROM admin_review_audit a ${filter}
         ORDER BY a.created_at DESC, a.id DESC LIMIT $3 OFFSET $4`,
        [targetType, decision, limit, (page - 1) * limit]
      ),
    ]);
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, page, limit, total: count.rows[0].total, data: result.rows });
  } catch (error) {
    req.logError?.(error);
    return res.status(500).json({ success: false, message: 'Không thể tải nhật ký xét duyệt.' });
  }
}

module.exports = { listReviewAudit };
