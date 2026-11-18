const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");

function reject(status, message) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  throw error;
}
function id(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) reject(400, "ID không hợp lệ.");
  return n;
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    reject(400, "Nội dung trống hoặc vượt giới hạn.");
  return value.trim();
}
function paging(query, max = 100) {
  const page = query.page === undefined ? 1 : id(query.page);
  const limit = query.limit === undefined ? 20 : id(query.limit);
  if (page > 100000 || limit > max) reject(400, "Phân trang không hợp lệ.");
  return { page, limit, offset: (page - 1) * limit };
}
exports.filters = async (req, res) => {
  const result = await pool.query(`SELECT
  ARRAY(SELECT DISTINCT country FROM scholarships WHERE status='published' AND country IS NOT NULL AND btrim(country)<>'' ORDER BY country) AS countries,
  ARRAY(SELECT DISTINCT type FROM scholarships WHERE status='published' AND type IS NOT NULL AND btrim(type)<>'' ORDER BY type) AS types,
  ARRAY(SELECT DISTINCT x FROM scholarships, unnest(majors) x WHERE status='published' AND btrim(x)<>'' ORDER BY x) AS majors,
  ARRAY(SELECT DISTINCT x FROM scholarships, unnest(study_levels) x WHERE status='published' AND x IN ('bachelor','master','doctoral','all','other','unknown') ORDER BY x) AS study_levels`);
  res.json({ success: true, data: result.rows[0] });
};
exports.conversations = async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const params = [req.user.id];
  const from = `FROM conversations c JOIN users u ON u.id=CASE WHEN c.user1_id=$1 THEN c.user2_id ELSE c.user1_id END
  WHERE (c.user1_id=$1 OR c.user2_id=$1) AND u.is_active=TRUE`;
  const count = await pool.query(
    "SELECT COUNT(*)::int AS total " + from,
    params,
  );
  const result = await pool.query(
    `SELECT c.id,u.id AS peer_id,u.full_name AS peer_name,u.avatar_url,
  c.last_message,c.last_message_at,(SELECT COUNT(*)::int FROM chat_messages m WHERE m.conversation_id=c.id AND m.sender_id<>$1 AND NOT m.is_read) AS unread_count
  ${from} ORDER BY c.last_message_at DESC NULLS LAST,c.id DESC LIMIT $2 OFFSET $3`,
    [...params, limit, offset],
  );
  res.json({
    success: true,
    page,
    limit,
    total: count.rows[0].total,
    totalPages: Math.ceil(count.rows[0].total / limit),
    data: result.rows,
  });
};
exports.createConversation = async (req, res) => {
  const peer = id(req.body?.participant_id),
    self = req.user.id;
  if (peer === self) reject(400, "Không thể trò chuyện với chính bạn.");
  const permitted = await pool.query(
    `SELECT 1 FROM users u WHERE u.id=$2 AND u.is_active=TRUE AND EXISTS(
  SELECT 1 FROM mentee_applications ma WHERE ((ma.mentee_id=$1 AND ma.mentor_id=$2) OR (ma.mentor_id=$1 AND ma.mentee_id=$2))
  AND ma.status IN ('accepted','in_progress','completed'))`,
    [self, peer],
  );
  if (!permitted.rows.length)
    reject(
      403,
      "Bạn chỉ có thể trò chuyện sau khi hồ sơ mentoring được chấp nhận.",
    );
  const result = await pool.query(
    `INSERT INTO conversations(user1_id,user2_id) VALUES(LEAST($1::int,$2::int),GREATEST($1::int,$2::int))
  ON CONFLICT(user1_id,user2_id) DO UPDATE SET user1_id=EXCLUDED.user1_id RETURNING id`,
    [self, peer],
  );
  res.json({ success: true, data: result.rows[0] });
};
async function conversation(db, conversationId, userId, lock = false) {
  const result = await db.query(
    `SELECT c.id,c.user1_id,c.user2_id FROM conversations c
  JOIN users u ON u.id=CASE WHEN c.user1_id=$2 THEN c.user2_id ELSE c.user1_id END
  WHERE c.id=$1 AND (c.user1_id=$2 OR c.user2_id=$2) AND u.is_active=TRUE ${lock ? "FOR UPDATE OF c" : ""}`,
    [conversationId, userId],
  );
  if (!result.rows.length)
    reject(404, "Không tìm thấy cuộc trò chuyện của bạn.");
  return result.rows[0];
}
exports.messages = async (req, res) => {
  const cid = id(req.params.id),
    limit = req.query.limit === undefined ? 50 : id(req.query.limit);
  if (limit > 100 || (req.query.before_id && req.query.after_id))
    reject(400, "Con trỏ tin nhắn không hợp lệ.");
  await conversation(pool, cid, req.user.id);
  const before = req.query.before_id ? id(req.query.before_id) : null,
    after = req.query.after_id ? id(req.query.after_id) : null;
  const result = await pool.query(
    `SELECT id,sender_id,message,is_read,created_at,client_message_id FROM chat_messages
  WHERE conversation_id=$1 ${before ? "AND id<$3" : after ? "AND id>$3" : ""}
  ORDER BY id ${after ? "ASC" : "DESC"} LIMIT $2`,
    [cid, limit + 1, ...(before || after ? [before || after] : [])],
  );
  const more = result.rows.length > limit,
    rows = result.rows.slice(0, limit);
  if (!after) rows.reverse();
  res.json({ success: true, has_more: more, data: rows });
};
exports.sendMessage = async (req, res) => {
  const cid = id(req.params.id),
    message = text(req.body?.message, 4000),
    key = req.body?.client_message_id;
  if (
    typeof key !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      key,
    )
  )
    reject(400, "Mã tin nhắn không hợp lệ.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const c = await conversation(client, cid, req.user.id, true);
    const inserted = await client.query(
      `INSERT INTO chat_messages(conversation_id,sender_id,message,client_message_id) VALUES($1,$2,$3,$4)
   ON CONFLICT(conversation_id,sender_id,client_message_id) DO NOTHING RETURNING id,sender_id,message,is_read,created_at,client_message_id`,
      [cid, req.user.id, message, key],
    );
    let row = inserted.rows[0];
    if (row) {
      await client.query(
        "UPDATE conversations SET last_message=$2,last_message_at=NOW() WHERE id=$1",
        [cid, message],
      );
      const peer = c.user1_id === req.user.id ? c.user2_id : c.user1_id;
      await client.query(
        `INSERT INTO notifications(user_id,title,content,type,reference_id) VALUES($1,'Tin nhắn mới','Bạn có tin nhắn mới trong cuộc trò chuyện.','chat',$2)`,
        [peer, cid],
      );
    } else
      row = (
        await client.query(
          "SELECT id,sender_id,message,is_read,created_at,client_message_id FROM chat_messages WHERE conversation_id=$1 AND sender_id=$2 AND client_message_id=$3",
          [cid, req.user.id, key],
        )
      ).rows[0];
    await client.query("COMMIT");
    res
      .status(inserted.rows.length ? 201 : 200)
      .json({ success: true, data: row });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
exports.readConversation = async (req, res) => {
  const cid = id(req.params.id),
    through = id(req.body?.through_id);
  await conversation(pool, cid, req.user.id);
  await pool.query(
    `WITH seen AS (UPDATE chat_messages SET is_read=TRUE WHERE conversation_id=$1 AND id<=$2 AND sender_id<>$3 RETURNING id) UPDATE notifications SET is_read=TRUE WHERE user_id=$3 AND type='chat' AND reference_id=$1 AND created_at<=(SELECT created_at FROM chat_messages WHERE id=$2 AND conversation_id=$1)`,
    [cid, through, req.user.id],
  );
  res.json({ success: true });
};
exports.notifications = async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const counts = await pool.query(
    "SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE NOT is_read)::int AS unread_count FROM notifications WHERE user_id=$1",
    [req.user.id],
  );
  const result = await pool.query(
    "SELECT id,title,content,type,reference_id,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3",
    [req.user.id, limit, offset],
  );
  res.json({
    success: true,
    page,
    limit,
    ...counts.rows[0],
    totalPages: Math.ceil(counts.rows[0].total / limit),
    data: result.rows,
  });
};
exports.readNotification = async (req, res) => {
  const result = await pool.query(
    "UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2 RETURNING id",
    [id(req.params.id), req.user.id],
  );
  if (!result.rows.length) reject(404, "Không tìm thấy thông báo của bạn.");
  res.json({ success: true, data: result.rows[0] });
};
exports.readAllNotifications = async (req, res) => {
  await pool.query(
    "UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND NOT is_read",
    [req.user.id],
  );
  res.json({ success: true });
};
exports.support = async (req, res) => {
  const subject = text(req.body?.subject, 255),
    message = text(req.body?.message, 5000);
  const result = await pool.query(
    "INSERT INTO support_tickets(user_id,subject,message) VALUES($1,$2,$3) RETURNING id,status,created_at",
    [req.user.id, subject, message],
  );
  res.status(201).json({ success: true, data: result.rows[0] });
};
exports.supportHistory = async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const count = await pool.query(
    "SELECT COUNT(*)::int AS total FROM support_tickets WHERE user_id=$1",
    [req.user.id],
  );
  const result = await pool.query(
    "SELECT id,subject,message,status,admin_response,created_at FROM support_tickets WHERE user_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3",
    [req.user.id, limit, offset],
  );
  res.json({
    success: true,
    page,
    limit,
    total: count.rows[0].total,
    totalPages: Math.ceil(count.rows[0].total / limit),
    data: result.rows,
  });
};
exports.closeAccount = async (req, res) => {
  if (req.user.role === "admin")
    reject(403, "Tài khoản quản trị cần được quản lý bởi quản trị viên khác.");
  const password = req.body?.current_password;
  if (
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > 200
  )
    reject(400, "Vui lòng nhập mật khẩu xác nhận.");
  const replacement = await bcrypt.hash(randomUUID(), 12),
    client = await pool.connect();
  let files = [];
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT password_hash,avatar_url FROM users WHERE id=$1 AND is_active=TRUE FOR UPDATE",
      [req.user.id],
    );
    if (
      !result.rows.length ||
      !(await bcrypt.compare(password, result.rows[0].password_hash))
    )
      reject(403, "Mật khẩu xác nhận không đúng.");
    await client.query(
      `UPDATE users SET is_active=FALSE,is_mentor=FALSE,role='user',email=$2,full_name='Tài khoản đã đóng',
   username=NULL,password_hash=$3,avatar_url=NULL,bio=NULL,skills=NULL,university=NULL,major=NULL,
   reset_password_token=NULL,reset_password_expires=NULL,updated_at=NOW() WHERE id=$1`,
      [req.user.id, `deleted-${randomUUID()}@deleted.invalid`, replacement],
    );
    const documents = await client.query(
      "SELECT cv_file_url AS file FROM mentee_applications WHERE mentee_id=$1 UNION ALL SELECT evidence_file_url AS file FROM mentor_verifications WHERE user_id=$1",
      [req.user.id],
    );
    files = documents.rows.map((r) => r.file);
    files.push(result.rows[0].avatar_url);
    await client.query(
      "UPDATE mentee_applications SET cv_file_url='',introduction=NULL WHERE mentee_id=$1",
      [req.user.id],
    );
    await client.query(
      "UPDATE mentee_applications SET status='cancelled' WHERE (mentee_id=$1 OR mentor_id=$1) AND status IN ('pending','accepted','in_progress')",
      [req.user.id],
    );
    await client.query(
      "UPDATE mentor_verifications SET evidence_file_url='',calendly_link=NULL,qr_payment_url=NULL,hourly_rate=0,status='rejected' WHERE user_id=$1",
      [req.user.id],
    );
    for (const table of [
      "saved_scholarships",
      "notifications",
      "support_tickets",
      "post_likes",
    ])
      await client.query("DELETE FROM " + table + " WHERE user_id=$1", [
        req.user.id,
      ]);
    await client.query("DELETE FROM comments WHERE user_id=$1", [req.user.id]);
    await client.query("DELETE FROM posts WHERE author_id=$1", [req.user.id]);
    await client.query(
      "DELETE FROM conversations WHERE user1_id=$1 OR user2_id=$1",
      [req.user.id],
    );
    // Keep anonymized IDs for mentoring/payment history protected by RESTRICT FKs.
    await client.query("COMMIT");
    for (const value of files) {
      const name = typeof value === "string" ? value.split("/").pop() : "";
      let folder;
      if (
        new RegExp(
          "^avatar-" + req.user.id + "-[a-f0-9-]{36}\\.webp$",
          "i",
        ).test(name)
      )
        folder = path.join(__dirname, "../../media/avatars");
      else if (
        new RegExp("^evidence-" + req.user.id + "-\\d+-[a-f0-9]+\\.pdf$").test(
          name,
        )
      )
        folder = path.join(__dirname, "../../uploads");
      if (folder)
        await fs.unlink(path.join(folder, name)).catch((error) => {
          if (error.code !== "ENOENT") req.logError?.(error);
        });
    }
    const directory = path.join(__dirname, "../../media/avatars");
    const owned = new RegExp(
      "^avatar-" + req.user.id + "-[a-f0-9-]{36}\\.webp$",
      "i",
    );
    for (const filename of await fs.readdir(directory).catch(() => []))
      if (owned.test(filename))
        await fs
          .unlink(path.join(directory, filename))
          .catch((error) => req.logError?.(error));
    res.json({
      success: true,
      message: "Tài khoản đã được đóng và thông tin hồ sơ đã được xóa.",
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
exports.adminSupport = async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const count = await pool.query(
    "SELECT COUNT(*)::int AS total FROM support_tickets",
  );
  const result = await pool.query(
    "SELECT id,user_id,subject,message,status,admin_response,created_at FROM support_tickets ORDER BY id DESC LIMIT $1 OFFSET $2",
    [limit, offset],
  );
  res.json({
    success: true,
    page,
    limit,
    total: count.rows[0].total,
    totalPages: Math.ceil(count.rows[0].total / limit),
    data: result.rows,
  });
};
exports.replySupport = async (req, res) => {
  const reply = text(req.body?.response, 5000),
    ticket = id(req.params.id);
  const result = await pool.query(
    `WITH updated AS (
  UPDATE support_tickets SET admin_response=$2,status='resolved',resolved_at=NOW() WHERE id=$1 RETURNING id,user_id,status,admin_response
 ), note AS (
  INSERT INTO notifications(user_id,title,content,type,reference_id)
  SELECT user_id,'Yêu cầu hỗ trợ đã được phản hồi','Mở Hỗ trợ & góp ý để đọc phản hồi.','support',id FROM updated RETURNING id
 ) SELECT id,status,admin_response FROM updated`,
    [ticket, reply],
  );
  if (!result.rows.length) reject(404, "Không tìm thấy yêu cầu hỗ trợ.");
  res.json({ success: true, data: result.rows[0] });
};
