# Dataset kiểm thử Global Success

`npm run seed:demo` tạo dữ liệu giả lập theo schema Database-v1.0 và các migration
hiện có. Không gọi crawler, gửi email hoặc thanh toán. Dùng database riêng
kết thúc bằng `_demo` hoặc `_test`, với `NODE_ENV` khác `production`.

## Dữ liệu có sẵn

| Nhóm | Số lượng / trường hợp |
| --- | --- |
| Tài khoản | 48: 1 admin, 4 mentor đã duyệt, 2 ứng viên mentor, 40 người dùng, 1 tài khoản vô hiệu hóa |
| Học bổng | 60: 30 published, 18 pending, 6 rejected, 6 archived |
| Bộ lọc | 10 quốc gia, 6 châu lục; full/partial/exchange; bachelor/master/doctoral/all/other/unknown và nhiều bậc học |
| Deadline / nội dung | Còn hạn, sắp hết hạn, đã hết hạn, chưa có deadline; mô tả ngắn/dài; HTML có danh sách/bảng; thông tin tùy chọn để trống |
| Xét duyệt mentor | 6 hồ sơ approved/pending/rejected |
| Mentoring | 48 hồ sơ pending/accepted/in_progress/completed/rejected/cancelled |
| Ranking | 30 đánh giá, 30 yêu cầu hỗ trợ/phản hồi; 3 mentor đủ mẫu trên cùng học bổng |
| CV | 16 PDF hợp lệ chứa nội dung giả lập, lưu riêng trong uploads; truy cập qua API CV có xác thực |
| Cộng đồng | 18 bài viết, 36 bình luận, 36 lượt thích; bộ đếm khớp bản ghi thực tế |
| Đã lưu | 80 lượt lưu học bổng |
| Chat | 6 cuộc trò chuyện, 24 tin nhắn; có tin đọc/chưa đọc |
| Thông báo | 54, gồm thông báo do trigger mentoring tạo và tin nhắn mẫu |
| Support | 40 yêu cầu open/resolved, có phản hồi mẫu |
| Giao dịch | 12 bản ghi giả lập; phương thức demo_only, không có tiền thật |
| Lịch sử crawler | 12 lần chạy giả lập completed/completed_with_errors/failed/running |
| Sự kiện app | 249 sự kiện trong 30 ngày, chỉ gắn với người dùng đã đăng nhập |

Tên có `[DEMO]`, email dùng miền `.invalid`, source URL bắt đầu
`https://demo.global-success.invalid/v1`. Các thông báo học bổng, tổ chức, kết quả,
giao dịch và địa chỉ liên kết đều giả lập. Link nguồn/ứng tuyển/minh chứng mentor
không trỏ tới dịch vụ thật. Ảnh để trống để kiểm thử giao diện ảnh mặc định.
Dataset không bổ sung các API còn thiếu (ví dụ báo cáo app_events); nó cung cấp
bản ghi để test những API và màn hình thực sự đã được triển khai.

## Chuẩn bị database demo một lần

Pull nhánh `feat/mobile-completion` của backend. Nếu database demo đã có đủ schema
và migration thì chuyển thẳng sang bước nạp dữ liệu.

Tạo database `scholarship_demo` trong pgAdmin, đặt owner là DB_USER đang dùng trong
`.env`. Hoặc trên EC2, thay `YOUR_DB_USER` bằng tên DB_USER thực tế rồi chạy:

```bash
sudo -u postgres createdb --owner=YOUR_DB_USER scholarship_demo
```

Nạp schema vào **database demo rỗng** (file schema-only không chứa dữ liệu cá nhân):

```bash
cd ~/apps/schoolarship-backend-app
psql -h localhost -U YOUR_DB_USER -W -d scholarship_demo -f tests/fixtures/database-v1-schema.sql
DB_NAME=scholarship_demo NODE_ENV=development npm run migrate:mobile
```

Lệnh psql yêu cầu mật khẩu PostgreSQL của DB_USER. Bản schema này lấy từ
PostgreSQL 18; dùng PostgreSQL 18 như môi trường dự án. Không import schema lại
vào database đã có bảng. Cấu hình DB_HOST/DB_PORT/DB_USER/DB_PASSWORD vẫn lấy từ
`.env`; chỉ DB_NAME trong những lệnh trên được đổi sang database demo.

## Nạp dữ liệu

