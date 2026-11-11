const pool = require('../config/db');

function idOrNull(value) {
  const valueNumber = Number(value);
  return Number.isSafeInteger(valueNumber) && valueNumber > 0 ? valueNumber : null;
}

function requiredText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function validHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function dbError(req, res, error) {
  req.logError?.(error);
  if (error.code === '42P01' || error.code === '42703') {
    return res.status(503).json({
      success: false,
      message: 'Database chưa chạy migration Mentor Ranking.'
    });
  }
  return res.status(500).json({ success: false, message: 'Lỗi máy chủ.' });
}

exports.createApplication = async (req, res) => {
  const menteeId = req.user.id;
  const mentorId = idOrNull(req.body?.mentor_id);
  const scholarshipId = idOrNull(req.body?.scholarship_id);
  const cvFileUrl = validHttpUrl(req.body?.cv_file_url);
  const introduction = req.body?.introduction === undefined || req.body?.introduction === null
    ? null : requiredText(req.body.introduction, 3000);
  if (!mentorId || !scholarshipId || !cvFileUrl ||
      menteeId === mentorId ||
      (req.body.introduction != null && !introduction)) {
    return res.status(400).json({
      success: false,
      message: 'Cần mentor_id, scholarship_id, cv_file_url HTTP(S) và introduction hợp lệ.'
    });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialize application creation per mentee and prevent duplicate active applications.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [menteeId]);

    const mentor = await client.query(
      'SELECT u.id FROM users u JOIN scholarships s ON s.id = $2 AND s.status = ' +
      "'published' WHERE u.id = $1 AND u.role = 'mentor' AND u.is_mentor = TRUE " +
      'AND u.is_active = TRUE AND EXISTS (' +
      'SELECT 1 FROM mentor_verifications mv WHERE mv.user_id = u.id ' +
      "AND mv.scholarship_id = s.id AND mv.status = 'approved')",
      [mentorId, scholarshipId]
    );
    if (!mentor.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false, message: 'Không tìm thấy Mentor đã duyệt cho học bổng này.'
      });
    }

    const existing = await client.query(
      'SELECT id FROM mentee_applications WHERE mentee_id = $1 ' +
      'AND mentor_id = $2 AND scholarship_id = $3 ' +
      "AND status IN ('pending', 'accepted', 'in_progress') LIMIT 1",
      [menteeId, mentorId, scholarshipId]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false, message: 'Bạn đã có hồ sơ mentoring chưa kết thúc.'
      });
    }

    const created = await client.query(
      'INSERT INTO mentee_applications ' +
      '(mentee_id, mentor_id, scholarship_id, cv_file_url, introduction) ' +
      'VALUES ($1, $2, $3, $4, $5) ' +
      'RETURNING id, mentee_id, mentor_id, scholarship_id, status, created_at',
      [menteeId, mentorId, scholarshipId, cvFileUrl, introduction]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      success: true, message: 'Đã nộp hồ sơ mentoring.', data: created.rows[0]
    });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection closed */ }
    }
    return dbError(req, res, error);
  } finally {
    if (client) client.release();
  }
};

exports.getMyApplications = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT ma.id, ma.mentee_id, ma.mentor_id, ma.scholarship_id, ma.status, ' +
      'ma.mentoring_started_at, ma.mentoring_completed_at, ma.scholarship_outcome, ' +
      'ma.outcome_verified_at, ma.created_at, ' +
      's.title AS scholarship_title, u.full_name AS mentor_name ' +
      'FROM mentee_applications ma ' +
      'LEFT JOIN scholarships s ON s.id = ma.scholarship_id ' +
      'JOIN users u ON u.id = ma.mentor_id ' +
      'WHERE ma.mentee_id = $1 OR ma.mentor_id = $1 ' +
      'ORDER BY ma.created_at DESC, ma.id DESC LIMIT 100',
      [req.user.id]
    );
    return res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (error) {
    return dbError(req, res, error);
  }
};

