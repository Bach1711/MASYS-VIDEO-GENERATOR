# MASYS Video Generator

Tool chạy trên một máy Windows: đọc Google Sheet, điều khiển Meta Muse AI tạo video. Đặc tả: [`SPEC-app-tao-video-ao.md`](SPEC-app-tao-video-ao.md). Tiến độ: [`TIEN-DO.md`](TIEN-DO.md), hoặc mở `TIEN-DO.html` bằng trình duyệt để xem sơ đồ.

## Chạy

Cần Node ≥ 22, 1Password CLI (`op`) đã đăng nhập.

```
npm install
op run --env-file=.env -- npm run dev
```

Mở http://localhost:4310. Server chỉ nghe `127.0.0.1`.

- Dữ liệu (SQLite, sau này cả hồ sơ bot và ảnh chụp lỗi) nằm ở `%LOCALAPPDATA%\masys-video`, ngoài repo. Đổi bằng `MASYS_DATA_DIR`.
- Đổi cổng bằng `PORT`.
- `npm test` chạy test; `npm run typecheck` kiểm tra kiểu.
- `op run --env-file=.env -- npm run test:google` chạy test với Google Sheet thật: ghi tạm ô Trạng thái dòng 2 (`MASYS_TEST_ROW`) của sheet mẫu, kiểm tra chỉ ô đó đổi, rồi trả lại giá trị cũ.
