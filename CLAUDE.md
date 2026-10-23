# MASYS Video Generator

Đặc tả đầy đủ: `SPEC-app-tao-video-ao.md` (v2.3) — đọc trước khi làm bất cứ việc gì. Không mở lại các quyết định ở mục 3 (D1–D13) nếu chưa hỏi người phụ trách.

## Cổng Giai đoạn 0
- **Chưa viết app** (Electron, hàng đợi, UI…) khi ticket Giai đoạn 0 (kiểm chứng Max-Studio) chưa Done. GĐ0 chỉ là một script Node nhỏ.
- Mọi ô "CHỐT Ở GĐ0" trong spec §8.1 phải được điền bằng kết quả thử thật trước khi code `MaxStudioProvider`. Không đoán endpoint/mã lỗi.
- GĐ0 không đạt → dừng, cập nhật spec theo §13.4 trước khi build tiếp.

## Quy tắc làm việc
- Mỗi tính năng là một ticket trong Linear project **MASYS Video Generator** (team Conducdaudan). Đọc "Định nghĩa hoàn thành" của ticket trước khi code; cập nhật trạng thái ticket khi bắt đầu / xong.
- Nhánh: dùng đúng `gitBranchName` Linear gợi ý cho ticket (vd `ducbachvu1711/con-23-…`) để Linear tự liên kết PR; mở PR vào `main`.
- **Bí mật:** không bao giờ dán key/token vào code, commit hay khung chat. `.env` chỉ chứa `op://…`; chạy bằng `op run --env-file=.env -- <lệnh>` hoặc `op inject -i .env -o .env.local`.
- **Token Flow** chỉ được gửi tới Max-Studio; không log, không in ra, kể cả khi debug. Log phải che `X-API-Key`, `x-goog-api-key`, `Authorization` và mọi trường token.
- **Không bao giờ tự bật dự phòng Gemini** (D12) — kể cả trong script thử.
- Tài khoản Flow và tài khoản dữ liệu tách biệt (D7): token Flow không dùng cho Sheets/Drive; OAuth Google luôn là tài khoản dữ liệu.
- Không có server/Supabase: trạng thái nằm trong SQLite trên máy + cột Trạng thái của sheet (spec §4, D1).
