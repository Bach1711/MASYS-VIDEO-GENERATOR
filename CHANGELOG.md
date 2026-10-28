# Ghi chú thay đổi

Mỗi bản phát hành có một mục `## vX.Y.Z`. Nội dung mục được đăng nguyên văn làm ghi chú trên GitHub Releases và hiện trong tool, ở **Cài đặt → Phiên bản**. Viết bằng tiếng Việt, cho người dùng đọc: nói về thay đổi họ thấy được, không nói về code.

## v1.1.0

**Mới: ghép ảnh áo vào ảnh người mẫu rồi tạo video.**

- Sheet có cột **Ảnh áo** (link Drive ảnh thiết kế áo) thì Muse ghép áo vào ảnh người mẫu trước, rồi làm video theo prompt từ ảnh vừa ghép, trong cùng một lượt. Ảnh ghép không lưu, chỉ lưu video như cũ.
- **Kết nối sheet** có thêm ô chọn cột **Ảnh áo** (tuỳ chọn, tool tự nhận tiêu đề "Ảnh áo"). Sheet đã kết nối từ trước: bấm **Sửa** ở tab đó rồi **Lưu ánh xạ** một lần.
- **Quét và chọn dòng** hiện cả ảnh người mẫu và ảnh áo. Link ảnh áo hỏng thì dòng báo *Thiếu dữ liệu*. Ô Ảnh áo để trống thì dòng chạy như cũ.
- **Cài đặt** có khung **Đoạn ghép áo** để sửa câu dặn Muse.
- Nếu bạn đã tự sửa *Mẫu yêu cầu gửi Muse* trước bản này, tool sẽ nhắc thêm chỗ `{doan_ghep_ao}` (hoặc bấm *Khôi phục mẫu gốc*).

## v1.0.2

Sửa lỗi cập nhật trong tool chậm và bị đứng khi mạng chập chờn.

- Tải bản mới **nhanh hơn nhiều**. Tool tải nhiều phần cùng lúc, vì GitHub giới hạn tốc độ của từng kết nối.
- Tải bị đứng 30 giây thì tool tự thử lại, tải tiếp từ chỗ dừng, không tải lại từ đầu. Mạng chậm nhưng vẫn chạy thì tool cứ tải tới xong.
- Nếu vẫn không được, phần đã tải được giữ lại. Bấm **Cập nhật** lần nữa để tải tiếp.
- Trang cập nhật hiện tốc độ tải và báo *"Mạng chập chờn, đang thử lại"* khi bị đứng.
- Mọi câu báo lỗi khi cập nhật đều bằng tiếng Việt.

## v1.0.1

Bản thử cơ chế cập nhật trong tool. Không thay đổi tính năng.

- Dùng để kiểm tra nút **Cập nhật** và **Quay về** trong **Cài đặt → Phiên bản**.

## v1.0.0

Bản đầu tiên cho người trong đội.

- Tải zip, giải nén, bấm đúp `Mo-MASYS.bat` là dùng. Máy chỉ cần Google Chrome.
- Lần đầu mở, chọn file khoá Google `.json`. Tool mã hoá khoá và cất trong máy.
- Quét sheet, chọn dòng, tạo lô. Bot gửi lần lượt từng dòng cho Meta Muse, theo dõi ô Video và kiểm tra lại link.
- **Mới:** tự kiểm tra phiên bản mới. Cập nhật hoặc quay về bản trước bằng một nút trong **Cài đặt → Phiên bản**.
