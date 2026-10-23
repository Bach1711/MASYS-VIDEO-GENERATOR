# MASYS Video Generator

Đặc tả đầy đủ: `SPEC-app-tao-video-ao.md` (v3.0, **bản web**) — đọc trước khi làm bất cứ việc gì. Không mở lại các quyết định ở mục 3 (D1–D16) nếu chưa hỏi người phụ trách.

## Kiến trúc (spec v3.0)
- Web app có server: **Next.js** (giao diện + API route, Vercel) + **Supabase Postgres** + **worker Node** chạy nền (có ffmpeg). Không có app Electron.
- Không đăng nhập; một **mã truy cập chung** (D9, chờ xác nhận). Một workspace duy nhất.
- Trình duyệt không chạy job và không bao giờ nhận key/cookie/token; mọi lệnh gọi provider và Google nằm ở server.

## Cổng làm việc
- **Chỉ viết code khi người phụ trách đã duyệt**, làm **từng ticket một**, xong một ticket thì dừng chờ duyệt.
- Provider chính tạm thời là **Gemini API** (Omni Flash). GĐ0 = script Node kiểm chứng Gemini; người phụ trách cho phép code trước, thử sau — phần gọi Gemini viết theo tài liệu §8.2, không đoán thêm trường.
- Meta Muse: chỉ ô key + khung provider, **không** gọi tạo video khi chưa có đường API được duyệt (§8.5).
- Max-Studio **tạm gác**. Không code `MaxStudioProvider` khi chưa qua lại GĐ0 Max-Studio.

## Quy tắc làm việc
- Mỗi tính năng là một ticket trong Linear project **MASYS Video Generator** (team Conducdaudan). Đọc "Định nghĩa hoàn thành" của ticket trước khi code; cập nhật trạng thái ticket khi bắt đầu / xong.
- Nhánh: dùng đúng `gitBranchName` Linear gợi ý cho ticket để Linear tự liên kết PR; mở PR vào `main`.
- **Bí mật:** không bao giờ dán key/token vào code, commit hay khung chat. `.env` chỉ chứa `op://…`; chạy bằng `op run --env-file=.env -- <lệnh>`. Trên server, bí mật người dùng nhập được mã hoá AES-256-GCM trong bảng `secrets` (D14).
- Log phải che `X-API-Key`, `x-goog-api-key`, `Authorization` và mọi trường token/cookie. Cookie Flow chỉ được gửi tới Max-Studio.
- **Không bao giờ tự chuyển nhà cung cấp video** (D12). Không tự gửi lại request Gemini khi không chắc đã bị tính tiền hay chưa.
- Tài khoản Flow và tài khoản dữ liệu tách biệt (D7): OAuth Google luôn là tài khoản dữ liệu.
- Supabase chỉ dùng làm Postgres truy cập từ server (service role); bật RLS, không tạo policy cho `anon`.
