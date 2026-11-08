const pool = require('../config/db');

exports.getPosts = async (req, res) => {
    const { scholarship_id, search, limit = 10, page = 1 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
        SELECT p.*, 
               u.full_name AS author_name, 
               u.avatar_url AS author_avatar,
               u.role AS author_role,
               s.title AS scholarship_title
        FROM posts p
        JOIN users u ON p.author_id = u.id
        LEFT JOIN scholarships s ON p.scholarship_id = s.id
        WHERE 1=1
    `;
    const params = [];

    if (scholarship_id) {
        params.push(scholarship_id);
        query += ` AND p.scholarship_id = $${params.length}`;
    }

    if (search) {
        params.push(`%${search}%`);
        query += ` AND (p.title ILIKE $${params.length} OR p.content ILIKE $${params.length})`;
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    try {
        const result = await pool.query(query, params);
        res.status(200).json({
            success: true,
            page: parseInt(page),
            limit: parseInt(limit),
            total: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error('Lỗi getPosts:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

exports.createPost = async (req, res) => {
    const authorId = req.user.id;
    const { title, content, scholarship_id, image_url } = req.body;

    if (!title || !content) {
        return res.status(400).json({
            success: false,
            message: 'Tiêu đề và nội dung bài viết không được để trống!'
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO posts (author_id, scholarship_id, title, content, image_url)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [authorId, scholarship_id || null, title, content, image_url || null]
        );

        res.status(201).json({
            success: true,
            message: 'Đăng bài viết thành công!',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi createPost:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

exports.toggleLikePost = async (req, res) => {
    const userId = req.user.id;
    const postId = req.params.id;

    try {
        const existingLike = await pool.query(
            'SELECT * FROM post_likes WHERE post_id = $1 AND user_id = $2',
            [postId, userId]
        );

        if (existingLike.rows.length > 0) {
            // Đã like -> Bỏ like
            await pool.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
            await pool.query('UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1', [postId]);
            return res.status(200).json({ success: true, message: 'Đã bỏ thích bài viết', is_liked: false });
        } else {
            // Chưa like -> Thả like
            await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
            await pool.query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [postId]);
            return res.status(200).json({ success: true, message: 'Đã thích bài viết', is_liked: true });
        }
    } catch (err) {
        console.error('Lỗi toggleLikePost:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

exports.getComments = async (req, res) => {
    const postId = req.params.id;

    try {
        const result = await pool.query(
            `SELECT c.*, u.full_name AS user_name, u.avatar_url AS user_avatar, u.role AS user_role
             FROM comments c
             JOIN users u ON c.user_id = u.id
             WHERE c.post_id = $1
             ORDER BY c.created_at ASC`,
            [postId]
        );

        res.status(200).json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error('Lỗi getComments:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

exports.addComment = async (req, res) => {
    const userId = req.user.id;
    const postId = req.params.id;
    const { content, parent_id } = req.body;

    if (!content) {
        return res.status(400).json({ success: false, message: 'Nội dung bình luận không được rỗng!' });
    }

    try {
        const newComment = await pool.query(
            `INSERT INTO comments (post_id, user_id, parent_id, content)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [postId, userId, parent_id || null, content]
        );

        await pool.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [postId]);

        res.status(201).json({
            success: true,
            message: 'Đã gửi bình luận!',
            data: newComment.rows[0]
        });
    } catch (err) {
        console.error('Lỗi addComment:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};