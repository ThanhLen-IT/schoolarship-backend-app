const pool = require('../config/db');

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function pagination(query = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 10 : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return null;
  }
  return { page, limit, offset: (page - 1) * limit };
}

function optionalHttpUrl(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch (_) {
    return undefined;
  }
}

const visiblePostJoin =
  ' FROM posts p JOIN users u ON p.author_id = u.id ' +
  ' LEFT JOIN scholarships s ON p.scholarship_id = s.id ' +
  ' WHERE u.is_active = TRUE ' +
  " AND (p.scholarship_id IS NULL OR s.status = 'published')";

const postFields =
  'p.id, p.author_id, p.scholarship_id, p.title, p.content, p.image_url, ' +
  'p.like_count, p.comment_count, p.created_at, p.updated_at, ' +
  'u.username AS author_username, u.full_name AS author_name, ' +
  'u.avatar_url AS author_avatar, u.role AS author_role, ' +
  's.title AS scholarship_title';

exports.getPosts = async (req, res) => {
  const paging = pagination(req.query);
  if (!paging) return res.status(400).json({ success: false, message: 'page/limit không hợp lệ.' });

  const where = [];
  const params = [];
  if (req.query.scholarship_id !== undefined) {
    const id = positiveId(req.query.scholarship_id);
    if (!id) return res.status(400).json({ success: false, message: 'scholarship_id không hợp lệ.' });
    params.push(id);
    where.push('p.scholarship_id = $' + params.length);
  }
  if (req.query.search !== undefined) {
    if (typeof req.query.search !== 'string' || req.query.search.length > 150) {
      return res.status(400).json({ success: false, message: 'Từ khóa không hợp lệ.' });
    }
    const search = req.query.search.trim();
    if (search) {
      params.push('%' + search + '%');
      where.push('(p.title ILIKE $' + params.length + ' OR p.content ILIKE $' + params.length + ')');
    }
  }

  const filter = visiblePostJoin + (where.length ? ' AND ' + where.join(' AND ') : '');
  try {
    const totalResult = await pool.query('SELECT COUNT(*)::int AS total ' + filter, params);
    const data = await pool.query(
      'SELECT ' + postFields + filter + ' ORDER BY p.created_at DESC, p.id DESC ' +
      ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
      [...params, paging.limit, paging.offset]
    );
    const total = totalResult.rows[0].total;
    return res.json({
      success: true, page: paging.page, limit: paging.limit, total,
      totalPages: Math.ceil(total / paging.limit), data: data.rows
    });
  } catch (err) {
    console.error('Lỗi getPosts:', err.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

exports.getPostById = async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID bài viết không hợp lệ!' });
  try {
    const result = await pool.query(
      'SELECT ' + postFields + visiblePostJoin + ' AND p.id = $1', [id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết!' });
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Lỗi getPostById:', err.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

exports.createPost = async (req, res) => {
  const { title, content, scholarship_id, image_url } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 255 ||
      typeof content !== 'string' || !content.trim() || content.trim().length > 20000) {
    return res.status(400).json({ success: false, message: 'Tiêu đề phải dài 1–255 ký tự và nội dung 1–20000 ký tự!' });
  }
  const scholarshipId = scholarship_id == null ? null : positiveId(scholarship_id);
  const imageUrl = optionalHttpUrl(image_url);
  if ((scholarship_id != null && !scholarshipId) || imageUrl === undefined) {
    return res.status(400).json({ success: false, message: 'scholarship_id hoặc image_url không hợp lệ!' });
  }

  try {
    // A post may only reference a currently published scholarship.
    const result = await pool.query(
      'INSERT INTO posts (author_id, scholarship_id, title, content, image_url) ' +
      'SELECT $1, $2, $3, $4, $5 WHERE $2::integer IS NULL OR EXISTS ' +
      "(SELECT 1 FROM scholarships WHERE id = $2 AND status = 'published') RETURNING *",
      [req.user.id, scholarshipId, title.trim(), content.trim(), imageUrl]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy học bổng đã công khai!' });
    }
    return res.status(201).json({ success: true, message: 'Đăng bài viết thành công!', data: result.rows[0] });
  } catch (err) {
    console.error('Lỗi createPost:', err.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

async function withLockedVisiblePost(postId, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const post = await client.query(
      'SELECT p.id FROM posts p ' +
      'JOIN users u ON p.author_id = u.id ' +
      'LEFT JOIN scholarships s ON p.scholarship_id = s.id ' +
      'WHERE p.id = $1 AND u.is_active = TRUE ' +
      "AND (p.scholarship_id IS NULL OR s.status = 'published') " +
      'FOR UPDATE OF p',
      [postId]
    );
    if (!post.rows.length) {
      await client.query('ROLLBACK');
      return { statusCode: 404, message: 'Không tìm thấy bài viết!' };
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection closed */ }
    throw err;
  } finally {
    client.release();
  }
}

exports.toggleLikePost = async (req, res) => {
  const postId = positiveId(req.params.id);
  if (!postId) return res.status(400).json({ success: false, message: 'ID bài viết không hợp lệ!' });
  try {
    const result = await withLockedVisiblePost(postId, async client => {
      const deleted = await client.query(
        'DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 RETURNING post_id',
        [postId, req.user.id]
      );
      const liked = deleted.rows.length === 0;
      if (liked) {
        await client.query(
          'INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT (post_id, user_id) DO NOTHING',
          [postId, req.user.id]
        );
      }
      // Recompute instead of relying on possibly stale counters from old versions.
      const updated = await client.query(
        'UPDATE posts SET like_count = (SELECT COUNT(*)::int FROM post_likes WHERE post_id = $1) ' +
        'WHERE id = $1 RETURNING like_count', [postId]
      );
      return { statusCode: 200, liked, like_count: updated.rows[0].like_count };
    });
    if (result.statusCode === 404) return res.status(404).json({ success: false, message: result.message });
    return res.json({
      success: true, is_liked: result.liked, like_count: result.like_count,
      message: result.liked ? 'Đã thích bài viết!' : 'Đã bỏ thích bài viết!'
    });
  } catch (err) {
    console.error('Lỗi toggleLikePost:', err.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

exports.getComments = async (req, res) => {
  const postId = positiveId(req.params.id);
  const paging = pagination({ page: req.query.page, limit: req.query.limit ?? 50 });
  if (!postId || !paging) return res.status(400).json({ success: false, message: 'ID/page/limit không hợp lệ!' });
  try {
    const post = await pool.query('SELECT p.id ' + visiblePostJoin + ' AND p.id = $1', [postId]);
    if (!post.rows.length) return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết!' });
    const [count, result] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total FROM comments WHERE post_id = $1', [postId]),
      pool.query(
        'SELECT c.*, u.full_name AS user_name, u.username AS user_username, ' +
        'u.avatar_url AS user_avatar, u.role AS user_role ' +
        'FROM comments c JOIN users u ON c.user_id = u.id ' +
        'WHERE c.post_id = $1 ORDER BY c.created_at ASC, c.id ASC ' +
        'LIMIT $2 OFFSET $3',
        [postId, paging.limit, paging.offset]
      )
    ]);
    return res.json({
      success: true, page: paging.page, limit: paging.limit,
      total: count.rows[0].total,
      totalPages: Math.ceil(count.rows[0].total / paging.limit), data: result.rows
    });
  } catch (err) {
    console.error('Lỗi getComments:', err.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

exports.addComment = async (req, res) => {
  const postId = positiveId(req.params.id);
  const { content, parent_id } = req.body || {};
  const parentId = parent_id == null ? null : positiveId(parent_id);
  if (!postId || typeof content !== 'string' || !content.trim() ||
      content.trim().length > 3000 || (parent_id != null && !parentId)) {
    return res.status(400).json({ success: false, message: 'ID, nội dung hoặc parent_id không hợp lệ!' });
  }
  try {
    const result = await withLockedVisiblePost(postId, async client => {
      if (parentId) {
        const parent = await client.query(
          'SELECT id FROM comments WHERE id = $1 AND post_id = $2', [parentId, postId]
        );
        if (!parent.rows.length) {
          return { statusCode: 400, message: 'Bình luận cha không thuộc bài viết này!' };
        }
      }
      const inserted = await client.query(
        'INSERT INTO comments (post_id, user_id, parent_id, content) ' +
        'VALUES ($1, $2, $3, $4) RETURNING *',
        [postId, req.user.id, parentId, content.trim()]
      );
      const updated = await client.query(
        'UPDATE posts SET comment_count = (SELECT COUNT(*)::int FROM comments WHERE post_id = $1) ' +
        'WHERE id = $1 RETURNING comment_count', [postId]
      );
      return {
        statusCode: 201, comment: inserted.rows[0], comment_count: updated.rows[0].comment_count
      };
    });
    if (result.statusCode !== 201) {
      return res.status(result.statusCode).json({ success: false, message: result.message });
    }
    return res.status(201).json({
      success: true, message: 'Đã gửi bình luận!',
      data: result.comment, comment_count: result.comment_count
    });
  } catch (err) {
    console.error('Lỗi addComment:', err.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};
