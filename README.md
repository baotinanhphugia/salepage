# 🇹🇼 Phú Gia Diamond - Sales Page Đài Loan (NT$)

Dự án Landing Page bán hàng chuyên biệt cho Người Việt tại Đài Loan (Thanh toán COD Tân Đài Tệ NT$, nhận hàng tại 7-Eleven / FamilyMart / KTX).

## 📂 Cấu trúc dự án:
- `index.html`: Trang bán hàng chính tại Đài Loan (Bảng giá 4 Chấu 1 Đôi từ NT$ 1.114 - NT$ 2.804, chức năng chụp ảnh Thẻ Cư Trú ARC / Card Xưởng, Popup xác nhận đặt hàng).
- `admin.html`: Bảng điều khiển Admin quản lý cấu hình và danh sách đơn hàng Đài Loan.
- `Code.gs`: Mã nguồn backend Google Apps Script (tự động lưu ảnh Thẻ Cư Trú vào Google Drive và gửi link về Telegram/Sheet).
- `images/`: Toàn bộ hình ảnh sản phẩm, kiểm định GRA, review khách hàng.

## 🚀 Hướng dẫn sử dụng:
1. Mở `index.html` trực tiếp trên trình duyệt hoặc đưa lên hosting / GitHub Pages.
2. Dán mã `Code.gs` vào Google Apps Script và chạy hàm `capQuyenGoogleDriveVaTaoThuMuc` để lưu ảnh Thẻ Cư Trú vào Drive.
