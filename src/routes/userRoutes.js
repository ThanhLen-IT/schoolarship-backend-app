const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Tất cả các route bên dưới đều yêu cầu đăng nhập bằng Token
router.use(verifyToken);

// Cập nhật thông tin cá nhân & kỹ năng
router.put('/profile', userController.updateProfile);

// Bật / tắt chế độ Mentor
router.patch('/mentor-status', userController.toggleMentorStatus);

// Lưu học bổng (Bookmark)
router.post('/saved/:scholarshipId', userController.saveScholarship);

// Bỏ lưu học bổng
router.delete('/saved/:scholarshipId', userController.unsaveScholarship);

// Lấy danh sách học bổng đã lưu
router.get('/saved', userController.getSavedScholarships);

module.exports = router;