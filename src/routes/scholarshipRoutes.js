const express = require('express');
const router = express.Router();
const scholarshipController = require('../controllers/scholarshipController');

// Các route xem học bổng (Công khai)
router.get('/', scholarshipController.getScholarships);
router.get('/:id', scholarshipController.getScholarshipById);
router.post('/', scholarshipController.createScholarship); // Dùng cho Admin / Seed dữ liệu

module.exports = router;