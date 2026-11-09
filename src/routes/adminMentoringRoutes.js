const express = require('express');
const router = express.Router();
const { verifyToken, authorizeRoles } = require('../middlewares/authMiddleware');
const controller = require('../controllers/mentoringProgressController');

router.use(verifyToken, authorizeRoles('admin'));
router.patch('/applications/:id/outcome', controller.recordOutcome);

module.exports = router;
