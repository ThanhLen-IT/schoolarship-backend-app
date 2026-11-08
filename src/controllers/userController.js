const pool = require('../config/db');

// 1. Cập nhật thông tin cá nhân & kỹ năng
exports.updateProfile = async (req, res) => {
    const userId = req.user.id;
    const { full_name, university, bio, skills, avatar_url } = req.body;

    try {
        const result = await pool.query(
            `UPDATE users 
             SET full_name = COALESCE($1, full_name),
                 university = COALESCE($2, university),
                 bio = COALESCE($3, bio),
                 skills = COALESCE($4, skills),
                 avatar_url = COALESCE($5, avatar_url),
                 updated_at = NOW()
             WHERE id = $6
             RETURNING id, email, full_name, university, bio, skills, avatar_url, role`,
            [full_name, university, bio, skills, avatar_url, userId]
        );

        res.status(200).json({
            success: true,
            message: 'Cập nhật hồ sơ thành công!',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi updateProfile:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

// 2. Chuyển đổi vai trò Mentor (Bật/Tắt)
exports.toggleMentorStatus = async (req, res) => {
    const userId = req.user.id;
    const { is_mentor } = req.body;
    const newRole = is_mentor ? 'mentor' : 'user';

    try {
        const result = await pool.query(
            `UPDATE users 
             SET role = $1, updated_at = NOW() 
             WHERE id = $2 
             RETURNING id, full_name, role`,
            [newRole, userId]
        );

        res.status(200).json({
            success: true,
            message: `Chế độ Mentor đã được cập nhật thành: ${newRole}`,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi toggleMentorStatus:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

// 3. Lưu học bổng (Bookmark)
exports.saveScholarship = async (req, res) => {
    const userId = req.user.id;
    const scholarshipId = req.params.scholarshipId;

    try {
        await pool.query(
            `INSERT INTO saved_scholarships (user_id, scholarship_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, scholarship_id) DO NOTHING`,
            [userId, scholarshipId]
        );

        res.status(200).json({
            success: true,
            message: 'Đã lưu học bổng thành công!'
        });
    } catch (err) {
        console.error('Lỗi saveScholarship:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

// 4. Bỏ lưu học bổng
exports.unsaveScholarship = async (req, res) => {
    const userId = req.user.id;
    const scholarshipId = req.params.scholarshipId;

    try {
        await pool.query(
            `DELETE FROM saved_scholarships WHERE user_id = $1 AND scholarship_id = $2`,
            [userId, scholarshipId]
        );

        res.status(200).json({
            success: true,
            message: 'Đã bỏ lưu học bổng!'
        });
    } catch (err) {
        console.error('Lỗi unsaveScholarship:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

// 5. Lấy danh sách học bổng đã lưu
exports.getSavedScholarships = async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `SELECT s.*, ss.saved_at
             FROM scholarships s
             JOIN saved_scholarships ss ON s.id = ss.scholarship_id
             WHERE ss.user_id = $1
             ORDER BY ss.saved_at DESC`,
            [userId]
        );

        res.status(200).json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error('Lỗi getSavedScholarships:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};