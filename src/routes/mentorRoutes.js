const express = require('express');
const router = express.Router();
const mentorController = require('../controllers/mentorController');
const { verifyToken } = require('../middlewares/authMiddleware');
const { uploadEvidence } = require('../middlewares/uploadMiddleware');

// 1. Tuyến đường tĩnh: Danh sách Mentor (Công khai)
router.get('/', mentorController.getMentors);

// 2. Tuyến đường tĩnh: Kiểm tra trạng thái duyệt Mentor của user hiện tại (Phải đặt TRƯỚC /:id)
router.get('/verify/status', verifyToken, mentorController.getMyVerificationStatus);

// 3. Tuyến đường tĩnh: Nộp hồ sơ xét duyệt Mentor kèm file PDF
router.post('/verify', verifyToken, uploadEvidence.single('evidence_file'), mentorController.applyMentorVerification);

// 4. Tuyến đường động: Xem chi tiết hồ sơ Mentor theo ID (Đặt sau các route tĩnh)
router.get('/:id', mentorController.getMentorDetail);

// 5. Tuyến đường động: Đánh giá sao cho Mentor
router.post('/:id/reviews', verifyToken, mentorController.createMentorReview);

module.exports = router;