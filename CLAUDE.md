# MASYS Video Generator

Đặc tả đầy đủ: `SPEC-app-tao-video-ao.md` (v4.0) — đọc trước khi làm bất cứ việc gì. Không mở lại các quyết định ở mục 3 (D1–D14) nếu chưa hỏi người phụ trách.

## Kiến trúc (spec v4.0)
- **Tool chạy trên một máy Windows:** một tiến trình Node (TypeScript) + giao diện ở `localhost` + **Playwright** điều khiển Chrome + SQLite cục bộ.
- **Meta Muse AI là nơi duy nhất tạo video**, điều khiển qua giao diện web bằng bot. Muse tự lưu video lên Drive và tự ghi link vào sheet qua MCP; tool chỉ điều phối, theo dõi ô Video và kiểm tra lại.
- Google Sheets/Drive truy cập bằng **service account** (D5). Ảnh gửi Muse bằng link Drive (D14). Giới hạn mặc định 5 video/ngày (D13).
- Không có server, không Supabase, không gọi API video nào (Gemini, Max-Studio, Flow đã bỏ).

## Cổng làm việc
- **Chỉ viết code khi người phụ trách đã duyệt**, làm **từng ticket một**, xong một ticket thì dừng chờ duyệt.

## Quy tắc làm việc
- Mỗi tính năng là một ticket trong Linear project **MASYS Video Generator** (team Conducdaudan). Đọc "Định nghĩa hoàn thành" của ticket trước khi code; cập nhật trạng thái ticket khi bắt đầu / xong.
- Nhánh: dùng đúng `gitBranchName` Linear gợi ý cho ticket để Linear tự liên kết PR; mở PR vào `main`.
- **Bí mật:** không bao giờ dán key/token vào code, commit hay khung chat. `.env` chỉ chứa `op://…`; chạy bằng `op run --env-file=.env -- <lệnh>`.
- **Bot Muse:** không bao giờ gõ mật khẩu Meta, không vượt captcha/2FA; người dùng tự đăng nhập trong hồ sơ bot (D6). Hồ sơ bot, SQLite và ảnh chụp màn hình nằm ngoài repo; không log cookie.
- **Không tự gửi lại yêu cầu cho Muse khi không chắc** đã gửi hay chưa (D9). Chạy tuần tự, mỗi dòng một cuộc trò chuyện mới (D7).
- Tool chỉ ghi **đúng một ô Trạng thái** mỗi lần; không sửa ô nào khác trong sheet.
