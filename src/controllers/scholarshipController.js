const pool = require('../config/db');

// 1. LẤY DANH SÁCH HỌC BỔNG (HỖ TRỢ TÌM KIẾM, LỌC THEO CHÂU LỤC, LOẠI, SẮP XẾP HẠN NỘP)
exports.getScholarships = async (req, res) => {
    const { search, continent, type, sort, limit = 10, page = 1 } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM scholarships WHERE 1=1`;
    const params = [];

    // Tìm kiếm theo tên hoặc tổ chức cấp học bổng
    if (search) {
        params.push(`%${search}%`);
        query += ` AND (title ILIKE $${params.length} OR organization ILIKE $${params.length})`;
    }

    // Lọc theo châu lục (Châu Á, Châu Âu, Châu Mỹ...)
    if (continent) {
        params.push(continent);
        query += ` AND continent = $${params.length}`;
    }

    // Lọc theo loại (Toàn phần, Bán phần, Trao đổi)
    if (type) {
        params.push(type);
        query += ` AND type = $${params.length}`;
    }

    // Sắp xếp
    if (sort === 'deadline_asc') {
        query += ` ORDER BY deadline ASC`;
    } else {
        query += ` ORDER BY created_at DESC`;
    }

    // Phân trang
    params.push(parseInt(limit));
    query += ` LIMIT $${params.length}`;
    params.push(parseInt(offset));
    query += ` OFFSET $${params.length}`;

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
        console.error('Lỗi getScholarships:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

// 2. XEM CHI TIẾT HỌC BỔNG
exports.getScholarshipById = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('SELECT * FROM scholarships WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy học bổng này!'
            });
        }

        res.status(200).json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi getScholarshipById:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};

// 3. TẠO MẪU HỌC BỔNG (Dùng để nạp dữ liệu kiểm thử hoặc Web Admin)
exports.createScholarship = async (req, res) => {
    const {
        title, organization, country, continent, type,
        deadline, description, requirements, benefits, application_link, image_url
    } = req.body;

    try {
        const result = await pool.query(
            `INSERT INTO scholarships 
             (title, organization, country, continent, type, deadline, description, requirements, benefits, application_link, image_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [title, organization, country, continent, type, deadline, description, requirements, benefits, application_link, image_url]
        );

        res.status(201).json({
            success: true,
            message: 'Tạo học bổng thành công!',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi createScholarship:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    }
};