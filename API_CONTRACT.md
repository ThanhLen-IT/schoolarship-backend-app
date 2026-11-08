# 📡 SCHOLARSHIP GATEWAY - API CONTRACT (GIAI ĐOẠN 1)

**Base URL**: `http://localhost:5000/api`  
**Deploy URL (VPS)**: `https://api.scholarship.local/api` (Dự kiến do Thành Lên cấu hình Nginx)

---

### 1. Phân hệ Xác thực (Authentication) - `prefix: /auth`

#### `POST /auth/register` (Đăng ký)
* **Headers**: `Content-Type: application/json`
* **Body**:
  ```json
  {
    "email": "student@uit.edu.vn",
    "password": "password123",
    "full_name": "Trần Kim Ngân",
    "university": "ĐH Công nghệ Thông tin"
  }