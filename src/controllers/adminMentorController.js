const pool = require('../config/db');
const path = require('path');
const { uploadDir } = require('../middlewares/uploadMiddleware');

const positiveId = (value) => {
    const num = Number(value);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
};

exports.listVerifications = async (req, res) => {
    const status = String(req.query.status || 'pending');
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ!' });
    }
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ success: false, message: 'page/limit không hợp lệ!' });
    }
    try {
        const filter = status === 'all' ? '' : 'WHERE mv.status = $1';
        const params = status === 'all' ? [] : [status];
        const [count, result] = await Promise.all([
            pool.query(`SELECT COUNT(*)::int AS total FROM mentor_verifications mv ${filter}`, params),
            pool.query(
                `SELECT mv.id, mv.user_id, mv.scholarship_id, mv.status, mv.admin_note,
                        mv.evidence_file_url, mv.hourly_rate, mv.calendly_link, mv.qr_payment_url,
                        mv.created_at, u.full_name, u.email, u.university
                 FROM mentor_verifications mv
                 JOIN users u ON u.id = mv.user_id
                 ${filter}
                 ORDER BY mv.created_at DESC, mv.id DESC
                 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, limit, (page - 1) * limit]
            )
        ]);
        return res.json({ success: true, page, limit, total: count.rows[0].total, data: result.rows });
    } catch (err) {
        req.logError?.(err);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ!' });
    }
};

// A verification can be decided only once, by a currently active Admin.
async function decideVerification(req, res, decision) {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID hồ sơ không hợp lệ!' });

    const adminNote = req.body?.admin_note ?? null;
    if (adminNote !== null && (typeof adminNote !== 'string' || adminNote.length > 2000)) {
        return res.status(400).json({ success: false, message: 'Ghi chú không hợp lệ!' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const current = await client.query(
            `SELECT mv.id, mv.user_id, mv.status, u.role, u.is_active
             FROM mentor_verifications mv
             JOIN users u ON u.id = mv.user_id
             WHERE mv.id = $1
             FOR UPDATE OF mv, u`,
            [id]
        );

        const record = current.rows[0];
        if (!record) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ!' });
        }
        if (record.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, message: 'Hồ sơ này đã được xử lý!' });
        }
        if (decision === 'approved' && (!record.is_active || record.role === 'admin' || !['user', 'mentor'].includes(record.role))) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, message: 'Tài khoản không đủ điều kiện trở thành Mentor!' });
        }

        const verification = await client.query(
            `UPDATE mentor_verifications
             SET status = $1, admin_note = $2
             WHERE id = $3 RETURNING id, user_id, status, admin_note`,
            [decision, adminNote, id]
        );

        if (decision === 'approved') {
            await client.query(
                `UPDATE users SET role = 'mentor', is_mentor = TRUE, updated_at = NOW()
                 WHERE id = $1`,
                [record.user_id]
            );
        }
        await client.query('COMMIT');
        return res.json({
            success: true,
            message: decision === 'approved' ? 'Đã duyệt Mentor!' : 'Đã từ chối hồ sơ Mentor!',
            data: verification.rows[0]
        });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) { /* connection already closed */ }
        }
        req.logError?.(err);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ!' });
    } finally {
        if (client) client.release();
    }
}

exports.approveVerification = (req, res) => decideVerification(req, res, 'approved');
exports.rejectVerification = (req, res) => decideVerification(req, res, 'rejected');

// Verification PDFs are confidential. Do not expose /uploads publicly.
exports.downloadEvidence = async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID hồ sơ không hợp lệ!' });

    try {
        const result = await pool.query(
            'SELECT evidence_file_url FROM mentor_verifications WHERE id = $1', [id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ!' });
        }
        const value = result.rows[0].evidence_file_url;
        const match = /^\/uploads\/(evidence-[0-9]+-[0-9]+-[0-9a-f]+\.pdf)$/i.exec(value || '');
        if (!match) {
            return res.status(404).json({ success: false, message: 'Minh chứng không khả dụng!' });
        }
        const absolutePath = path.join(uploadDir, match[1]);
        return res.download(absolutePath, `mentor-evidence-${id}.pdf`, (err) => {
            if (err && !res.headersSent) {
                res.status(err.code === 'ENOENT' ? 404 : 500).json({
                    success: false, message: 'Không thể tải file minh chứng!'
                });
            }
        });
    } catch (err) {
        req.logError?.(err);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ!' });
    }
};
