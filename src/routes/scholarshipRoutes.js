const express = require('express');
const router = express.Router();
const scholarshipController = require('../controllers/scholarshipController');

router.get('/', scholarshipController.getScholarships);
router.get('/:id', scholarshipController.getScholarshipById);
router.post('/', scholarshipController.createScholarship);

module.exports = router;
