const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Khởi chạy kết nối Database
require("./config/db");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Khai báo Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const scholarshipRoutes = require("./routes/scholarshipRoutes");
const adminCrawlerRoutes = require("./routes/adminCrawlerRoutes");
const adminScholarshipRoutes = require("./routes/adminScholarshipRoutes");
const mentorRoutes = require("./routes/mentorRoutes");
const adminMentorRoutes = require("./routes/adminMentorRoutes");
const postRoutes = require("./routes/postRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/scholarships", scholarshipRoutes);
app.use("/api/admin/crawler", adminCrawlerRoutes);
app.use("/api/admin/scholarships", adminScholarshipRoutes);
app.use("/api/mentors", mentorRoutes);
app.use("/api/admin/mentors", adminMentorRoutes);
app.use("/api/posts", postRoutes);

// Health check
app.get('/', (req, res) => {
    res.json({
        message: 'Scholarship Gateway API is running smoothly!',
        status: 'Healthy',
        version: '1.2.0',
        database: process.env.DB_NAME
    });
});

// Middleware xử lý lỗi tập trung
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err.stack);
    res.status(500).json({
        success: false,
        message: err.message || 'Lỗi máy chủ nội bộ!'
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
});
