# Theo dõi request và hoạt động người dùng

Backend ghi **một dòng JSON cho mỗi request khi phản hồi hoàn tất**. Request bị
ngắt kết nối được ghi với `outcome: "aborted"`. Log đi thẳng ra stdout, nên service
`scholarship-api.service` có thể xem theo thời gian thực bằng `journalctl`.
Không cần thêm package, sửa `.env` hay chạy migration database.

## Áp dụng trên EC2

Trong thư mục backend đang dùng làm `WorkingDirectory` của service:

```bash
cd ~/apps/schoolarship-backend-app
git fetch origin
git switch feat/user-activity-logging
sudo systemctl restart scholarship-api.service
sudo systemctl status scholarship-api.service --no-pager
sudo journalctl -u scholarship-api.service -n 50 -f -o cat
```

`git switch` sẽ lấy nhánh cùng tên từ `origin` nếu chưa có nhánh local. Nếu Git
báo có thay đổi local xung đột, giữ nguyên các thay đổi đó để xử lý trước khi
chuyển nhánh. Không cần reset/xóa file cấu hình trên server.

Mở app hoặc Postman và thao tác; log mới xuất hiện sau mỗi phản hồi. `Ctrl+C`
chỉ dừng xem log, không dừng backend.

Xem lịch sử trong 30 phút gần nhất:

```bash
sudo journalctl -u scholarship-api.service --since "30 minutes ago" -o cat
```

Lọc hoạt động theo user ID hoặc cảnh báo/lỗi:

```bash
sudo journalctl -u scholarship-api.service -f -o cat | grep --line-buffered '"user_id":23[,}]'
sudo journalctl -u scholarship-api.service -f -o cat | grep --line-buffered -E '"level":"(warn|error)"'
```

## Đọc một dòng log

Ví dụ minh họa người dùng lưu học bổng:

```json
{"timestamp":"2026-11-11T16:00:00.000Z","level":"info","event":"http.request","request_id":"e61fb8a4-f5f2-4b13-a8b5-530e24fa84e2","method":"POST","route":"/api/users/saved/:scholarshipId","action":"scholarship.save","user_id":23,"user_role":"user","status":200,"outcome":"success","duration_ms":12.5,"target_id":73}
```

| Trường | Ý nghĩa |
| --- | --- |
| `timestamp` | Thời điểm ghi log theo UTC (`Z`); Việt Nam là UTC+7 |
| `request_id` | UUID do server tạo; cũng có trong header `X-Request-Id` của phản hồi |
| `method`, `route` | Phương thức và mẫu route, không chứa query string hay ID thô |
| `action` | Tên thao tác, ví dụ `auth.login`, `user.profile.update`, `scholarship.save`, `scholarship.unsave`, `mentor.verification.submit`, `community.post.create` |
| `user_id`, `user_role` | Tài khoản do middleware xác thực, hoặc do đăng nhập/đăng ký thành công xác nhận |
| `target_id` | ID số của đối tượng trong đường dẫn; với một số phản hồi thành công, là ID đối tượng server trả về |
| `scholarship_id`, `mentor_id`, `application_id` | ID liên quan nếu request có cung cấp ID số hợp lệ; đây là đối tượng request nhắm tới, không phải danh tính người gọi |
| `status` | Mã HTTP; `null` khi kết nối bị ngắt trước khi hoàn tất |
| `outcome` | `success`, `rejected` (bị từ chối), `error` (lỗi server), `aborted` (ngắt kết nối) |
| `duration_ms` | Thời gian xử lý đến khi hoàn tất/ngắt kết nối |
| `filter_keys` | Tên bộ lọc đã gửi, không ghi giá trị tìm kiếm/lọc |
| `error_type`, `error_code` | Loại lỗi và một số mã lỗi hệ thống đã cho phép, không ghi nguyên lỗi/stack |

`success` phản ánh kết quả **phản hồi API**: HTTP 2xx/3xx và JSON không có
`success: false`. Nó không có nghĩa người dùng đã đọc phản hồi, email đã tới
hộp thư hay tác vụ nền đã chạy xong. `aborted` cũng không có nghĩa database đã
rollback; request có thể đã ghi dữ liệu trước khi mất kết nối.

## Tìm lỗi gửi email đặt lại mật khẩu

API quên mật khẩu vẫn trả thông báo chung để không tiết lộ email có tồn tại hay
không. Nếu dịch vụ gửi email từ chối, cùng dòng request sẽ có:

```json
{"level":"warn","action":"auth.password_reset.request","status":200,"outcome":"success","error_type":"AxiosError","error_code":"ERR_BAD_REQUEST","error_stage":"password_reset_email","upstream_status":403}
```

Đây là phần trường liên quan trong log, không phải một dòng sự kiện riêng.
`upstream_status` là mã HTTP dịch vụ bên ngoài trả về nếu có. Không ghi API key,
địa chỉ email, liên kết reset, token hay nội dung email.

## Phạm vi và dữ liệu riêng tư

- Request công khai như tìm kiếm học bổng chưa đi qua xác thực có `user_id: null`,
  kể cả khi người dùng đang đăng nhập ở frontend. Logger không tin `user_id` do
  client tự gửi và không tự decode JWT để đoán danh tính.
- Request bị từ chối trước khi match route vẫn được ghi. URL không xác định
  được ghi là `[unmatched]`, không sao chép URL thô có thể chứa thông tin bí mật.
- Không ghi request/response body, header Authorization/Cookie, mật khẩu, JWT,
  token reset, email, hồ sơ cá nhân, tên/nội dung PDF hay query values.
- Log hoạt động chỉ phản ánh các request tới backend. Bấm menu, thao tác offline
  hoặc đăng xuất bằng cách xóa token trên điện thoại không tạo request nên
  không có log server tương ứng.
- Đây là log trong journal của server, không phải bảng lịch sử hoạt động trong
  database. Thời gian lưu và khả năng giữ log qua reboot do cấu hình journald
  trên EC2 quyết định. Log khởi động/database/crawler có sẵn có thể vẫn là chữ
  thường; các log request mới là JSON.
- Khi thêm API, bổ sung tên thao tác trong `src/utils/activityRoutes.js`.
  Route chưa khai báo vẫn được ghi request nhưng dùng tên chung `http.request`.

## Kiểm tra

```bash
npm test
```

Các kiểm tra logging chạy Express và HTTP thực trên cổng local với handler mẫu,
không truy cập database hay gửi email thật. Chúng kiểm tra danh tính, che dữ liệu
nhạy cảm, phản hồi thành công/thất bại, JSON sai, CORS, ngắt kết nối, lỗi gửi email
và việc lỗi bộ ghi log không làm hỏng phản hồi API.

Đã chạy: 43 tests đạt (16 tests logging mới), đối chiếu tên hoạt động cho 52 API
đang mount và khởi động app thực để kiểm tra 4 request HTTP local. Kiểm tra app
dùng database local cố ý không khả dụng để kiểm chứng log lỗi kết nối; không
truy cập database thật. Chưa triển khai thay đổi lên EC2 hoặc gửi email thật.
