const express = require("express");
const {
  verifyToken,
  authorizeRoles,
} = require("../middlewares/authMiddleware");
const c = require("../controllers/mobileController");
const router = express.Router();
router.use(verifyToken);
router.get("/chat/conversations", c.conversations);
router.post("/chat/conversations", c.createConversation);
router.get("/chat/conversations/:id/messages", c.messages);
router.post("/chat/conversations/:id/messages", c.sendMessage);
router.patch("/chat/conversations/:id/read", c.readConversation);
router.get("/notifications", c.notifications);
router.patch("/notifications/read-all", c.readAllNotifications);
router.patch("/notifications/:id/read", c.readNotification);
router.post("/support/tickets", c.support);
router.get("/support/tickets", c.supportHistory);
router.get("/admin/support/tickets", authorizeRoles("admin"), c.adminSupport);
router.patch(
  "/admin/support/tickets/:id/reply",
  authorizeRoles("admin"),
  c.replySupport,
);
module.exports = router;
