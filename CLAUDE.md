# KOL Fashion MASYS Video (MASYS Video Generator)

Đặc tả đầy đủ: `SPEC-app-tao-video-ao.md` (v6.3) — đọc trước khi làm bất cứ việc gì. Không mở lại các quyết định ở mục 3 (D1–D35) nếu chưa hỏi người phụ trách.

## Kiến trúc (spec v6.0 mục 17, từ v2.0.0)
- **Tool chạy trên một máy Windows:** một tiến trình Node (TypeScript) + giao diện ở `localhost` + **Playwright** điều khiển Chrome + SQLite cục bộ.
- **Tên app** (D29, từ v2.1.0): "KOL Fashion MASYS Video" (`APP_NAME` trong `src/version.ts`); zip `KOL-Fashion-MASYS-Video-vX.Y.Z-win64.zip`. Thư mục dữ liệu `masys-video` và kho GitHub giữ tên cũ; mỗi bản phát hành đăng thêm zip tên cũ `MASYS-Video-…` cho bản trước 2.1.0 tự cập nhật.
- **Meta Muse AI là nơi duy nhất tạo video**, điều khiển qua giao diện web bằng bot. Màn hình chính là **Bảng** (`bang_rows`, D21): 4 ô ảnh (Mẫu trước, Áo trước, Mẫu sau, Áo sau) chọn từ máy, tool chép vào `%LOCALAPPDATA%\masys-video\tep\anh`. Bot mở một cuộc trò chuyện mới cho mỗi dòng, **đính kèm ảnh** theo thứ tự cố định (D22, D24), chờ video hiện trong chat rồi **đọc video `blob:` ngay trong trang** về `tep\video` (D23). Lô của Bảng có `batches.source = 'bang'`, lượt gắn dòng qua `runs.bangRowId`.
- Không cần Google để tạo video. **Service account** (D5) chỉ dùng cho *Nhập từ Google Sheet* (chỉ đọc) và **Bảng theo sheet** (luồng cũ v1.x, ở ⚙ Nâng cao, `/bang-sheet`: Muse lưu video lên Drive và ghi link vào sheet).
- **Hook đầu video** (D30, từ v2.2.0): ô *Thêm hook* trên Bảng; mỗi dòng một clip hook (`tep\hook`) + câu hook (câu riêng, không có thì câu chung hôm nay). Video về thì `HookMerger` (`src/bang/hook.ts`) ghép bằng **ffmpeg đi kèm** (`phien-ban\X.Y.Z\ffmpeg\ffmpeg.exe`, khi phát triển lấy từ `ffmpeg-static`), câu hook vẽ bằng Chrome chạy ẩn; giữ bản gốc, bản có hook ở `bang_rows.hookVideoFile`.
- **Bảng ảnh** (D31–D33, từ v2.3.0): `/bang-anh` (`src/web/bangAnh.tsx`, `src/anh/`), độc lập với Bảng video; bảng `anh_rows` / `anh_files`, lô `batches.source = 'anh'`, lượt gắn dòng qua `runs.anhRowId`. Trang **Nhân vật** (`/nhan-vat`, bảng `nhan_vat`): người dùng tự thêm **ảnh 4 góc** (character sheet, `file`) và **ảnh mặt** (`faceFile`, tuỳ chọn, từ CON-80), lưu `tep\nhan-vat`, **không bao giờ đóng gói vào app/repo** (repo công khai); ảnh 4 góc luôn đính kèm là ảnh 1, ảnh mặt là ảnh 2. Ảnh Muse tạo tải về `tep\anh-tao`. Dòng tích Quay lưng: tải xong ảnh mặt trước mới gửi tin thứ hai trong cùng cuộc trò chuyện. Giới hạn ảnh mỗi ngày riêng (`dailyImageLimit`, mặc định 100, tối đa 150). **Xuất sang Bảng video** (D34, từ v2.4.0, `src/anh/export.ts`): chép ảnh chính vào `tepnh` thành Mẫu trước / Mẫu sau của dòng `bang_rows` mới, ghi `anh_rows.exportedBangRowId`; xuất lại phải xác nhận.
- **Tạo nhân vật trong app** (D35, CON-81, `/nhan-vat/tao`, `src/web/taoNhanVat.tsx`, `src/anh/taoNhanVat.ts`): 12 tiêu chí → ảnh master → đính kèm master tạo turnaround + face (mỗi ảnh một cuộc trò chuyện) → Lưu vào `nhan_vat`. Bản nháp `nv_drafts` / `nv_draft_files`, lô `batches.source = 'nv'`, lượt gắn qua `runs.nvDraftId`, tính vào giới hạn ảnh. Prompt là nguyên văn của người phụ trách, không sửa nếu chưa hỏi.
- Giới hạn mặc định 100 video/ngày, tối đa 150 (D25). Video và ảnh chỉ bị xoá khi người dùng bấm 🗑 / Xoá dòng / Dọn tất cả (D26).
- Không có server, không Supabase, không gọi API video nào (Gemini, Max-Studio, Flow đã bỏ).
- **Phát hành cho đội bằng zip** (D15): `npm run package` → `release/KOL-Fashion-MASYS-Video-vX.Y.Z-win64.zip` và zip tên cũ `MASYS-Video-…` (Node đi kèm + `Mo-MASYS.bat`). Khoá Google (chỉ cần khi dùng sheet) chọn ở trang Cài khoá, lưu mã hoá DPAPI ở `%LOCALAPPDATA%\masys-video`; biến `GOOGLE_SERVICE_ACCOUNT_JSON` (op run) luôn được ưu tiên. Số phiên bản là `version` trong `package.json`.
- **Cập nhật trong tool** (D16): máy người dùng tải bản mới từ GitHub Releases của repo này (công khai), chỉ khi bấm nút. Zip có `phien-ban\X.Y.Z` + `hien-tai.txt`; `Mo-MASYS.bat` chạy bản ghi trong đó, mã thoát 76 = đổi bản, bản mới không lên thì tự quay về.

