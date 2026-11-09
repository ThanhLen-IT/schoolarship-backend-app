const pool = require('../config/db');

exports.applyMentorVerification = async (req, res) => {
    const userId = req.user.id;
    const { scholarship_id, hourly_rate, calendly_link, qr_payment_url } = req.body;

    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng đính kèm file minh chứng định dạng PDF!'
        });
    }

    const evidenceUrl = `/uploads/${req.file.filename}`;

    try {
        const result = await pool.query(
            `INSERT INTO mentor_verifications 
             (user_id, evidence_file_url, scholarship_id, hourly_rate, calendly_link, qr_payment_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending')
             RETURNING *`,
            [userId, evidenceUrl, scholarship_id || null, hourly_rate || 0, calendly_link || null, qr_payment_url || null]
        );

        res.status(201).json({
            success: true,
            message: 'Nộp hồ sơ minh chứng Mentor thành công! Vui lòng chờ xét duyệt.',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi applyMentorVerification:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

exports.getMyVerificationStatus = async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `SELECT mv.*, s.title AS scholarship_title
             FROM mentor_verifications mv
             LEFT JOIN scholarships s ON mv.scholarship_id = s.id
             WHERE mv.user_id = $1
             ORDER BY mv.created_at DESC LIMIT 1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(200).json({
                success: true,
                has_applied: false,
                status: 'none'
            });
        }

        res.status(200).json({
            success: true,
            has_applied: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi getMyVerificationStatus:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

exports.getMentors = async (req, res) => {
    const { scholarship_id, search, limit = 10, page = 1 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
        SELECT u.id, u.full_name, u.email, u.avatar_url, u.bio, u.skills, u.university, u.role,
               mv.hourly_rate, mv.calendly_link, mv.qr_payment_url,
               s.title AS scholarship_name,
               COALESCE(ROUND(AVG(mr.rating), 1), 5.0) AS avg_rating,
               COUNT(mr.id) AS total_reviews
        FROM users u
        JOIN mentor_verifications mv ON u.id = mv.user_id AND mv.status = 'approved'
        LEFT JOIN scholarships s ON mv.scholarship_id = s.id
        LEFT JOIN mentor_reviews mr ON u.id = mr.mentor_id
        WHERE u.role = 'mentor' AND u.is_active = TRUE
    `;
    const params = [];

    if (scholarship_id) {
        params.push(scholarship_id);
        query += ` AND mv.scholarship_id = $${params.length}`;
    }

    if (search) {
        params.push(`%${search}%`);
        query += ` AND (u.full_name ILIKE $${params.length} OR u.university ILIKE $${params.length})`;
    }

    query += ` GROUP BY u.id, mv.id, s.id
               ORDER BY avg_rating DESC, u.xp_points DESC
               LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    try {
        const result = await pool.query(query, params);
        res.status(200).json({
            success: true,
            page: parseInt(page),
            limit: parseInt(limit),
            total: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error('Lỗi getMentors:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

exports.getMentorDetail = async (req, res) => {
    const mentorId = req.params.id;

    try {
        const mentorQuery = await pool.query(
            `SELECT u.id, u.full_name, u.avatar_url, u.bio, u.skills, u.university, u.xp_points, u.streak_count,
                    mv.hourly_rate, mv.calendly_link, mv.qr_payment_url,
                    s.title AS scholarship_name,
                    COALESCE(ROUND(AVG(mr.rating), 1), 5.0) AS avg_rating,
                    COUNT(mr.id) AS total_reviews
             FROM users u
             LEFT JOIN mentor_verifications mv ON u.id = mv.user_id AND mv.status = 'approved'
             LEFT JOIN scholarships s ON mv.scholarship_id = s.id
             LEFT JOIN mentor_reviews mr ON u.id = mr.mentor_id
             WHERE u.id = $1 AND u.role = 'mentor'
             GROUP BY u.id, mv.id, s.id`,
            [mentorId]
        );

        if (mentorQuery.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy Mentor này!' });
        }

        const reviewsQuery = await pool.query(
            `SELECT mr.*, u.full_name AS mentee_name, u.avatar_url AS mentee_avatar
             FROM mentor_reviews mr
             JOIN users u ON mr.mentee_id = u.id
             WHERE mr.mentor_id = $1
             ORDER BY mr.created_at DESC`,
            [mentorId]
        );

        res.status(200).json({
            success: true,
            data: {
                mentor: mentorQuery.rows[0],
                reviews: reviewsQuery.rows
            }
        });
    } catch (err) {
        console.error('Lỗi getMentorDetail:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

exports.createMentorReview = async (req, res) => {
    const menteeId = req.user.id;
    const mentorId = req.params.id;
    const { application_id, rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({
            success: false,
            message: 'Số sao đánh giá phải từ 1 đến 5!'
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO mentor_reviews (mentor_id, mentee_id, application_id, rating, comment)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [mentorId, menteeId, application_id || null, rating, comment || null]
        );

        if (rating >= 4) {
            await pool.query('UPDATE users SET xp_points = xp_points + 20 WHERE id = $1', [mentorId]);
        }

        res.status(201).json({
            success: true,
            message: 'Đánh giá Mentor thành công!',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi createMentorReview:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};