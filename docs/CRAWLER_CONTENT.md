# Nội dung chi tiết học bổng từ YBOX

YBOX đặt nội dung bài viết trong `#post-content`. Khối `.content-wrapper` bao
gồm cả hồ sơ người đăng, thông tin theo dõi, quảng cáo, nút tương tác và gợi ý
bài viết. Crawler chỉ lấy `#post-content`, đợi thẻ này xuất hiện sau khi mở trang,
rồi sanitize HTML trước khi lưu vào `content_html`.

Nếu không lấy được bài viết, crawler ghi nhận lỗi cho mục đó và không tạo học
bổng có nội dung trống. Kết quả có mục lỗi dùng `completed_with_errors`. Không
lấy toàn bộ trang làm nội dung dự phòng. HTML giữ cấu trúc đoạn văn, tiêu đề,
danh sách, bảng và liên kết; không giữ script hoặc thuộc tính thực thi.

## Sửa nội dung đã crawl bằng selector cũ

Chỉ đổi selector rồi chạy lại crawler không sửa các bản ghi đã có: crawler
chủ động bỏ qua `source_url` trùng. Dùng lệnh riêng theo ID học bổng cần sửa.
Lệnh sử dụng bản HTML gốc đã lưu trong database, không truy cập lại YBOX.

Sau khi pull `feat/mobile-completion` trên EC2:

```bash
cd ~/apps/schoolarship-backend-app
npm run backup:db
npm run repair:ybox-content -- --id=123 --dry-run
```

Thay `123` bằng ID thực tế. Kiểm tra `Database đích`, ID, tiêu đề và kết quả:

- `repairable`: HTML hiện tại còn đúng bản crawler đã tạo; có thể thay bằng
  phần bài viết được trích lại từ HTML gốc.
- `unchanged`: nội dung đã là phần bài viết sạch.
- `skipped`: nguồn không phải YBOX, thiếu phần bài viết trong HTML gốc, hoặc
  nội dung đã được admin chỉnh riêng. Lệnh giữ nguyên bản ghi; kiểm tra và chỉnh
  trên webadmin nếu cần. Không ghi đè nội dung do admin biên tập.

Nếu `repairable`, lưu bản sửa rồi restart dịch vụ để nhận code crawler mới:

```bash
npm run repair:ybox-content -- --id=123 --apply
sudo systemctl restart scholarship-api.service
```

Lệnh mặc định chỉ dry run. Khi apply, chỉ cập nhật `content_html` và
`updated_at`; giữ HTML gốc, ID, tiêu đề, liên kết ứng tuyển, bậc học, trạng thái
duyệt và các quan hệ. Ghi và kiểm tra được thực hiện trong transaction, khóa
bản ghi trong lúc xử lý, lỗi sẽ rollback. Chạy lại bản sửa đã áp dụng sẽ không
thay đổi nội dung thêm lần nữa.

Mở lại màn hình chi tiết trong app để gọi API mới. Không cần xóa database,
crawl trùng bài hay cài lại app để cập nhật phần nội dung này.
