const pool = require("../config/db");

// ======================================================
// CẤU HÌNH
// ======================================================

const ALLOWED_STATUSES = ["pending", "published", "rejected", "archived"];

const ALLOWED_STUDY_LEVELS = [
  "bachelor",
  "master",
  "doctoral",
  "all",
  "other",
  "unknown",
];

// Giới hạn phân trang
function getPagination(query) {
  const rawPage = Number.parseInt(query.page, 10);
  const rawLimit = Number.parseInt(query.limit, 10);

  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

// Chuẩn hóa chuỗi
function normalizeText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const result = String(value).trim();
  return result === "" ? null : result;
}

// Kiểm tra ngày theo định dạng YYYY-MM-DD
function isValidDate(value) {
  if (value === null || value === undefined || value === "") {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

// Chuẩn hóa mảng study_levels
function normalizeStudyLevels(value) {
  if (!Array.isArray(value)) {
    throw new Error("study_levels phải là một mảng.");
  }

  const values = [
    ...new Set(
      value.map((item) => String(item).trim().toLowerCase()).filter(Boolean),
    ),
  ];

  const invalidValues = values.filter(
    (item) => !ALLOWED_STUDY_LEVELS.includes(item),
  );

  if (invalidValues.length > 0) {
    throw new Error(`Bậc học không hợp lệ: ${invalidValues.join(", ")}`);
  }

  if (values.length === 0) {
    throw new Error("Phải chọn ít nhất một bậc học.");
  }

  return values;
}

// Chuẩn hóa mảng majors
function normalizeMajors(value) {
  if (!Array.isArray(value)) {
    throw new Error("majors phải là một mảng.");
  }

  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

// Kiểm tra ID
function isValidId(id) {
  return /^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id)) && Number(id) > 0;
}

// Distinguish missing scholarships (404) from invalid lifecycle transitions (409).
async function statusChangeConflict(id, res, action) {
  const result = await pool.query(
    'SELECT id, status FROM scholarships WHERE id = $1',
    [id],
  );
  if (result.rows.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'Không tìm thấy học bổng.',
    });
  }
  return res.status(409).json({
    success: false,
    message: `Không thể ${action} học bổng ở trạng thái "${result.rows[0].status}".`,
  });
}

// ======================================================
// TẠO ĐIỀU KIỆN LỌC DÙNG CHUNG
// ======================================================

function buildFilters(queryParams, publicOnly = false) {
  const conditions = [];
  const params = [];

  function addCondition(sql, value) {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  }

  // Mobile App chỉ được xem học bổng đã công khai
  if (publicOnly) {
    conditions.push(`status = 'published'`);
  } else if (queryParams.status) {
    const status = String(queryParams.status).trim();

    if (!ALLOWED_STATUSES.includes(status)) {
      throw new Error("Trạng thái học bổng không hợp lệ.");
    }

    addCondition("status = ?", status);
  }

  // Tìm kiếm theo tên học bổng hoặc tổ chức
  const search = normalizeText(queryParams.search);

  if (search) {
    params.push(`%${search}%`);

    conditions.push(
      `(title ILIKE $${params.length}
              OR organization ILIKE $${params.length})`,
    );
  }

  // Lọc theo châu lục
  const continent = normalizeText(queryParams.continent);

  if (continent) {
    addCondition("continent = ?", continent);
  }

  // Lọc theo quốc gia
  const country = normalizeText(queryParams.country);

  if (country) {
    addCondition("country = ?", country);
  }

  // Lọc theo loại học bổng
  const type = normalizeText(queryParams.type);

  if (type) {
    addCondition("type = ?", type);
  }

  // Lọc theo bậc học
  const studyLevel = normalizeText(queryParams.study_level);

  if (studyLevel) {
    if (!ALLOWED_STUDY_LEVELS.includes(studyLevel.toLowerCase())) {
      throw new Error("Bậc học không hợp lệ.");
    }

    addCondition(
      `? = ANY(COALESCE(study_levels, ARRAY[]::TEXT[]))`,
      studyLevel.toLowerCase(),
    );
  }

  // Lọc theo ngành học
  const major = normalizeText(queryParams.major);

  if (major) {
    addCondition(`? = ANY(COALESCE(majors, ARRAY[]::TEXT[]))`, major);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return {
    whereClause,
    params,
  };
}

// Chỉ cho phép các kiểu sắp xếp được định nghĩa sẵn
function getSortQuery(sort) {
  switch (sort) {
    case "deadline_asc":
      return "deadline ASC NULLS LAST, created_at DESC";

    case "deadline_desc":
      return "deadline DESC NULLS LAST, created_at DESC";

    case "created_at_asc":
      return "created_at ASC";

    case "title_asc":
      return "title ASC";

    case "title_desc":
      return "title DESC";

    default:
      return "created_at DESC";
  }
}

// ======================================================
// 1. MOBILE APP - LẤY DANH SÁCH HỌC BỔNG ĐÃ CÔNG KHAI
// GET /api/scholarships
// ======================================================

exports.getScholarships = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);

    const { whereClause, params } = buildFilters(req.query, true);

    const sortQuery = getSortQuery(req.query.sort);

    // Lấy danh sách học bổng
    const dataParams = [...params];

    dataParams.push(limit);
    const limitParam = `$${dataParams.length}`;

    dataParams.push(offset);
    const offsetParam = `$${dataParams.length}`;

    const dataQuery = `
            SELECT *
            FROM scholarships
            ${whereClause}
            ORDER BY ${sortQuery}
            LIMIT ${limitParam}
            OFFSET ${offsetParam}
        `;

    // Đếm tổng số học bổng thỏa điều kiện
    const countQuery = `
            SELECT COUNT(*) AS total
            FROM scholarships
            ${whereClause}
        `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, dataParams),
      pool.query(countQuery, params),
    ]);

    const total = Number(countResult.rows[0].total);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      data: dataResult.rows,
    });
  } catch (err) {
    console.error("Lỗi getScholarships:", err.message);
    if (err.message?.includes("không hợp lệ")) {
      return res.status(400).json({ success: false, message: err.message });
    }

    return res.status(500).json({
      success: false,
      message: "Không thể lấy danh sách học bổng.",
    });
  }
};

