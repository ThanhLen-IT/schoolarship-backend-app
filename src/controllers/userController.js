const pool = require('../config/db');
const { validateProfileInput } = require('../utils/userProfileValidation');
const { toPublicScholarship } = require('../utils/publicScholarship');

// User updates are restricted to profile fields; no role, XP or mentor privileges.
exports.updateProfile = async (req, res) => {
    let changes;
    try {
        changes = validateProfileInput(req.body);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    const keys = Object.keys(changes);
    const values = keys.map(key => changes[key]);
    const columns = keys.map((key, i) => '"' + key + '" = $' + (i + 1));

    values.push(req.user.id);
    try {
        const sql = 'UPDATE users SET ' + columns.join(', ') +
            ', updated_at = NOW() WHERE id = $' + values.length +
            ' RETURNING id, email, username, full_name, university, major, bio, skills, ' +
            'avatar_url, role, is_mentor, is_active, updated_at';
        const result = await pool.query(sql, values);
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng!' });
        }
        return res.json({ success: true, message: 'Cập nhật hồ sơ thành công!', data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, message: 'Username này đã được sử dụng!' });
        }
        console.error('Lỗi updateProfile:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

// 2. Legacy endpoint: users must NOT be able to promote their own accounts.
// Mentor verification is managed via POST /api/mentors/verify and admin approval.
exports.toggleMentorStatus = (req, res) => {
    return res.status(403).json({
        success: false,
        message: 'Không thể tự thay đổi quyền Mentor. Vui lòng nộp hồ sơ xét duyệt tại /api/mentors/verify.'
    });
};

// 3. LƯU HỌC BỔNG VÀO MỤC ĐÃ LƯU (Bookmark)
exports.saveScholarship = async (req, res) => {
    const userId = req.user.id;
    const scholarshipId = Number(req.params.scholarshipId);
    if (!Number.isSafeInteger(scholarshipId) || scholarshipId <= 0) {
        return res.status(400).json({ success: false, message: 'ID học bổng không hợp lệ!' });
    }

    try {
        // SELECT + INSERT in one statement: unpublished records cannot be bookmarked.
        const result = await pool.query(
            `INSERT INTO saved_scholarships (user_id, scholarship_id)
             SELECT $1, s.id FROM scholarships s
             WHERE s.id = $2 AND s.status = 'published'
             ON CONFLICT (user_id, scholarship_id) DO NOTHING
             RETURNING scholarship_id`,
            [userId, scholarshipId]
        );

        if (!result.rows.length) {
            const published = await pool.query(
                "SELECT 1 FROM scholarships WHERE id = $1 AND status = 'published'",
                [scholarshipId]
            );
            if (!published.rows.length) {
                return res.status(404).json({
                    success: false, message: 'Không tìm thấy học bổng đã công khai!'
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: result.rows.length ? 'Đã lưu học bổng!' : 'Học bổng đã được lưu trước đó!'
        });
    } catch (err) {
        console.error('Lỗi saveScholarship:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

// 4. BỎ LƯU HỌC BỔNG
exports.unsaveScholarship = async (req, res) => {
    const userId = req.user.id;
    const scholarshipId = Number(req.params.scholarshipId);
    if (!Number.isSafeInteger(scholarshipId) || scholarshipId <= 0) {
        return res.status(400).json({ success: false, message: 'ID học bổng không hợp lệ!' });
    }

    try {
        await pool.query(
            'DELETE FROM saved_scholarships WHERE user_id = $1 AND scholarship_id = $2',
            [userId, scholarshipId]
        );
        return res.status(200).json({ success: true, message: 'Đã bỏ lưu học bổng!' });
    } catch (err) {
        console.error('Lỗi unsaveScholarship:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

// 5. LẤY DANH SÁCH HỌC BỔNG ĐÃ LƯU
exports.getSavedScholarships = async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `SELECT s.*, ss.saved_at
             FROM scholarships s
             JOIN saved_scholarships ss ON s.id = ss.scholarship_id
             WHERE ss.user_id = $1 AND s.status = 'published'
             ORDER BY ss.saved_at DESC`,
            [userId]
        );

        res.status(200).json({
            success: true,
            total: result.rows.length,
            data: result.rows.map(toPublicScholarship)
        });
    } catch (err) {
        console.error('Lỗi getSavedScholarships:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};