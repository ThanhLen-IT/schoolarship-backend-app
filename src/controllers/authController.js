const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
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
      { expiresIn: process.env.JWT_EXPIRES_IN },
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

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        is_mentor: user.is_mentor,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    delete user.password_hash;
    delete user.reset_password_token;

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

exports.forgotPassword = async (req, res) => {
  const { email, new_password } = req.body;

  if (!email || !new_password) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng cung cấp email và mật khẩu mới cần đổi!",
    });
  }

  try {
    const user = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Email này không tồn tại trong hệ thống!",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(new_password, salt);

    await pool.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2",
      [newPasswordHash, email],
    );

    res.status(200).json({
      success: true,
      message: "Đặt lại mật khẩu mới thành công! Vui lòng đăng nhập lại.",
    });
  } catch (err) {
    console.error("Lỗi Forgot Password:", err.message);
    res.status(500).json({ success: false, message: "Lỗi hệ thống máy chủ" });
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