// ======================================================
// 2. MOBILE APP - XEM CHI TIẾT HỌC BỔNG ĐÃ CÔNG KHAI
// GET /api/scholarships/:id
// ======================================================

exports.getScholarshipById = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({
      success: false,
      message: "ID học bổng không hợp lệ.",
    });
  }

  try {
    const result = await pool.query(
      `SELECT *
             FROM scholarships
             WHERE id = $1 AND status = 'published'`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy học bổng đã công khai này.",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Lỗi getScholarshipById:", err.message);

    return res.status(500).json({
      success: false,
      message: "Không thể lấy chi tiết học bổng.",
    });
  }
};

// ======================================================
// 3. ADMIN - LẤY DANH SÁCH HỌC BỔNG
// GET /api/admin/scholarships
// ======================================================

exports.getAdminScholarships = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);

    const { whereClause, params } = buildFilters(req.query, false);

    const sortQuery = getSortQuery(req.query.sort);

    const dataParams = [...params];

    dataParams.push(limit);
    const limitParam = `$${dataParams.length}`;

    dataParams.push(offset);
    const offsetParam = `$${dataParams.length}`;

    const dataQuery = `
            SELECT *
            FROM scholarships
            ${whereClause}
            ORDER BY ${sortQuery}
            LIMIT ${limitParam}
            OFFSET ${offsetParam}
        `;

    const countQuery = `
            SELECT COUNT(*) AS total
            FROM scholarships
            ${whereClause}
        `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, dataParams),
      pool.query(countQuery, params),
    ]);

    const total = Number(countResult.rows[0].total);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      data: dataResult.rows,
    });
  } catch (err) {
    console.error("Lỗi getScholarships:", err.message);

    if (err.message.includes("không hợp lệ")) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Không thể lấy danh sách học bổng.",
    });
  }
};

// ======================================================
// 4. ADMIN - XEM CHI TIẾT MỌI HỌC BỔNG
// GET /api/admin/scholarships/:id
// ======================================================

