const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Toàn bộ API này đều yêu cầu đăng nhập
router.use(verifyToken);

router.put('/profile', userController.updateProfile);
router.patch('/mentor-status', userController.toggleMentorStatus);
router.post('/saved/:scholarshipId', userController.saveScholarship);
router.delete('/saved/:scholarshipId', userController.unsaveScholarship);
router.get('/saved', userController.getSavedScholarships);

module.exports = router;