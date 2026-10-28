# MASYS Video Generator

Tool trên máy Windows: đọc ảnh người mẫu, ảnh áo và prompt trong Google Sheet, rồi nhờ **Meta Muse AI** tạo video dọc cho từng dòng. Muse tự lưu video lên Google Drive và dán link vào sheet.

## Cài (một lần)

Cần: Windows 10/11, **Google Chrome**, và **file khoá Google `.json`** do người phụ trách gửi riêng.

1. Tải **`MASYS-Video-vX.Y.Z-win64.zip`** ở [GitHub Releases](https://github.com/Bach1711/MASYS-VIDEO-GENERATOR/releases/latest), **giải nén toàn bộ** ra một thư mục (ví dụ `Documents\MASYS-Video`).
2. Bấm đúp **`Mo-MASYS.bat`**. Trình duyệt tự mở tool ở http://localhost:4310.
   - **Đừng đóng cửa sổ đen** khi đang dùng; muốn tắt tool thì đóng nó.
   - Windows hỏi *"Windows protected your PC"* → **More info → Run anyway**.

## Bắt đầu (4 bước, có dấu ✅ ngay trong tool)

1. **Khoá Google**: chọn file `.json` → Lưu khoá.
2. **Dán link Google Sheet** (đã chia sẻ quyền *Người chỉnh sửa* cho email tool hiện ở bước 1) → tool tự tìm cột → **Xác nhận**.
3. **Đăng nhập Muse**: **Mở cửa sổ Muse**, tự đăng nhập Meta trong cửa sổ đó → **Kiểm tra**.
4. **Thư mục Drive lưu video**: dán link thư mục (ví dụ "MASYS Video", có thư mục con "Video") → **Lưu**.

## Dùng hằng ngày: màn hình Bảng

- Bảng là trang tính của bạn: ảnh, prompt, video, trạng thái. Sửa ô bằng **✎**, thêm dòng bằng **+ Thêm dòng**, chép prompt bằng **Dải prompt ▾**; tool ghi thẳng lên sheet.
- Tích dòng (hoặc **☑ Chọn mọi dòng chưa có video**) → **▶ Tạo video**. Mỗi dòng khoảng 3–5 phút; video xong hiện ngay trên Bảng.
- Tool tạm dừng thì Bảng nói lý do và cách làm; làm xong bấm **Tiếp tục**. Tool không bao giờ gửi lại dòng đã gửi.
- Có bản mới: trên đầu trang hiện *"Có bản mới"* → **⚙ Nâng cao → Cài đặt → Phiên bản → Cập nhật**.

## Khi gặp lỗi

Xem **⚙ Nâng cao → Hướng dẫn** trong tool. Vẫn không được thì chụp màn hình trang tool và cửa sổ đen, gửi người phụ trách.

---

Người phụ trách / phát triển: [`HUONG-DAN-CHI-TIET.md`](HUONG-DAN-CHI-TIET.md) (cài máy phát triển, khoá Google, xử lý tạm dừng, cài đặt, selector Muse, phát hành) · đặc tả [`SPEC-app-tao-video-ao.md`](SPEC-app-tao-video-ao.md) · tiến độ [`TIEN-DO.md`](TIEN-DO.md).
