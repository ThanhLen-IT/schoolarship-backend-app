const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const controller = require('../controllers/mentoringProgressController');

router.use(verifyToken);
router.get('/applications/mine', controller.getMyApplications);
router.post('/applications', controller.createApplication);
router.patch('/applications/:id/progress', controller.updateApplicationProgress);
router.post('/applications/:id/response-requests', controller.createResponseRequest);
router.get('/applications/:id/response-requests', controller.listResponseRequests);
router.patch('/response-requests/:id/respond', controller.respondToRequest);

module.exports = router;
