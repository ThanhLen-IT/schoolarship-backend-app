const express = require('express');
const router = express.Router();
const { verifyToken, authorizeRoles } = require('../middlewares/authMiddleware');
const controller = require('../controllers/adminMentorController');

router.use(verifyToken, authorizeRoles('admin'));

router.get('/verifications', controller.listVerifications);
router.patch('/verifications/:id/approve', controller.approveVerification);
router.patch('/verifications/:id/reject', controller.rejectVerification);
router.get('/verifications/:id/evidence', controller.downloadEvidence);

module.exports = router;
