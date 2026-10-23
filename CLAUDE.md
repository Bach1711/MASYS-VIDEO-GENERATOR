# MASYS Video Generator

Đặc tả đầy đủ: `SPEC-app-tao-video-ao.md` (v2.8) — đọc trước khi làm bất cứ việc gì. Không mở lại các quyết định ở mục 3 (D1–D15) nếu chưa hỏi người phụ trách.

## Cổng Giai đoạn 0 (spec v2.8)
- **Provider chính tạm thời là Gemini API** (Omni Flash). GĐ0 = kiểm chứng Gemini bằng một script Node nhỏ (CON-23). Chưa code hàng đợi/UI/provider app khi GĐ0 (Gemini) chưa đạt.
- Được làm song song với GĐ0: CON-24 (Google/Sheets), CON-25 (Drive), và ticket Meta Muse (chỉ ô key + khung provider, **không** gọi tạo video khi chưa có đường API được duyệt — spec §8.5).
- Max-Studio (CON-31, CON-32) **tạm gác**. Mọi ô "CHỐT Ở GĐ0" ở §8.1 phải điền bằng kết quả thử thật trước khi code `MaxStudioProvider`. Không đoán endpoint/mã lỗi — áp dụng cho cả Gemini (§8.2) và Muse (§8.5).
- GĐ0 không đạt → dừng, cập nhật spec trước khi build tiếp.

## Quy tắc làm việc
- Mỗi tính năng là một ticket trong Linear project **MASYS Video Generator** (team Conducdaudan). Đọc "Định nghĩa hoàn thành" của ticket trước khi code; cập nhật trạng thái ticket khi bắt đầu / xong.
- Nhánh: dùng đúng `gitBranchName` Linear gợi ý cho ticket (vd `ducbachvu1711/con-23-…`) để Linear tự liên kết PR; mở PR vào `main`.
- **Bí mật:** không bao giờ dán key/token vào code, commit hay khung chat. `.env` chỉ chứa `op://…`; chạy bằng `op run --env-file=.env -- <lệnh>` hoặc `op inject -i .env -o .env.local`.
- **Token/cookie Flow** (`FLOW_COOKIE`, API V3) chỉ được gửi tới Max-Studio; không log, không in ra, kể cả khi debug. Log phải che `X-API-Key`, `x-goog-api-key`, `Authorization` và mọi trường token.
- **Không bao giờ tự chuyển nhà cung cấp video** (D12) — kể cả trong script thử. Script/app gọi Gemini không tự gửi lại request khi không chắc đã bị tính tiền hay chưa.
- Tài khoản Flow và tài khoản dữ liệu tách biệt (D7): token Flow không dùng cho Sheets/Drive; OAuth Google luôn là tài khoản dữ liệu.
- Không có server/Supabase: trạng thái nằm trong SQLite trên máy + cột Trạng thái của sheet (spec §4, D1).
