const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Khởi chạy kết nối Database
require('./config/db');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Khai báo Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const scholarshipRoutes = require('./routes/scholarshipRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/scholarships', scholarshipRoutes);

// Health check
app.get('/', (req, res) => {
    res.json({
        message: 'Scholarship Gateway API is running!',
        status: 'Healthy',
        database: process.env.DB_NAME
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
});