## Quy trình phát hành (D16)
**Gom nhiều ticket vào một bản** (từ 03/11/2026, theo yêu cầu người phụ trách):
- Ticket nào đổi gì trong tool thì **trong chính PR đó** viết ghi chú tiếng Việt cho người dùng đọc dưới mục `## Chưa phát hành` ở đầu `CHANGELOG.md` (chưa có thì tạo). **Không** nâng `version` trong PR ticket.
- Người phụ trách nói **"gộp"**: chỉ gộp PR (`gh pr merge N --squash --delete-branch`, rồi `git checkout main && git pull`), **chưa phát hành**. Báo những gì đang chờ phát hành.
- Người phụ trách nói **"phát hành"**: nhánh `release/vX.Y.Z` nâng `version` trong `package.json` + `package-lock.json` (có tính năng mới → `x.Y.0`, chỉ sửa lỗi → `x.y.Z`), đổi `## Chưa phát hành` thành `## vX.Y.Z` và viết lại thành một ghi chú gọn; PR, tự gộp (câu "phát hành" là lời duyệt), `git checkout main && git pull` rồi `npm run release` (khoảng 10 phút). Báo link bản phát hành.
- **Lỗi khẩn** (chặn cập nhật, chặn tạo video…): hỏi người phụ trách có phát hành riêng ngay không; đồng ý thì làm ticket và phát hành liền.
- Migration SQLite **chỉ được thêm** bảng/cột, không xoá hay đổi tên, để bản cũ vẫn mở được dữ liệu khi người dùng bấm Quay về.

## Cổng làm việc
- **Chỉ viết code khi người phụ trách đã duyệt**, làm **từng ticket một**, xong một ticket thì dừng chờ duyệt.

## Quy tắc làm việc
- Mỗi tính năng là một ticket trong Linear project **MASYS Video Generator** (team Conducdaudan). Đọc "Định nghĩa hoàn thành" của ticket trước khi code; cập nhật trạng thái ticket khi bắt đầu / xong.
- Nhánh: dùng đúng `gitBranchName` Linear gợi ý cho ticket để Linear tự liên kết PR; mở PR vào `main`.
- **Bí mật:** không bao giờ dán key/token vào code, commit hay khung chat. `.env` chỉ chứa `op://…`; chạy bằng `op run --env-file=.env -- <lệnh>`.
- **Bot Muse:** không bao giờ gõ mật khẩu Meta, không vượt captcha/2FA; người dùng tự đăng nhập trong hồ sơ bot (D6). Hồ sơ bot, SQLite và ảnh chụp màn hình nằm ngoài repo; không log cookie.
- **Không tự gửi lại yêu cầu cho Muse khi không chắc** đã gửi hay chưa (D9). Mỗi dòng một cuộc trò chuyện mới (D7). Bảng gửi lần lượt, chờ tối đa N video cùng lúc, mỗi dòng một tab riêng (D28, Cài đặt 1–6, mặc định 3); không gộp nhiều dòng vào một tin nhắn. Bảng theo sheet vẫn tuần tự.
- **Bảng theo sheet (luồng cũ):** bot khi chạy lô chỉ ghi **đúng một ô Trạng thái** mỗi lần. Ngoài ra (D18, từ v1.3.0) tool chỉ ghi ô **Prompt / Ảnh người mẫu / Ảnh áo** khi người dùng sửa trên Bảng (đọc lại ô trước khi ghi, khác thì không ghi) và thêm dòng ở cuối; **không bao giờ** ghi ô Video, không xoá / chèn / sắp xếp dòng. Mọi lần ghi lưu ở bảng `sheet_edits`.
