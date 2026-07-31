# PHÚ GIA DIAMOND - COD LANDING + ADMIN V5

## File trong bộ này
- `index.html`: Landing page bán hàng kiểu TikTok Shop COD.
- `admin.html`: Trang admin chỉnh giá, sản phẩm, chuyển khoản, map, form đặt hàng, xem đơn.
- `Code.gs`: Apps Script mới cho Google Sheet + Telegram + Gmail + Admin API.
- `images/`: thư mục ảnh sản phẩm.

## Luồng hoạt động
Khách vào `index.html`
→ đặt hàng
→ Apps Script
→ Google Sheet Orders
→ Telegram + Gmail

Admin vào `admin.html`
→ chỉnh cấu hình
→ lưu vào Google Sheet Config
→ Landing page tự lấy cấu hình mới.

## Cài đặt Apps Script
1. Tạo Google Sheet mới.
2. Vào Extensions → Apps Script.
3. Xóa code cũ, dán toàn bộ `Code.gs`.
4. Save.
5. Deploy → New deployment → Web app.
6. Execute as: Me.
7. Who has access: Anyone.
8. Copy Web App URL.

## Cài đặt Admin
1. Mở `admin.html`.
2. Dán Web App URL.
3. Mật khẩu mặc định lần đầu: `123456`.
4. Bấm "Lưu kết nối".
5. Bấm "Tải cấu hình".
6. Sửa thông tin.
7. Bấm "Lưu toàn bộ cấu hình".

## Đổi mật khẩu Admin
Trong tab "Telegram & Gmail":
- Nhập `Admin Password mới`
- Bấm lưu cấu hình.
Từ lần sau dùng mật khẩu mới.

## Cài đặt Telegram + Gmail
Trong admin:
- Telegram Bot Token
- Telegram Chat ID
- Email nhận đơn
Sau đó bấm lưu.

## Cài đặt Landing
Mở `index.html`, tìm:

const API_URL = "DÁN_LINK_WEB_APP_APPS_SCRIPT_VÀO_ĐÂY";

Dán Web App URL vào.

## Upload GitHub
Cấu trúc:

project/
- index.html
- admin.html
- images/
- Code.gs
- README.txt

Bật GitHub Pages là chạy được.

## Lưu ý
- Các số đã bán, người xem, còn hàng là mô phỏng để tạo hiệu ứng giao diện.
- Khi chạy quảng cáo nên dùng số liệu thật để tránh gây hiểu nhầm.
