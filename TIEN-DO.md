# Tiến độ dự án MASYS Video Generator

> Cập nhật lần cuối: **26/10/2026**, sau CON-36. File này được cập nhật trong PR của mỗi ticket CON.
> Muốn xem sơ đồ thành hình: bấm đúp **`TIEN-DO.html`** trong thư mục dự án (tạo lại bằng `npm run tien-do`).
> Đặc tả: [`SPEC-app-tao-video-ao.md`](SPEC-app-tao-video-ao.md) v4.1 · Linear: project **MASYS Video Generator**

**Tổng quan:** 2/8 ticket xong · 1 chờ duyệt · 5 chưa làm

```
[■■▣□□□□□]  2/8 xong — CON-37 chờ duyệt
```

## Sơ đồ kiến trúc theo trạng thái

Màu: 🟩 xong (đã merge) · 🟦 chờ duyệt (PR mở) · 🟨 đang làm · ⬜ chưa làm · 🟪 hệ thống bên ngoài

```mermaid
flowchart LR
    user(["👤 Người dùng"])

    subgraph PC["Máy Windows chạy tool (một tiến trình Node, 127.0.0.1)"]
        direction TB
        ui["Giao diện localhost<br/>khung: CON-35"]
        server["Server cục bộ Hono<br/>CON-35"]
        secrets["Nạp bí mật qua op run<br/>+ logger che bí mật<br/>CON-35"]
        db[("SQLite ngoài repo<br/>5 bảng §9<br/>CON-35")]

        sheet["SheetsClient + trang Kết nối sheet<br/>đọc tab, ánh xạ cột, bản chụp tab,<br/>ghi 1 ô Trạng thái<br/>CON-36"]
        scan["Quét và chọn dòng<br/>nhãn, ảnh thu nhỏ, giới hạn ngày<br/>CON-37"]
        editor["Chỉnh yêu cầu<br/>prompt, yêu cầu thêm,<br/>thư mục Drive, xem trước<br/>CON-38"]
        bot["MuseBot (Playwright)<br/>hồ sơ bot, đăng nhập/captcha,<br/>chat mới, gửi, chụp lỗi<br/>CON-39"]
        queue["RunQueue + kiểm tra D12<br/>theo dõi ô Video, sửa nhầm ô,<br/>khôi phục<br/>CON-40"]
        drive["DriveClient<br/>kiểm tra ảnh + ảnh thu nhỏ: CON-37<br/>liệt kê thư mục: CON-38<br/>kiểm tra video: CON-40"]
        progress["Tiến độ, lịch sử,<br/>nhật ký, Cài đặt<br/>CON-41"]
    end

    subgraph EXT["Bên ngoài"]
        gsheets[("Google Sheets")]
        gdrive[("Google Drive")]
        chrome["Chrome<br/>hồ sơ bot"]
        muse["Meta Muse AI"]
        op["1Password"]
    end

    user --> ui --> server
    server --> scan & editor & progress
    scan --> sheet
    editor --> drive
    server --> queue
    queue --> sheet & drive & bot
    queue --> db
    progress --> db
    sheet -- "ánh xạ cột" --> db
    sheet -- "service account" --> gsheets
    drive -- "service account" --> gdrive
    bot --> chrome --> muse
    muse -- "MCP: lưu video" --> gdrive
    muse -- "MCP: ghi link ô Video" --> gsheets
    op -. "op run" .-> secrets --> server

    classDef done fill:#c8f0c8,stroke:#2e7d32,color:#10300f
    classDef review fill:#cfe3ff,stroke:#1f5fbf,color:#0c2550
    classDef doing fill:#fff1b8,stroke:#b38600,color:#3d2e00
    classDef todo fill:#eeeeee,stroke:#9e9e9e,color:#333333
    classDef ext fill:#ead9ff,stroke:#6a3fb5,color:#2a1250

    class ui,server,secrets,db,sheet done
    class scan review
    class drive doing
    class editor,bot,queue,progress todo
    class gsheets,gdrive,chrome,muse,op ext
```

