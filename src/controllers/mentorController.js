const pool = require('../config/db');
const fs = require('fs/promises');

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

exports.applyMentorVerification = async (req, res) => {
    const userId = req.user.id;
    const { scholarship_id, hourly_rate, calendly_link, qr_payment_url } = req.body || {};

    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng đính kèm minh chứng PDF!'
        });
    }

    // Do not leave private evidence files behind on validation/DB errors.
    const reject = async (status, message) => {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(status).json({ success: false, message });
    };

    const scholarshipId = scholarship_id ? positiveId(scholarship_id) : null;
    const rate = hourly_rate === undefined || hourly_rate === '' ? 0 : Number(hourly_rate);
    if ((scholarship_id && !scholarshipId) || !Number.isFinite(rate) || rate < 0 || rate > 9999999999.99) {
        return reject(400, 'Thông tin học bổng hoặc mức phí không hợp lệ!');
    }
    for (const link of [calendly_link, qr_payment_url]) {
        if (link && (typeof link !== 'string' || link.length > 2048 || !/^https?:\/\//i.test(link))) {
            return reject(400, 'Liên kết phải bắt đầu bằng http:// hoặc https://!');
        }
    }

    let client;
    try {
        // MIME type is supplied by the client. Also check the actual PDF header.
        const file = await fs.open(req.file.path, 'r');
        let bytesRead;
        const header = Buffer.alloc(5);
        try {
            ({ bytesRead } = await file.read(header, 0, 5, 0));
        } finally {
            await file.close();
        }
        if (bytesRead !== 5 || header.toString('utf8') !== '%PDF-') {
            return reject(400, 'File minh chứng không phải PDF hợp lệ!');
        }

        // Lock this account until verification is stored. Two simultaneous
        // requests cannot both create pending verification records.
        client = await pool.connect();
        await client.query('BEGIN');
        const account = await client.query(
            'SELECT id FROM users WHERE id = $1 AND is_active = TRUE FOR UPDATE',
            [userId]
        );
        if (!account.rows.length) {
            await client.query('ROLLBACK');
            return reject(403, 'Tài khoản không thể nộp hồ sơ Mentor!');
        }
        const existing = await client.query(
            `SELECT id, status FROM mentor_verifications
             WHERE user_id = $1 AND scholarship_id IS NOT DISTINCT FROM $2
               AND status IN ('pending', 'approved')
             ORDER BY created_at DESC, id DESC LIMIT 1`,
            [userId, scholarshipId]
        );
        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return reject(409, 'Bạn đã có hồ sơ đang chờ duyệt hoặc đã được duyệt!');
        }

        const result = await client.query(
            `INSERT INTO mentor_verifications
             (user_id, evidence_file_url, scholarship_id, hourly_rate, calendly_link, qr_payment_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending')
             RETURNING id, user_id, status, scholarship_id, hourly_rate, created_at`,
            [userId, `/uploads/${req.file.filename}`, scholarshipId, rate, calendly_link || null, qr_payment_url || null]
        );
        await client.query('COMMIT');
        return res.status(201).json({
            success: true,
            message: 'Đã nộp hồ sơ Mentor. Vui lòng chờ Admin xét duyệt.',
            data: result.rows[0]
        });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) { /* connection closed */ }
        }
        console.error('Lỗi applyMentorVerification:', err.message);
        return reject(500, 'Lỗi máy chủ!');
    } finally {
        if (client) client.release();
    }
};

exports.getMyVerificationStatus = async (req, res) => {
    const scholarshipId = req.query.scholarship_id == null
        ? null : positiveId(req.query.scholarship_id);
    if (req.query.scholarship_id != null && !scholarshipId) {
        return res.status(400).json({ success: false, message: 'scholarship_id không hợp lệ!' });
    }
    try {
        const result = await pool.query(
            `SELECT mv.*, s.title AS scholarship_title
             FROM mentor_verifications mv
             LEFT JOIN scholarships s ON mv.scholarship_id = s.id
             WHERE mv.user_id = $1
               AND ($2::integer IS NULL OR mv.scholarship_id = $2)
             ORDER BY mv.created_at DESC, mv.id DESC LIMIT 1`,
            [req.user.id, scholarshipId]
        );
        if (!result.rows.length) {
            return res.json({ success: true, has_applied: false, status: 'none' });
        }
        return res.json({ success: true, has_applied: true, data: result.rows[0] });
    } catch (err) {
        console.error('Lỗi getMyVerificationStatus:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ!' });
    }
};

