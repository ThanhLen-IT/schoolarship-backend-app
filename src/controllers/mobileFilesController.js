const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const multer = require("multer");
const sharp = require("sharp");
const pool = require("../config/db");
const { uploadDir } = require("../middlewares/uploadMiddleware");
const avatarDir = path.join(__dirname, "../../media/avatars");
const avatarName = /^avatar-\d+-[a-f0-9-]{36}\.webp$/i;
exports.avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, done) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype))
      done(null, true);
    else {
      const error = new Error("Định dạng ảnh không hỗ trợ.");
      error.status = 400;
      done(error);
    }
  },
}).single("avatar");
exports.avatar = async (req, res) => {
  if (!req.file) {
    const error = new Error("Thiếu ảnh đại diện.");
    error.status = 400;
    throw error;
  }
  let bytes;
  try {
    const image = sharp(req.file.buffer, { limitInputPixels: 20000000 });
    const info = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(info.format))
      throw new Error("Unsupported format");
    bytes = await image
      .rotate()
      .resize(512, 512, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (_) {
    const error = new Error("Ảnh không hợp lệ.");
    error.status = 400;
    throw error;
  }
  const filename = "avatar-" + req.user.id + "-" + randomUUID() + ".webp";
  await fs.mkdir(avatarDir, { recursive: true });
  await fs.writeFile(path.join(avatarDir, filename), bytes, { flag: "wx" });
  const base = (
    process.env.PUBLIC_BASE_URL || "https://scholarship-uit.duckdns.org"
  ).replace(/\/$/, "");
  const url = base + "/media/avatars/" + filename;
  try {
    const result = await pool.query(
      "UPDATE users SET avatar_url=$2,updated_at=NOW() WHERE id=$1 AND is_active=TRUE RETURNING avatar_url",
      [req.user.id, url],
    );
    if (!result.rows.length)
      throw Object.assign(new Error("Account unavailable"), { status: 403 });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await fs.unlink(path.join(avatarDir, filename)).catch(() => {});
    throw error;
  }
};
exports.serveAvatar = (req, res, next) => {
  if (!avatarName.test(req.params.file)) return res.status(404).end();
  res.set("X-Content-Type-Options", "nosniff");
  res.sendFile(
    req.params.file,
    { root: avatarDir, dotfiles: "deny", maxAge: "1d" },
    (error) => {
      if (error) next(error);
    },
  );
};
exports.cleanupFailedPdf = (req, res, next) => {
  res.once("finish", () => {
    if (res.statusCode >= 400 && req.file?.path)
      fs.unlink(req.file.path).catch(() => {});
  });
  next();
};
exports.validatePdf = async (req, res, next) => {
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "Vui lòng chọn CV PDF." });
  const handle = await fs.open(req.file.path, "r");
  const bytes = Buffer.alloc(5);
  try {
    await handle.read(bytes, 0, 5, 0);
  } finally {
    await handle.close();
  }
  if (bytes.toString("ascii") !== "%PDF-")
    return res
      .status(400)
      .json({ success: false, message: "Tệp không phải PDF hợp lệ." });
  next();
};
exports.cv = async (req, res) => {
  const n = Number(req.params.id);
  if (!Number.isSafeInteger(n) || n < 1)
    return res
      .status(400)
      .json({ success: false, message: "ID không hợp lệ." });
  const result = await pool.query(
    "SELECT cv_file_url FROM mentee_applications WHERE id=$1 AND (mentee_id=$2 OR mentor_id=$2)",
    [n, req.user.id],
  );
  if (!result.rows.length)
    return res
      .status(404)
      .json({ success: false, message: "Không tìm thấy hồ sơ của bạn." });
  const url = result.rows[0].cv_file_url;
  if (url?.startsWith("/private-cv/")) {
    const filename = url.slice("/private-cv/".length);
    if (!/^evidence-\d+-\d+-[a-f0-9]+\.pdf$/.test(filename))
      return res.status(404).end();
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    return res.sendFile(filename, { root: uploadDir, dotfiles: "deny" });
  }
  if (/^https?:\/\//i.test(url || "")) return res.redirect(url);
  res.status(404).json({ success: false, message: "CV không khả dụng." });
};