// Only the approved mentor can accept/start/reject; the mentee confirms completion.
exports.updateApplicationProgress = async (req, res) => {
  const id = idOrNull(req.params.id);
  const action = req.body?.action;
  const rules = {
    accept: { previous: 'pending', next: 'accepted', actor: 'mentor_id' },
    reject: { previous: 'pending', next: 'rejected', actor: 'mentor_id' },
    start: { previous: 'accepted', next: 'in_progress', actor: 'mentor_id' },
    complete: { previous: 'in_progress', next: 'completed', actor: 'mentee_id' }
  };
  if (!id || !Object.prototype.hasOwnProperty.call(rules, action)) {
    return res.status(400).json({ success: false, message: 'ID hoặc action không hợp lệ.' });
  }
  const rule = rules[action];
  if (rule.actor === 'mentor_id' &&
      (req.user.role !== 'mentor' || req.user.is_mentor !== true)) {
    return res.status(403).json({ success: false, message: 'Chỉ Mentor đã duyệt mới được điều khiển tiến độ.' });
  }
  try {
    const changes = [
      "status = '" + rule.next + "'",
      ...(action === 'start' ? ['mentoring_started_at = NOW()'] : []),
      ...(action === 'complete' ? ['mentoring_completed_at = NOW()'] : [])
    ];
    const result = await pool.query(
      'UPDATE mentee_applications SET ' + changes.join(', ') +
      ' WHERE id = $1 AND ' + rule.actor + ' = $2 AND status = $3 ' +
      (rule.actor === 'mentor_id'
        ? " AND EXISTS (SELECT 1 FROM mentor_verifications mv WHERE mv.user_id = $2 " +
          "AND mv.scholarship_id = mentee_applications.scholarship_id AND mv.status = 'approved') "
        : '') +
      'RETURNING id, status, mentoring_started_at, mentoring_completed_at',
      [id, req.user.id, rule.previous]
    );
    if (!result.rows.length) {
      const visible = await pool.query(
        'SELECT status FROM mentee_applications WHERE id = $1 ' +
        'AND (mentee_id = $2 OR mentor_id = $2)',
        [id, req.user.id]
      );
      if (!visible.rows.length) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ của bạn.' });
      return res.status(409).json({ success: false, message: 'Không thể chuyển trạng thái hoặc không đúng vai trò.' });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    return dbError(req, res, error);
  }
};

exports.recordOutcome = async (req, res) => {
  const id = idOrNull(req.params.id);
  const outcome = req.body?.outcome;
  const note = req.body?.note == null ? null : requiredText(req.body.note, 2000);
  if (!id || !['awarded', 'not_awarded'].includes(outcome) ||
      (req.body?.note != null && !note)) {
    return res.status(400).json({ success: false, message: 'ID, outcome hoặc note không hợp lệ.' });
  }
  try {
    const result = await pool.query(
      'UPDATE mentee_applications SET scholarship_outcome = $1, ' +
      'outcome_verified_by = $2, outcome_verified_at = NOW(), outcome_note = $3 ' +
      "WHERE id = $4 AND status = 'completed' AND scholarship_id IS NOT NULL " +
      "AND scholarship_outcome = 'pending' " +
      'RETURNING id, scholarship_id, mentor_id, scholarship_outcome, outcome_verified_at',
      [outcome, req.user.id, note, id]
    );
    if (!result.rows.length) {
      return res.status(409).json({
        success: false,
        message: 'Hồ sơ chưa hoàn thành, chưa tồn tại hoặc đã xác nhận kết quả.'
      });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    return dbError(req, res, error);
  }
};

exports.createResponseRequest = async (req, res) => {
  const id = idOrNull(req.params.id);
  const note = requiredText(req.body?.request_note, 2000);
  if (!id || !note) {
    return res.status(400).json({ success: false, message: 'Cần application_id và request_note (1–2000 ký tự).' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const app = await client.query(
      'SELECT id FROM mentee_applications ' +
      "WHERE id = $1 AND mentee_id = $2 AND status = 'in_progress' FOR UPDATE",
      [id, req.user.id]
    );
    if (!app.rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false, message: 'Chỉ mentee đang tham gia mentoring mới gửi được yêu cầu.'
      });
    }

    const recent = await client.query(
      'SELECT COUNT(*)::int AS total FROM mentoring_response_requests ' +
      "WHERE application_id = $1 AND requested_at > NOW() - INTERVAL '1 hour'",
      [id]
    );
    if (Number(recent.rows[0].total) >= 10) {
      await client.query('ROLLBACK');
      return res.status(429).json({ success: false, message: 'Giới hạn 10 yêu cầu mỗi giờ.' });
    }

    const inserted = await client.query(
      'INSERT INTO mentoring_response_requests ' +
      '(application_id, requested_by, request_note) VALUES ($1, $2, $3) ' +
      'RETURNING id, application_id, request_note, requested_at, responded_at',
      [id, req.user.id, note]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      success: true, message: 'Đã gửi yêu cầu cần phản hồi.', data: inserted.rows[0]
    });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection closed */ }
    }
    return dbError(req, res, error);
  } finally {
    if (client) client.release();
  }
};

exports.listResponseRequests = async (req, res) => {
  const id = idOrNull(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID hồ sơ không hợp lệ.' });
  try {
    const visible = await pool.query(
      'SELECT id FROM mentee_applications WHERE id = $1 ' +
      'AND (mentee_id = $2 OR mentor_id = $2)',
      [id, req.user.id]
    );
    if (!visible.rows.length) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ của bạn.' });
    const result = await pool.query(
      'SELECT id, request_note, requested_at, responded_at, response_note ' +
      'FROM mentoring_response_requests WHERE application_id = $1 ORDER BY requested_at DESC, id DESC LIMIT 100',
      [id]
    );
    return res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (error) {
    return dbError(req, res, error);
  }
};

exports.respondToRequest = async (req, res) => {
  const id = idOrNull(req.params.id);
  const note = requiredText(req.body?.response_note, 2000);
  if (!id || !note) {
    return res.status(400).json({ success: false, message: 'Cần request_id và response_note (1–2000 ký tự).' });
  }
  if (req.user.role !== 'mentor' || req.user.is_mentor !== true) {
    return res.status(403).json({ success: false, message: 'Chỉ Mentor đã duyệt mới được phản hồi.' });
  }
  try {
    const result = await pool.query(
      'UPDATE mentoring_response_requests rr ' +
      'SET responded_by = $2, responded_at = GREATEST(NOW(), rr.requested_at), response_note = $3 ' +
      'FROM mentee_applications ma ' +
      'WHERE rr.id = $1 AND rr.application_id = ma.id AND ma.mentor_id = $2 ' +
      "AND ma.status IN ('in_progress', 'completed') " +
      "AND EXISTS (SELECT 1 FROM mentor_verifications mv WHERE mv.user_id = $2 " +
      "AND mv.scholarship_id = ma.scholarship_id AND mv.status = 'approved') " +
      'AND rr.responded_at IS NULL ' +
      'RETURNING rr.id, rr.application_id, rr.requested_at, rr.responded_at, rr.response_note',
      [id, req.user.id, note]
    );
    if (!result.rows.length) {
      return res.status(409).json({
        success: false, message: 'Yêu cầu không tồn tại, đã được phản hồi hoặc không thuộc Mentor.'
      });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    return dbError(req, res, error);
  }
};