exports.getAdminScholarshipById = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({
      success: false,
      message: "ID học bổng không hợp lệ.",
    });
  }

  try {
    const result = await pool.query(
      `SELECT *
             FROM scholarships
             WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy học bổng.",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Lỗi getAdminScholarshipById:", err.message);

    return res.status(500).json({
      success: false,
      message: "Không thể lấy chi tiết học bổng.",
    });
  }
};

// ======================================================
// 5. ADMIN - TẠO HỌC BỔNG
// POST /api/admin/scholarships
// Mặc định tạo ở trạng thái pending
// ======================================================

exports.createScholarship = async (req, res) => {
  const {
    title,
    organization,
    country,
    continent,
    type,
    deadline,
    description,
    requirements,
    benefits,
    application_link,
    image_url,
    study_levels,
    majors,
    source_url,
    source_name,
  } = req.body;

  if (!normalizeText(title)) {
    return res.status(400).json({
      success: false,
      message: "Tên học bổng không được để trống.",
    });
  }

  if (!isValidDate(deadline)) {
    return res.status(400).json({
      success: false,
      message: "Hạn nộp phải có định dạng YYYY-MM-DD hợp lệ.",
    });
  }

  if (String(title).trim().length > 255) {
    return res.status(400).json({
      success: false,
      message: "Tên học bổng không được vượt quá 255 ký tự.",
    });
  }

  if (organization && String(organization).trim().length > 255) {
    return res.status(400).json({
      success: false,
      message: "Tên tổ chức không được vượt quá 255 ký tự.",
    });
  }

  try {
    const normalizedStudyLevels =
      study_levels === undefined
        ? ["unknown"]
        : normalizeStudyLevels(study_levels);

    const normalizedMajors =
      majors === undefined ? null : normalizeMajors(majors);

    const result = await pool.query(
      `INSERT INTO scholarships (
                title,
                organization,
                country,
                continent,
                type,
                deadline,
                description,
                requirements,
                benefits,
                application_link,
                image_url,
                study_levels,
                majors,
                source_url,
                source_name,
                status,
                created_at,
                updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15,
                'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING *`,
      [
        String(title).trim(),
        normalizeText(organization),
        normalizeText(country),
        normalizeText(continent),
        normalizeText(type),
        deadline || null,
        normalizeText(description),
        normalizeText(requirements),
        normalizeText(benefits),
        normalizeText(application_link),
        normalizeText(image_url),
        normalizedStudyLevels,
        normalizedMajors,
        normalizeText(source_url),
        normalizeText(source_name),
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Tạo học bổng thành công. Học bổng đang chờ duyệt.",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Lỗi createScholarship:", err.message);

    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Học bổng có source_url này đã tồn tại.",
      });
    }

    if (
      err.message.includes("study_levels") ||
      err.message.includes("majors")
    ) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Không thể tạo học bổng.",
    });
  }
};

// ======================================================
// 6. ADMIN - CẬP NHẬT HỌC BỔNG
// PUT /api/admin/scholarships/:id
// ======================================================

exports.updateScholarship = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({
      success: false,
      message: "ID học bổng không hợp lệ.",
    });
  }

  const body = req.body || {};

  // Chỉ cho phép cập nhật các trường này.
  // Không cho cập nhật status, reviewed_by, reviewed_at
  // thông qua API chỉnh sửa thông thường.
  const fieldMap = {
    title: "title",
    organization: "organization",
    country: "country",
    continent: "continent",
    type: "type",
    deadline: "deadline",
    description: "description",
    requirements: "requirements",
    benefits: "benefits",
    application_link: "application_link",
    image_url: "image_url",
    study_levels: "study_levels",
    majors: "majors",
    source_url: "source_url",
    source_name: "source_name",
  };

  const updates = [];
  const params = [];

  try {
    for (const [key, column] of Object.entries(fieldMap)) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) {
        continue;
      }

      let value = body[key];

      if (key === "title") {
        value = normalizeText(value);

        if (!value) {
          return res.status(400).json({
            success: false,
            message: "Tên học bổng không được để trống.",
          });
        }

        if (value.length > 255) {
          return res.status(400).json({
            success: false,
            message: "Tên học bổng không được vượt quá 255 ký tự.",
          });
        }
      } else if (key === "organization") {
        value = normalizeText(value);

        if (value && value.length > 255) {
          return res.status(400).json({
            success: false,
            message: "Tên tổ chức không được vượt quá 255 ký tự.",
          });
        }
      } else if (key === "deadline") {
        if (!isValidDate(value)) {
          return res.status(400).json({
            success: false,
            message: "Hạn nộp phải có định dạng YYYY-MM-DD hợp lệ.",
          });
        }

        value = value || null;
      } else if (key === "study_levels") {
        value = normalizeStudyLevels(value);
      } else if (key === "majors") {
        value = normalizeMajors(value);
      } else {
        value = normalizeText(value);
      }

      params.push(value);
      updates.push(`${column} = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Bạn chưa cung cấp trường cần cập nhật.",
      });
    }

    // Luôn cập nhật thời gian chỉnh sửa
    updates.push("updated_at = CURRENT_TIMESTAMP");

    params.push(id);

    const query = `
            UPDATE scholarships
            SET ${updates.join(", ")}
            WHERE id = $${params.length}
            RETURNING *
        `;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy học bổng.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Cập nhật học bổng thành công.",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Lỗi updateScholarship:", err.message);

    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "source_url này đã được sử dụng bởi học bổng khác.",
      });
    }

    if (
      err.message.includes("study_levels") ||
      err.message.includes("majors")
    ) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Không thể cập nhật học bổng.",
    });
  }
};

// ======================================================
// 7. ADMIN - DUYỆT HỌC BỔNG
// PATCH /api/admin/scholarships/:id/approve
// ======================================================

exports.approveScholarship = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({
      success: false,
      message: "ID học bổng không hợp lệ.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE scholarships
             SET
                status = 'published',
                reviewed_by = $2,
                reviewed_at = CURRENT_TIMESTAMP,
                published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
                rejection_reason = NULL,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'pending'
             RETURNING *`,
      [id, req.user.id],
    );

    if (result.rows.length === 0) {
      return await statusChangeConflict(id, res, "duyệt");
    }

    return res.status(200).json({
      success: true,
      message: "Đã duyệt và công khai học bổng.",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Lỗi approveScholarship:", err.message);

    return res.status(500).json({
      success: false,
      message: "Không thể duyệt học bổng.",
    });
  }
};

