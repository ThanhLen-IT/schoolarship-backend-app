
const express = require('express');
const router = express.Router();

const {
    verifyToken,
    authorizeRoles
} = require('../middlewares/authMiddleware');

const adminCrawlerController = require('../controllers/adminCrawlerController');

// ==================================================
// BẢO VỆ TOÀN BỘ API CRAWLER
// Yêu cầu JWT hợp lệ và tài khoản có role Admin
// ==================================================

router.use(
    verifyToken,
    authorizeRoles('admin')
);

// ==================================================
// 1. QUẢN LÝ NGUỒN CRAWLER
// ==================================================

// GET /api/admin/crawler/sources
router.get(
    '/sources',
    adminCrawlerController.getSources
);

// ==================================================
// 2. ĐIỀU KHIỂN CRAWLER
// ==================================================

// POST /api/admin/crawler/run
router.post(
    '/run',
    adminCrawlerController.startCrawler
);

// GET /api/admin/crawler/status
router.get(
    '/status',
    adminCrawlerController.getStatus
);

// ==================================================
// 3. LỊCH SỬ CRAWLER
// ==================================================

// GET /api/admin/crawler/logs
router.get(
    '/logs',
    adminCrawlerController.getLogs
);

// ==================================================
// 4. KIỂM DUYỆT HỌC BỔNG
// ==================================================

// GET /api/admin/crawler/pending-scholarships
router.get(
    '/pending-scholarships',
    adminCrawlerController.getPendingScholarships
);

// PUT /api/admin/crawler/scholarships/:id
router.put(
    '/scholarships/:id',
    adminCrawlerController.updateScholarship
);

// POST /api/admin/crawler/scholarships/:id/approve
router.post(
    '/scholarships/:id/approve',
    adminCrawlerController.approveScholarship
);

// POST /api/admin/crawler/scholarships/:id/reject
router.post(
    '/scholarships/:id/reject',
    adminCrawlerController.rejectScholarship
);

module.exports = router;
