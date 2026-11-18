# Dataset kiểm thử Global Success

`npm run seed:demo` tạo dữ liệu giả lập theo schema Database-v1.0 và các migration
hiện có. Không gọi crawler, gửi email hoặc thanh toán. Mặc định dùng database
kết thúc bằng `_demo` hoặc `_test`, với `NODE_ENV` khác `production`. Nếu chủ động
test trên database hiện tại của EC2, dùng `--allow-current-db` như hướng dẫn dưới.
Tùy chọn này cũng cho phép chạy khi `.env` có `NODE_ENV=production`; không cần
đổi môi trường hay tên database để vượt kiểm tra.

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

## Nạp vào database hiện tại trên EC2

Cách này dùng nguyên DB_NAME trong `.env`, service `scholarship-api.service`,
cổng 5000 và URL `https://scholarship-uit.duckdns.org/api`. Không cần database mới,
backend cổng 5001 hoặc SSH tunnel. Tất cả app/webadmin cùng API sẽ thấy dữ liệu mẫu,
và số liệu thống kê cũng bao gồm dữ liệu mẫu. Các tài khoản demo có thể đăng nhập
qua API này, nên chọn mật khẩu demo riêng đủ mạnh và chỉ chia sẻ cho nhóm test.

1. Cập nhật code trong thư mục backend:

   ```bash
   cd ~/apps/schoolarship-backend-app
   git fetch origin
   git switch feat/mobile-completion
   git pull --ff-only origin feat/mobile-completion
   npm ci --omit=dev
   ```

   Dừng nếu một lệnh báo lỗi, không chạy tiếp. Không ghi đè thay đổi Git cục bộ.

2. Sao lưu database hiện tại, sau đó cập nhật migration:

   ```bash
   npm run backup:db
   npm run migrate:mobile
   ```

   Backup cần `pg_dump` cùng phiên bản chính với PostgreSQL server (hoặc bản mới
   hơn tương thích); nếu backup thất bại thì xử lý trước khi tiếp tục. Script lấy
   kết nối từ `.env`, không in mật khẩu, lưu bản `.dump` riêng với quyền 600 tại
   `~/backups/global-success/` và in đường dẫn. Giữ thêm thư mục uploads/media khi
   cần khôi phục cả tệp. Không import lại schema lên database đã có bảng.
   Migration có bước chuẩn hóa bậc học tiếng Việt sang mã canonical; không xóa
   tài khoản hay học bổng.

3. Tạo admin riêng bằng email bạn chọn (khác email admin của dataset):

   ```bash
   read -rp 'Email admin: ' ADMIN_EMAIL
   read -rsp 'Mat khau admin (12-72 byte): ' ADMIN_PASSWORD
   printf '\n'
   export ADMIN_EMAIL ADMIN_PASSWORD
   npm run create:admin
   unset ADMIN_EMAIL ADMIN_PASSWORD
   ```

   Không cần đặt các biến ADMIN_* vào `.env`. Tên mặc định là Global Success
   Admin; có thể truyền ADMIN_NAME qua biến môi trường nếu muốn đổi tên.
   Email mới tạo tài khoản role=admin, active và mật khẩu bcrypt. Nếu đã có
   admin active cùng email, script giữ nguyên mật khẩu; nếu email thuộc user khác
   hoặc tài khoản bị khóa, script dừng, không nâng quyền hay đổi mật khẩu.

4. Nhập mật khẩu chung của các tài khoản mẫu, chạy thử rồi nạp:

   ```bash
   read -rsp 'Mat khau demo rieng (12-72 byte): ' DEMO_PASSWORD
   printf '\n'
   export DEMO_PASSWORD
   npm run seed:demo -- --allow-current-db --dry-run
   ```

   Kiểm tra dòng `Database đích` đúng database hiện tại và dry run thành công.
   Sau đó mới lưu dataset:

   ```bash
   npm run seed:demo -- --allow-current-db --apply
   unset DEMO_PASSWORD
   sudo systemctl restart scholarship-api.service
   ```

   Mật khẩu admin riêng và mật khẩu demo có thể khác nhau. Seed chỉ thêm dữ liệu,
   không xóa hay ghi đè tài khoản/học bổng cũ. Nếu trùng email/username hoặc lỗi
   constraint, transaction hoàn tác bản ghi và dọn PDF của lần chạy đó. Chạy lại
   sau khi đã nạp giữ nguyên dataset, kể cả mật khẩu và các chỉnh sửa trên UI.
   Dry run có thể làm tăng sequence ID dù bản ghi được rollback.

5. Webadmin Windows dùng `.env.local`:

   ```env
   VITE_API_BASE_URL=https://scholarship-uit.duckdns.org/api
   ```

   Khởi động lại Vite nếu vừa đổi cấu hình. Đăng xuất rồi đăng nhập bằng admin
   riêng đã tạo ở bước 3; cũng có thể dùng `admin@global-success.demo.invalid`
   với mật khẩu demo. Hai máy khác mạng cùng gọi API trên sẽ cùng thấy dataset.
   Email `.invalid` không nhận được thư; thử quên mật khẩu bằng tài khoản có email
   thật. Không chạy TRUNCATE hoặc xóa toàn bộ DB để dọn thử nghiệm khi vẫn còn dữ
   liệu cần giữ; bản sao lưu ở bước 2 dùng cho việc khôi phục khi cần.

## Phương án khác: chuẩn bị database demo riêng một lần

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
