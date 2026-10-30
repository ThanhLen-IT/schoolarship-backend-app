const jwt = require('jsonwebtoken');
require('dotenv').config();


const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Định dạng: Bearer <TOKEN>

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Không tìm thấy Token. Vui lòng đăng nhập!'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; 
        next();
    } catch (err) {
        return res.status(403).json({
            success: false,
            message: 'Token không hợp lệ hoặc đã hết hạn!'
        });
    }
};


const authorizeRoles = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Quyền truy cập bị từ chối! Bạn không có quyền: ${roles.join(', ')}`
            });
        }
        next();
    };
};

module.exports = { verifyToken, authorizeRoles };