## Bảng ticket (Giai đoạn 1, spec §15)

| # | Ticket | Nội dung | Trạng thái | PR | Hoàn thành |
|---|---|---|---|---|---|
| 1 | [CON-35](https://linear.app/conducdaudan/issue/CON-35) | Khung dự án: Node + TS, server cục bộ + giao diện, SQLite, op run | 🟩 Xong | [#1](https://github.com/Bach1711/MASYS-VIDEO-GENERATOR/pull/1) | 26/10/2026 |
| 2 | [CON-36](https://linear.app/conducdaudan/issue/CON-36) | Google: service account, đọc tab, ánh xạ cột, ghi 1 ô Trạng thái | 🟩 Xong | [#2](https://github.com/Bach1711/MASYS-VIDEO-GENERATOR/pull/2) | 26/10/2026 |
| 3 | [CON-37](https://linear.app/conducdaudan/issue/CON-37) | Quét và chọn dòng, nhãn, ảnh thu nhỏ, giới hạn ngày | 🟦 Chờ duyệt | [#4](https://github.com/Bach1711/MASYS-VIDEO-GENERATOR/pull/4) | — |
| 4 | [CON-38](https://linear.app/conducdaudan/issue/CON-38) | Chỉnh yêu cầu, chọn thư mục Drive, xem trước | ⬜ Chưa làm | — | — |
| 5 | [CON-39](https://linear.app/conducdaudan/issue/CON-39) | MuseBot: hồ sơ bot, đăng nhập/captcha, chat mới, gửi, chụp lỗi | ⬜ Chưa làm | — | — |
| 6 | [CON-40](https://linear.app/conducdaudan/issue/CON-40) | Chạy lượt + kiểm tra D12, phát hiện sửa nhầm ô, khôi phục | ⬜ Chưa làm | — | — |
| 7 | [CON-41](https://linear.app/conducdaudan/issue/CON-41) | Tiến độ, lịch sử lô, nhật ký, Cài đặt | ⬜ Chưa làm | — | — |
| 8 | [CON-42](https://linear.app/conducdaudan/issue/CON-42) | Chạy đủ 12 tiêu chí với sheet thật, bàn giao | ⬜ Chưa làm | — | — |

## Nhật ký cập nhật

- **26/10/2026 · CON-37** (chờ duyệt): trang **Quét và chọn dòng**. Bảng mọi dòng có ảnh thu nhỏ (qua service account), prompt, trạng thái, nhãn *Sẵn sàng / Đã có video / Đang chạy / Thiếu dữ liệu* kèm lý do; Ghi đè từng dòng; Bỏ khoá có xác nhận; chọn bằng tích, khoảng `2-5, 8`, "Chọn mọi dòng chưa có video"; "Hôm nay: X/5 video" và khoá nút Chạy khi vượt. Nút Chạy hiện mới dẫn tới trang tóm tắt (gửi Muse làm từ CON-38). Đã thử với sheet thật: dòng 2–3 Sẵn sàng, ảnh thu nhỏ hiện đúng.

- **26/10/2026 · CON-36** (xong, đã duyệt và gộp vào main): trang **Kết nối sheet** (dán link → danh sách tab → tự đoán 4 cột → lưu theo sheet + tab); báo *"Chia sẻ sheet cho (email service account) với quyền chỉnh sửa"* khi thiếu quyền hoặc chỉ có quyền xem; đọc toàn tab và dòng N; ghi đúng 1 ô Trạng thái (`RAW`, Google phải xác nhận đúng ô); bản chụp tab + so sánh. Đã thử với sheet thật: ghi D2 → chỉ D2 đổi → trả lại như cũ.

- **26/10/2026 · CON-35** (xong, đã duyệt và gộp vào main): khung Node + TypeScript, Hono chỉ nghe `127.0.0.1:4310`, SQLite (better-sqlite3) ở `%LOCALAPPDATA%\masys-video\data.db` với 5 bảng §9, nạp khoá service account qua `op run` (thiếu khoá thì báo rõ, không crash), logger pino che key/token/cookie/khoá PEM.