Trong Bash/EC2, nhập mật khẩu chung cho các tài khoản demo bằng prompt để tránh
ghi mật khẩu trực tiếp vào lịch sử lệnh:

```bash
read -rsp 'Mat khau demo (12-72 byte): ' DEMO_PASSWORD
printf '\n'
export DEMO_PASSWORD
DB_NAME=scholarship_demo NODE_ENV=development npm run seed:demo -- --dry-run
DB_NAME=scholarship_demo NODE_ENV=development npm run seed:demo -- --apply
unset DEMO_PASSWORD
```

Mặc định là dry run: thực thi các INSERT, kiểm tra khóa ngoại/constraint, in số
lượng rồi rollback bảng và xóa PDF vừa tạo. `--apply` mới lưu dữ liệu.
Sequence của PostgreSQL có thể tăng trong dry run; không giả định ID cố định.
Migration mới mở rộng cột trạng thái crawler từ 20 lên 32 ký tự vì trạng thái
`completed_with_errors` dài 21 ký tự; không sửa nội dung bản ghi hiện có.
Chạy lại sau khi đã apply sẽ báo đã có dataset và giữ nguyên các chỉnh sửa bạn
đã làm trên giao diện, không nhân đôi bản ghi. Không có TRUNCATE, reset sequence,
xóa dữ liệu cũ hay đổi mật khẩu tài khoản đang tồn tại. Lỗi trong transaction sẽ
hoàn tác các bản ghi và xóa PDF của lần chạy đó. Nếu bạn đã xóa một phần dataset,
hãy dùng database demo mới để dựng lại kịch bản ban đầu.

Ngày mặc định tính theo ngày chạy, để deadline không bị cũ. Có thể đặt
`DEMO_DATE=2026-11-11` để tái lập cùng mốc ngày; không dùng mốc cũ khi test bộ lọc
còn hạn hôm nay. Cần giữ thư mục uploads cùng với database demo để tải CV.

## Đăng nhập và các kịch bản kiểm tra

- Admin: `admin@global-success.demo.invalid`.
- Mentor: `mentor01@global-success.demo.invalid` đến `mentor04@global-success.demo.invalid`.
- Ứng viên mentor chờ duyệt/bị từ chối: mentor05/mentor06 cùng miền.
- Người dùng: `student01@global-success.demo.invalid` đến `student40@global-success.demo.invalid`.
- Không cho đăng nhập: `inactive@global-success.demo.invalid`.
- Tất cả dùng mật khẩu bạn vừa nhập, được lưu bằng bcrypt; script không in mật khẩu.

Chạy backend test bằng cùng cấu hình nhưng DB_NAME=scholarship_demo và cổng khác,
chẳng hạn 5001, rồi trỏ webadmin/app bản test tới backend đó. Không đổi service
production sang database demo. Ví dụ khi chạy thủ công trên EC2:

```bash
DB_NAME=scholarship_demo NODE_ENV=development PORT=5001 npm start
```

Với webadmin đang chạy HTTPS, cấu hình proxy HTTPS cho API test hoặc dùng frontend
local với backend test local qua SSH tunnel; trình duyệt không cho gọi API HTTP
từ một trang HTTPS. Không cần mở PostgreSQL ra Internet.

1. Admin xem đủ 4 trạng thái học bổng, phân trang, tìm kiếm và sửa nội dung HTML;
   duyệt/từ chối hồ sơ pending rồi kiểm tra app chỉ thấy học bổng published.
2. Kiểm tra bộ lọc quốc gia/loại/bậc học/deadline, trường trống và mô tả dài.
3. Xem hồ sơ mentor và ranking: `scholarshipId` được in sau khi seed. Trên học
   bổng này, mentor01/02/03 lần lượt đạt 86.83 / 81.33 / 75.83 trước khi sửa dữ liệu.
4. Đăng nhập student01 và mentor01 để xem chat/mentoring; student11 có hồ sơ
   pending, student12 accepted, student13/14 in_progress, student15 rejected,
   student16 cancelled. Student01-10 có hồ sơ completed và kết quả đã xác nhận.
5. Tải CV bằng API có xác thực; thử bằng người không thuộc hồ sơ phải bị chặn.
6. Kiểm tra like/comment/bookmark, thông báo đọc/chưa đọc và trả lời support.
7. Kiểm tra quyền: tài khoản student không truy cập được API admin; tài khoản
   inactive không đăng nhập được. Dùng tài khoản email thật riêng để thử gửi mail,
   không dùng email `.invalid` của dataset.
