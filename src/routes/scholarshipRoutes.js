const express = require("express");
const router = express.Router();

const scholarshipController = require("../controllers/scholarshipController");

const {
  verifyToken,
  authorizeRoles,
} = require("../middlewares/authMiddleware");

// ==========================================
// API CÔNG KHAI - MOBILE APP
// ==========================================

// Chỉ lấy học bổng đã công khai
router.get("/filters", require("../controllers/mobileController").filters);
router.get("/", scholarshipController.getScholarships);

// Chỉ xem chi tiết học bổng đã công khai
router.get("/:id", scholarshipController.getScholarshipById);

// ==========================================
// TƯƠNG THÍCH NGƯỢC
// ==========================================

// Tạm thời giữ API tạo học bổng cũ để tránh làm hỏng
// những phần frontend đang gọi POST /api/scholarships.
// Khi Web Admin chuyển sang API /api/admin/scholarships,
// có thể xóa đoạn này.
router.post(
  "/",
  verifyToken,
  authorizeRoles("admin"),
  scholarshipController.createScholarship,
);

module.exports = router;
