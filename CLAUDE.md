# MASYS Video Generator

Đặc tả đầy đủ: `SPEC-app-tao-video-ao.md` (v5.0) — đọc trước khi làm bất cứ việc gì. Không mở lại các quyết định ở mục 3 (D1–D20) nếu chưa hỏi người phụ trách.

## Kiến trúc (spec v5.0)
- **Tool chạy trên một máy Windows:** một tiến trình Node (TypeScript) + giao diện ở `localhost` + **Playwright** điều khiển Chrome + SQLite cục bộ.
- **Meta Muse AI là nơi duy nhất tạo video**, điều khiển qua giao diện web bằng bot. Muse tự lưu video lên Drive và tự ghi link vào sheet qua MCP; tool chỉ điều phối, theo dõi ô Video và kiểm tra lại.
- Google Sheets/Drive truy cập bằng **service account** (D5). Ảnh gửi Muse bằng link Drive (D14). Giới hạn mặc định 5 video/ngày (D13).
- Không có server, không Supabase, không gọi API video nào (Gemini, Max-Studio, Flow đã bỏ).
- **Phát hành cho đội bằng zip** (D15): `npm run package` → `release/MASYS-Video-vX.Y.Z-win64.zip` (Node đi kèm + `Mo-MASYS.bat`). Máy người dùng chọn file khoá lần đầu, khoá lưu mã hoá DPAPI ở `%LOCALAPPDATA%\masys-video`; biến `GOOGLE_SERVICE_ACCOUNT_JSON` (op run) luôn được ưu tiên. Số phiên bản là `version` trong `package.json`.
- **Cập nhật trong tool** (D16): máy người dùng tải bản mới từ GitHub Releases của repo này (công khai), chỉ khi bấm nút. Zip có `phien-ban\X.Y.Z` + `hien-tai.txt`; `Mo-MASYS.bat` chạy bản ghi trong đó, mã thoát 76 = đổi bản, bản mới không lên thì tự quay về.

## Quy trình phát hành (D16)
- Ticket nào đổi gì trong tool thì **trong chính PR đó**: nâng `version` trong `package.json` (sửa lỗi `x.y.Z`, tính năng `x.Y.0`) và viết mục `## vX.Y.Z` trong `CHANGELOG.md` bằng tiếng Việt cho người dùng đọc.
- Sau khi người phụ trách nói "gộp" và PR đã gộp: `git checkout main && git pull` rồi `npm run release`. Báo link bản phát hành cho người phụ trách.
- Migration SQLite **chỉ được thêm** bảng/cột, không xoá hay đổi tên, để bản cũ vẫn mở được dữ liệu khi người dùng bấm Quay về.

## Cổng làm việc
- **Chỉ viết code khi người phụ trách đã duyệt**, làm **từng ticket một**, xong một ticket thì dừng chờ duyệt.

## Quy tắc làm việc
- Mỗi tính năng là một ticket trong Linear project **MASYS Video Generator** (team Conducdaudan). Đọc "Định nghĩa hoàn thành" của ticket trước khi code; cập nhật trạng thái ticket khi bắt đầu / xong.
- Nhánh: dùng đúng `gitBranchName` Linear gợi ý cho ticket để Linear tự liên kết PR; mở PR vào `main`.
- **Bí mật:** không bao giờ dán key/token vào code, commit hay khung chat. `.env` chỉ chứa `op://…`; chạy bằng `op run --env-file=.env -- <lệnh>`.
- **Bot Muse:** không bao giờ gõ mật khẩu Meta, không vượt captcha/2FA; người dùng tự đăng nhập trong hồ sơ bot (D6). Hồ sơ bot, SQLite và ảnh chụp màn hình nằm ngoài repo; không log cookie.
- **Không tự gửi lại yêu cầu cho Muse khi không chắc** đã gửi hay chưa (D9). Chạy tuần tự, mỗi dòng một cuộc trò chuyện mới (D7).
- Tool chỉ ghi **đúng một ô Trạng thái** mỗi lần; không sửa ô nào khác trong sheet.
