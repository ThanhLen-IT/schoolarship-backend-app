const express = require("express");
const router = express.Router();

const scholarshipController = require("../controllers/scholarshipController");

const {
  verifyToken,
  authorizeRoles,
} = require("../middlewares/authMiddleware");

// Tất cả API bên dưới đều yêu cầu đăng nhập
// và tài khoản phải có role = 'admin'.
router.use(verifyToken, authorizeRoles("admin"));

// Lấy danh sách học bổng cho Web Admin
router.get("/", scholarshipController.getAdminScholarships);

// Xem chi tiết một học bổng
router.get("/:id", scholarshipController.getAdminScholarshipById);

// Tạo học bổng
router.post("/", scholarshipController.createScholarship);

// Chỉnh sửa thông tin học bổng
router.put("/:id", scholarshipController.updateScholarship);

// Duyệt và công khai học bổng
router.patch("/:id/approve", scholarshipController.approveScholarship);

// Từ chối học bổng
router.patch("/:id/reject", scholarshipController.rejectScholarship);

// Lưu trữ học bổng
router.patch("/:id/archive", scholarshipController.archiveScholarship);

// Xóa học bổng
router.delete("/:id", scholarshipController.deleteScholarship);

module.exports = router;
