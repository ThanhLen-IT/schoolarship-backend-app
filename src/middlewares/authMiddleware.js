const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

// Always fetch the current account status and role from PostgreSQL.
// Roles embedded in old JWTs must not override admin approval/rejection.
const verifyToken = async (req, res, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!match) {
        return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập!' });
    }

    let decoded;
    try {
        decoded = jwt.verify(match[1], process.env.JWT_SECRET);
        if (!Number.isSafeInteger(Number(decoded.id)) || Number(decoded.id) <= 0) {
            throw new Error('Invalid user ID');
        }
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn!' });
    }

    try {
        const result = await pool.query(
            'SELECT id, email, role, is_mentor, is_active FROM users WHERE id = $1',
            [decoded.id]
        );
        const user = result.rows[0];
        if (!user) {
            return res.status(401).json({ success: false, message: 'Tài khoản không tồn tại!' });
        }
        if (!user.is_active) {
            return res.status(403).json({ success: false, message: 'Tài khoản đã bị vô hiệu hóa!' });
        }
        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            is_mentor: user.is_mentor
        };
        return next();
    } catch (err) {
        console.error('Lỗi xác thực người dùng:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xác thực.' });
    }
};

const authorizeRoles = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập chức năng này!' });
    }
    return next();
};

const authorizeMentor = async (req, res, next) => {
    if (!req.user || req.user.role !== 'mentor' || req.user.is_mentor !== true) {
        return res.status(403).json({ success: false, message: 'Bạn chưa được xác minh là Mentor!' });
    }
    try {
        const result = await pool.query(
            "SELECT 1 FROM mentor_verifications WHERE user_id = $1 AND status = 'approved' LIMIT 1",
            [req.user.id]
        );
        if (!result.rows.length) {
            return res.status(403).json({ success: false, message: 'Hồ sơ Mentor chưa được duyệt!' });
        }
        return next();
    } catch (err) {
        console.error('Lỗi kiểm tra Mentor:', err.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xác minh Mentor.' });
    }
};

module.exports = { verifyToken, authorizeRoles, authorizeMentor };
