const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Khởi chạy kết nối Database PostgreSQL
require('./config/db');

const app = express();

// Middlewares xử lý request
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cung cấp quyền truy cập file tĩnh cho các file upload (PDF minh chứng, ảnh avatar)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// --- IMPORT CÁC ROUTERS ---
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const scholarshipRoutes = require('./routes/scholarshipRoutes');
const postRoutes = require('./routes/postRoutes');
const mentorRoutes = require('./routes/mentorRoutes');

// Kiểm tra nhanh type của các route để tránh crash server
console.log('--- KIỂM TRA ROUTE MODULES ---');
console.log('authRoutes:', typeof authRoutes);
console.log('userRoutes:', typeof userRoutes);
console.log('scholarshipRoutes:', typeof scholarshipRoutes);
console.log('postRoutes:', typeof postRoutes);
console.log('mentorRoutes:', typeof mentorRoutes);
console.log('------------------------------');

// --- ĐĂNG KÝ CÁC ROUTES DỰ ÁN ---
if (typeof authRoutes === 'function') app.use('/api/auth', authRoutes);
if (typeof userRoutes === 'function') app.use('/api/users', userRoutes);
if (typeof scholarshipRoutes === 'function') app.use('/api/scholarships', scholarshipRoutes);
if (typeof postRoutes === 'function') app.use('/api/posts', postRoutes);
if (typeof mentorRoutes === 'function') app.use('/api/mentors', mentorRoutes);

// Health check endpoint
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