const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomBytes, createHash } = require("crypto");
const {
  isPasswordResetEmailConfigured,
  sendPasswordResetEmail,
} = require("../services/passwordResetEmailService");
require("dotenv").config();

exports.register = async (req, res) => {
  const { email, password, full_name, university } = req.body;

  if (!email || !password || !full_name) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng cung cấp đầy đủ email, mật khẩu và họ tên!",
    });
  }

  try {
    const userExists = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email],
    );
    if (userExists.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email này đã được đăng ký tài khoản!",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, university, role)
             VALUES ($1, $2, $3, $4, 'user')
             RETURNING id, email, full_name, university, role, is_mentor, created_at`,
      [email, passwordHash, full_name, university || null],
    );

    const token = jwt.sign(
      {
        id: newUser.rows[0].id,
        email: newUser.rows[0].email,
        role: newUser.rows[0].role,
        is_mentor: newUser.rows[0].is_mentor,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );

    res.status(201).json({
      success: true,
      message: "Đăng ký tài khoản thành công!",
      data: {
        user: newUser.rows[0],
        token,
      },
    });
  } catch (err) {
    console.error("Lỗi Register:", err.message);
    res.status(500).json({ success: false, message: "Lỗi hệ thống máy chủ" });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng nhập đầy đủ email và mật khẩu!",
    });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Email hoặc mật khẩu không chính xác!",
      });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Email hoặc mật khẩu không chính xác!",
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Tài khoản đã bị vô hiệu hóa.",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        is_mentor: user.is_mentor,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );

    delete user.password_hash;
    delete user.reset_password_token;
    delete user.reset_password_expires;

    res.status(200).json({
      success: true,
      message: "Đăng nhập thành công!",
      data: {
        user,
        token,
      },
    });
  } catch (err) {
    console.error("Lỗi Login:", err.message);
    res.status(500).json({ success: false, message: "Lỗi hệ thống máy chủ" });
  }
};

// A password reset must be authorized by a single-use token delivered to email.
// Never accept a new password directly from the unauthenticated request endpoint.
exports.forgotPassword = async (req, res) => {
  const email = req.body?.email;

  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng cung cấp email hợp lệ!",
    });
  }

  if (!isPasswordResetEmailConfigured()) {
    return res.status(503).json({
      success: false,
      message: "Chức năng khôi phục mật khẩu chưa được cấu hình.",
    });
  }

  const successResponse = () =>
    res.status(200).json({
      success: true,
      message: "Nếu email đã đăng ký, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.",
    });

  try {
    const result = await pool.query(
      `SELECT id, email,
              (reset_password_token IS NOT NULL
               AND reset_password_expires > NOW() + INTERVAL '14 minutes') AS recently_requested
       FROM users
       WHERE email = $1 AND is_active = TRUE
       LIMIT 1`,
      [email.trim()],
    );

    if (result.rows.length === 0 || result.rows[0].recently_requested) {
      return successResponse();
    }

    const user = result.rows[0];
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await pool.query(
      `UPDATE users
       SET reset_password_token = $1,
           reset_password_expires = NOW() + INTERVAL '15 minutes',
           updated_at = NOW()
       WHERE id = $2`,
      [tokenHash, user.id],
    );

    try {
      await sendPasswordResetEmail(user.email, token);
    } catch (sendError) {
      // Clear only our token, avoiding deletion of a newer concurrent request.
      await pool.query(
        `UPDATE users
         SET reset_password_token = NULL, reset_password_expires = NULL
         WHERE id = $1 AND reset_password_token = $2`,
        [user.id, tokenHash],
      );
      console.error("Lỗi gửi email đặt lại mật khẩu:", sendError.message);
    }

    return successResponse();
  } catch (err) {
    console.error("Lỗi Forgot Password:", err.message);
    return res.status(500).json({
      success: false,
      message: "Lỗi hệ thống máy chủ",
    });
  }
};

// Use the emailed token (not just an email address) to set a new password.
exports.resetPassword = async (req, res) => {
  const { token, new_password } = req.body || {};

  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token) ||
    typeof new_password !== "string" ||
    Buffer.byteLength(new_password, "utf8") < 8 ||
    Buffer.byteLength(new_password, "utf8") > 72
  ) {
    return res.status(400).json({
      success: false,
      message: "Token không hợp lệ hoặc mật khẩu phải dài từ 8 đến 72 byte.",
    });
  }

  try {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const passwordHash = await bcrypt.hash(new_password, 12);
    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1,
           reset_password_token = NULL,
           reset_password_expires = NULL,
           updated_at = NOW()
       WHERE reset_password_token = $2
         AND reset_password_expires > NOW()
         AND is_active = TRUE
       RETURNING id`,
      [passwordHash, tokenHash],
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đặt lại mật khẩu thành công! Vui lòng đăng nhập lại.",
    });
  } catch (err) {
    console.error("Lỗi Reset Password:", err.message);
    return res.status(500).json({
      success: false,
      message: "Lỗi hệ thống máy chủ",
    });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await pool.query(
      `SELECT
                id,
                email,
                full_name,
                university,
                avatar_url,
                bio,
                role,
                is_mentor,
                is_active,
                xp_points,
                streak_count,
                created_at
             FROM users
             WHERE id = $1`,
      [req.user.id],
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy người dùng",
      });
    }

    const currentUser = user.rows[0];

    if (!currentUser.is_active) {
      return res.status(403).json({
        success: false,
        message: "Tài khoản đã bị vô hiệu hóa.",
      });
    }

    res.status(200).json({
      success: true,
      data: currentUser,
    });
  } catch (err) {
    console.error("Lỗi getMe:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi hệ thống máy chủ",
    });
  }
};