const verifiedMentorsFrom = `
    FROM users u
    JOIN LATERAL (
        SELECT mv.id, mv.scholarship_id, mv.hourly_rate, mv.calendly_link, mv.qr_payment_url
        FROM mentor_verifications mv
        WHERE mv.user_id = u.id AND mv.status = 'approved'
        ORDER BY mv.created_at DESC, mv.id DESC
        LIMIT 1
    ) mv ON TRUE
    LEFT JOIN scholarships s ON s.id = mv.scholarship_id
`;
const ratingJoin = `
    LEFT JOIN (
        SELECT mentor_id, ROUND(AVG(rating), 1) AS avg_rating,
               COUNT(*)::int AS total_reviews
        FROM mentor_reviews GROUP BY mentor_id
    ) ratings ON ratings.mentor_id = u.id
`;

exports.getMentors = async (req, res) => {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ success: false, message: 'page/limit không hợp lệ!' });
    }

    const where = ["u.role = 'mentor'", 'u.is_mentor = TRUE', 'u.is_active = TRUE'];
    const params = [];
    if (req.query.scholarship_id) {
        const scholarshipId = positiveId(req.query.scholarship_id);
        if (!scholarshipId) return res.status(400).json({ success: false, message: 'scholarship_id không hợp lệ!' });
        params.push(scholarshipId);
        // The filter belongs INSIDE the LATERAL query, before selecting latest approved verification.
    }
    if (req.query.search) {
        if (typeof req.query.search !== 'string' || req.query.search.length > 100) {
            return res.status(400).json({ success: false, message: 'Từ khóa không hợp lệ!' });
        }
        params.push(`%${req.query.search}%`);
        where.push(`(u.full_name ILIKE $${params.length} OR u.university ILIKE $${params.length})`);
    }

    try {
        let scopedFrom = verifiedMentorsFrom;
        let scopedRatings = ratingJoin;
        if (req.query.scholarship_id) {
            scopedFrom = verifiedMentorsFrom.replace(
                "WHERE mv.user_id = u.id AND mv.status = 'approved'",
                "WHERE mv.user_id = u.id AND mv.status = 'approved' AND mv.scholarship_id = $1"
            );
            scopedRatings = `
                LEFT JOIN (
                    SELECT ma.mentor_id, ROUND(AVG(mr.rating)::numeric, 1) AS avg_rating,
                           COUNT(*)::int AS total_reviews
                    FROM mentor_reviews mr
                    JOIN mentee_applications ma ON ma.id = mr.application_id
                    WHERE ma.scholarship_id = $1
                    GROUP BY ma.mentor_id
                ) ratings ON ratings.mentor_id = u.id
            `;
        }
        const filter = ' WHERE ' + where.join(' AND ');
        const count = await pool.query(
            'SELECT COUNT(*)::int AS total ' + scopedFrom + filter,
            params
        );
        const result = await pool.query(
            `SELECT u.id, u.full_name, u.avatar_url, u.bio, u.skills, u.university, u.role,
                    mv.hourly_rate, mv.calendly_link, mv.qr_payment_url,
                    s.title AS scholarship_name, ratings.avg_rating,
                    COALESCE(ratings.total_reviews, 0) AS total_reviews
             ${scopedFrom} ${scopedRatings} ${filter}
             ORDER BY ratings.avg_rating DESC NULLS LAST, u.xp_points DESC, u.id ASC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, (page - 1) * limit]
        );
        return res.json({ success: true, page, limit, total: count.rows[0].total, data: result.rows });
    } catch (err) {
        console.error('Lỗi getMentors:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ!' });
    }
};

exports.getMentorDetail = async (req, res) => {
    const mentorId = positiveId(req.params.id);
    if (!mentorId) return res.status(400).json({ success: false, message: 'ID Mentor không hợp lệ!' });

    try {
        const result = await pool.query(
            `SELECT u.id, u.full_name, u.avatar_url, u.bio, u.skills, u.university,
                    u.xp_points, u.streak_count,
                    mv.hourly_rate, mv.calendly_link, mv.qr_payment_url,
                    s.title AS scholarship_name, ratings.avg_rating,
                    COALESCE(ratings.total_reviews, 0) AS total_reviews
             ${verifiedMentorsFrom} ${ratingJoin}
             WHERE u.id = $1 AND u.role = 'mentor' AND u.is_mentor = TRUE AND u.is_active = TRUE`,
            [mentorId]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy Mentor đã được duyệt!' });
        }
        const reviews = await pool.query(
            `SELECT mr.id, mr.rating, mr.comment, mr.created_at,
                    u.full_name AS mentee_name, u.avatar_url AS mentee_avatar
             FROM mentor_reviews mr
             JOIN users u ON u.id = mr.mentee_id
             WHERE mr.mentor_id = $1 ORDER BY mr.created_at DESC`,
            [mentorId]
        );
        return res.json({ success: true, data: { mentor: result.rows[0], reviews: reviews.rows } });
    } catch (err) {
        console.error('Lỗi getMentorDetail:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ!' });
    }
};

exports.createMentorReview = async (req, res) => {
    const menteeId = req.user.id;
    const mentorId = positiveId(req.params.id);
    const applicationId = positiveId(req.body?.application_id);
    const rating = Number(req.body?.rating);
    const comment = req.body?.comment ?? null;

    if (!mentorId || !applicationId || !Number.isInteger(rating) || rating < 1 || rating > 5 ||
        (comment !== null && (typeof comment !== 'string' || comment.length > 2000))) {
        return res.status(400).json({
            success: false, message: 'Cần application_id hợp lệ, rating nguyên từ 1–5 và comment tối đa 2000 ký tự!'
        });
    }
    if (mentorId === menteeId) {
        return res.status(403).json({ success: false, message: 'Bạn không thể tự đánh giá bản thân!' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Lock the related application to prevent duplicate concurrent reviews.
        const application = await client.query(
            `SELECT id, mentee_id, mentor_id, status FROM mentee_applications
             WHERE id = $1 FOR UPDATE`,
            [applicationId]
        );
        const item = application.rows[0];
        if (!item || item.mentee_id !== menteeId || item.mentor_id !== mentorId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, message: 'Bạn không có quyền đánh giá hồ sơ này!' });
        }
        if (item.status !== 'completed') {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, message: 'Chỉ được đánh giá sau khi hoàn tất buổi mentoring!' });
        }

        const approved = await client.query(
            `SELECT 1 FROM users u
             WHERE u.id = $1 AND u.role = 'mentor' AND u.is_mentor = TRUE AND u.is_active = TRUE
               AND EXISTS (SELECT 1 FROM mentor_verifications mv
                           WHERE mv.user_id = u.id AND mv.status = 'approved')`,
            [mentorId]
        );
        if (!approved.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Mentor chưa được duyệt!' });
        }

        const previous = await client.query(
            'SELECT 1 FROM mentor_reviews WHERE application_id = $1 LIMIT 1',
            [applicationId]
        );
        if (previous.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, message: 'Hồ sơ này đã được đánh giá!' });
        }

        const result = await client.query(
            `INSERT INTO mentor_reviews (mentor_id, mentee_id, application_id, rating, comment)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [mentorId, menteeId, applicationId, rating, comment]
        );
        if (rating >= 4) {
            await client.query('UPDATE users SET xp_points = xp_points + 20 WHERE id = $1', [mentorId]);
        }
        await client.query('COMMIT');
        return res.status(201).json({
            success: true, message: 'Đánh giá Mentor thành công!', data: result.rows[0]
        });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) { /* connection already closed */ }
        }
        console.error('Lỗi createMentorReview:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ!' });
    } finally {
        if (client) client.release();
    }
};
