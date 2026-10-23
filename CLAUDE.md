# MASYS Video Generator

Đặc tả đầy đủ: `SPEC-app-tao-video-ao.md` — đọc trước khi làm bất cứ việc gì. Không mở lại các quyết định ở mục 3 (D1–D11) nếu chưa hỏi người phụ trách.

## Quy tắc làm việc
- Mỗi tính năng là một ticket trong Linear project **MASYS Video Generator** (team Conducdaudan, ticket CON-22 → CON-30). Đọc "Định nghĩa hoàn thành" của ticket trước khi code; cập nhật trạng thái ticket khi bắt đầu / xong.
- Nhánh: dùng đúng `gitBranchName` Linear gợi ý cho ticket (vd `ducbachvu1711/con-23-…`) để Linear tự liên kết PR; mở PR vào `main`.
- **Bí mật:** không bao giờ dán key vào code, commit hay khung chat. `.env` chỉ chứa `op://…`; chạy bằng `op run --env-file=.env -- <lệnh>` hoặc `op inject -i .env -o .env.local`.
- Không có server/Supabase: trạng thái nằm trong SQLite trên máy + cột Trạng thái của sheet (spec §4, D1).