// ======================================================
// 8. ADMIN - TỪ CHỐI HỌC BỔNG
// PATCH /api/admin/scholarships/:id/reject
// ======================================================

exports.rejectScholarship = async (req, res) => {
  const { id } = req.params;
  const rejectionReason = normalizeText((req.body || {}).rejection_reason);

  if (!isValidId(id)) {
    return res.status(400).json({
      success: false,
      message: "ID học bổng không hợp lệ.",
    });
  }

  if (!rejectionReason) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng nhập lý do từ chối học bổng.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE scholarships
             SET
                status = 'rejected',
                reviewed_by = $2,
                reviewed_at = CURRENT_TIMESTAMP,
                rejection_reason = $3,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'pending'
             RETURNING *`,
      [id, req.user.id, rejectionReason],
    );

    if (result.rows.length === 0) {
      return await statusChangeConflict(id, res, "từ chối");
    }

    return res.status(200).json({
      success: true,
      message: "Đã từ chối học bổng.",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Lỗi rejectScholarship:", err.message);

    return res.status(500).json({
      success: false,
      message: "Không thể từ chối học bổng.",
    });
  }
};

// ======================================================
// 9. ADMIN - LƯU TRỮ HỌC BỔNG
// PATCH /api/admin/scholarships/:id/archive
// ======================================================

exports.archiveScholarship = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({
      success: false,
      message: "ID học bổng không hợp lệ.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE scholarships
             SET
                status = 'archived',
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'published'
             RETURNING *`,
      [id],
    );

    if (result.rows.length === 0) {
      return await statusChangeConflict(id, res, "lưu trữ");
    }

    return res.status(200).json({
      success: true,
      message: "Đã lưu trữ học bổng.",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Lỗi archiveScholarship:", err.message);

    return res.status(500).json({
      success: false,
      message: "Không thể lưu trữ học bổng.",
    });
  }
};

// ======================================================
// 10. ADMIN - XÓA HỌC BỔNG
// DELETE /api/admin/scholarships/:id
// ======================================================

exports.deleteScholarship = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({
      success: false,
      message: "ID học bổng không hợp lệ.",
    });
  }

  try {
    const result = await pool.query(
      `DELETE FROM scholarships
             WHERE id = $1
             RETURNING id`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy học bổng.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đã xóa học bổng.",
      deletedId: result.rows[0].id,
    });
  } catch (err) {
    console.error("Lỗi deleteScholarship:", err.message);

    // 23503: Vi phạm khóa ngoại
    if (err.code === "23503") {
      return res.status(409).json({
        success: false,
        message:
          "Không thể xóa học bổng vì đang được dữ liệu khác tham chiếu. Hãy sử dụng chức năng lưu trữ.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Không thể xóa học bổng.",
    });
  }
};
