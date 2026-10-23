# MASYS Video Generator — Đặc tả sản phẩm (MVP)

> Phiên bản 2.0 · 23/10/2026 · Trạng thái: **đã chốt phạm vi, chưa bắt đầu code**
> Tài liệu này viết để một người hoặc agent mới đọc **một lần là nắm được toàn bộ dự án**: làm gì, vì sao, đã chốt gì, còn gì chưa chốt, build theo thứ tự nào.

---

## 0. Tóm tắt trong 30 giây

- **Sản phẩm:** app **PC Windows** (Electron) đọc ảnh người mẫu và prompt từ **Google Sheet**, gọi **Gemini API** để tạo video thử áo dọc 9:16, **upload video lên Google Drive**, rồi **ghi link Drive vào đúng ô** của đúng dòng trong sheet.
- **Khách hàng:** một chủ kênh TikTok bán áo thun dùng người mẫu AI. Đội của họ dùng app trên **nhiều máy Windows 10**, khoảng **5–20 video/ngày**.
- **Yêu cầu cốt lõi:** **đọc dòng N thì ghi về dòng N**, kể cả khi chạy nhiều dòng song song hoặc chạy trên nhiều máy cùng lúc.
- **Không làm:** caption, nhạc, edit video, tự đăng TikTok, tự tạo ảnh người mẫu, web app, macOS.
- **Chi phí vận hành:** khoảng **$1/video** tiền Gemini API, do khách trả bằng API key của họ. Không có server nên không có tiền hosting.

---

## 1. Bối cảnh

### 1.1 Khách đang làm thế nào
Khách đang làm tay từng video: tạo ảnh người mẫu mặc áo, mở **Google Flow** (web tạo video của Google), dán ảnh và một prompt có sẵn, chờ video, tải về, upload lên Drive, rồi dán link vào Google Sheet. Mỗi video làm một lần, dễ dán nhầm dòng, và không chạy hàng loạt được.

### 1.2 Kiểu video cần tạo
Mẫu tham khảo là hai kênh TikTok [@scarletthayes40](https://www.tiktok.com/@scarletthayes40) và [@chloeamira](https://www.tiktok.com/@chloeamira), đã được xem trực tiếp:
- Dọc 9:16, dài khoảng 8–11 giây, **một cảnh**, trông như quay bằng điện thoại trong nhà (trước cửa phòng, tường phòng tắm).
- Người mẫu AI mặc áo thun oversized, nhìn camera, vuốt tóc, cười, **chỉ vào hình in trên áo**.
- Caption và nhạc trend do **người edit thêm sau**, ngoài phạm vi app.
- Lỗi chất lượng hay gặp nhất: **hình in trên áo bị méo**. Prompt nên có câu dặn giữ nguyên hình in.

### 1.3 Mục tiêu của app
Thay toàn bộ phần làm tay ở 1.1 bằng: **chọn dòng → bấm Chạy → link video tự xuất hiện trong sheet**.

---

## 2. Thuật ngữ

| Thuật ngữ | Nghĩa trong dự án |
|---|---|
| **Sheet** | Google Sheet của khách. Mỗi dòng là một video cần tạo |
| **Dòng N** | Số dòng **đúng như hiển thị trong Google Sheet** (dòng 1 thường là tiêu đề) |
| **Ánh xạ cột** | Cấu hình cho biết cột nào là Ảnh, Prompt, URL video, Trạng thái. Lưu theo từng sheet và tab |
| **Job** | Việc tạo video cho **một dòng**. Một job gắn cố định với một dòng và một ô đầu ra |
| **Lô (batch)** | Nhóm job tạo ra từ một lần bấm Chạy |
| **Ô đầu ra** | Ô `[cột URL video][dòng N]`, nơi app ghi link Drive |
| **Khoá dòng** | Ghi `Đang tạo (<tên máy>)` vào cột Trạng thái để máy khác không chạy trùng dòng đó |
| **Lệch dòng** | Dữ liệu ở dòng N đã bị đổi (do ai đó chèn, xoá hoặc sắp xếp dòng) trong lúc job đang chạy |
| **Provider** | Dịch vụ tạo video đứng sau interface `VideoProvider`. MVP chỉ có Gemini Omni Flash |
| **Tên máy** | Tên đặt cho mỗi máy cài app (mặc định là tên máy Windows), dùng khi khoá dòng và trong nhật ký |

---

## 3. Các quyết định đã chốt

Phần này giúp người mới **không mở lại những câu đã trả lời**. Muốn đổi quyết định nào thì phải hỏi người phụ trách dự án trước.

| # | Quyết định | Lý do | Phương án đã loại |
|---|---|---|---|
| D1 | **App PC Windows** (Electron), không phải web | Khách yêu cầu | Web app (Next.js + Supabase) — đã thiết kế ở các bản nháp trước rồi bỏ |
| D2 | **Windows 10 64-bit là chính**, chạy được cả Windows 11 | Phần lớn máy của khách chạy Windows 10 | macOS, Windows 32-bit |
| D3 | Gọi **Gemini API** với model **Gemini Omni Flash** (`gemini-omni-1.1-flash`) | Google Flow **không có API công khai**. Veo 3.1 bản preview trên Gemini API **đã bị tắt từ 22/10/2026**, và Google khuyên chuyển sang Omni Flash | Tự động bấm giao diện Flow bằng bot; API Flow không chính thức (xem 13.3); Veo trên Vertex AI (để dành làm provider dự phòng) |
| D4 | **Khách đã có sẵn ảnh người mẫu** (dạng link trong sheet) | Khách yêu cầu | App tự tạo hoặc ghép áo lên người mẫu |
| D5 | Dữ liệu vào và ra qua **Google Sheet**, người dùng **tự chọn cột và dòng** | Khách quản lý mọi thứ trong sheet | Tải ảnh lên tay trong app; file `.xlsx`/`.csv` |
| D6 | Kết quả là **link Google Drive** ghi vào sheet | Khách yêu cầu | Link tạm của Google (hết hạn sau khoảng 2 ngày, cần API key mới mở được); kho lưu trữ riêng của app |
| D7 | Truy cập Sheet và Drive bằng **OAuth với tài khoản Gmail của khách** | Khách dùng Gmail thường. Service account **không có dung lượng Drive riêng** nên không upload được vào Drive của Gmail thường | Service account; Shared Drive (cần Google Workspace) |
| D8 | **Không có đăng nhập, không phân quyền** | App chạy trên máy của khách | Mật khẩu một tài khoản; phân vai Admin/Thành viên |
| D9 | **Không chèn caption.** Bỏ âm thanh là tuỳ chọn, mặc định bật, và lỗi ở bước này không làm hỏng job | Người edit sẽ thêm caption và nhạc sau | Chèn caption bằng FFmpeg; gợi ý caption và hashtag bằng AI |
| D10 | **Dùng trên nhiều máy:** cột Trạng thái **bắt buộc**, có khoá dòng | Khách cài app trên nhiều thiết bị | Đồng bộ cài đặt qua đám mây |
| D11 | Phần tạo video nằm sau interface `VideoProvider` | Để sau này thay hoặc thêm provider (Veo trên Vertex, Meta Muse) mà không sửa phần còn lại | Gắn chặt vào một API |

---

## 4. Kiến trúc tổng quan

```
┌──────────────────────── App Electron trên máy Windows ────────────────────────┐
│                                                                                │
│  Renderer (React UI)                      Main process (Node)                  │
│  ─ Trình hướng dẫn cài đặt    ◄──IPC──►   ─ JobQueue (SQLite, chạy song song)   │
│  ─ Ánh xạ cột                             ─ VideoProvider: GeminiOmniProvider  │
│  ─ Chọn dòng + xem trước                  ─ GoogleClient: OAuth, Sheets, Drive │
│  ─ Tiến độ lô                             ─ AudioStripper: ffmpeg-static (-an) │
│  ─ Cài đặt                                ─ SecretStore: Electron safeStorage  │
│                                           ─ Tray, thông báo, powerSaveBlocker  │
│                                           ─ Updater: electron-updater          │
└──────────────────────────────────────────┬─────────────────────────────────────┘
                                           │ HTTPS
          ┌────────────────────────────────┼────────────────────────────────┐
          ▼                                ▼                                ▼
   Gemini API                       Google Sheets API                Google Drive API
   (tạo video, API key)             (đọc dòng, ghi 1 ô; OAuth)       (đọc ảnh, upload video; OAuth)
```

Nguyên tắc:
- **Mọi lệnh gọi mạng và mọi bí mật chỉ nằm trong main process.** Renderer không bao giờ cầm API key hay token.
- **Không có server riêng.** Toàn bộ trạng thái nằm trong SQLite trên máy, cộng với cột Trạng thái trong sheet (dùng để phối hợp giữa các máy).

---

## 5. Luồng người dùng

### 5.1 Lần đầu trên một máy
1. **Cài app:** chạy `MASYS-Video-Setup.exe`. Nếu file chưa ký số, Windows SmartScreen sẽ cảnh báo; người dùng bấm *Thông tin thêm → Vẫn chạy*.
2. **Màn hình chào:** hỏi *"Đã có file cấu hình từ máy khác?"*. Nếu có thì nhập file và các bước sau được điền sẵn. Đặt **tên máy** (mặc định là tên máy Windows).
3. **Trình hướng dẫn cài đặt 4 bước** (chưa xong thì chưa chạy được video):
   1. **Gemini API key:** dán key, bấm **Kiểm tra**. App gọi thử một lệnh nhẹ, không tạo video. Key lấy ở aistudio.google.com và phải bật billing.
   2. **Mặc định:** độ phân giải 720p, bỏ âm thanh (bật), 2 job song song, hạn mức chi tiêu mỗi ngày (ví dụ $20).
   3. **Kết nối Google:** app mở trình duyệt mặc định để đăng nhập Gmail. Google sẽ hiện *"ứng dụng chưa được xác minh"*; người dùng bấm *Nâng cao → Đi tới app → Cho phép* và tích đủ các ô quyền. App hiện *"Đã kết nối: ten@gmail.com"*.
   4. **Thư mục Drive lưu video:** dán link thư mục có sẵn, hoặc bấm "Tạo thư mục mới" (app tạo thư mục `Video AI`). App thử ghi để kiểm tra quyền.
4. **Ánh xạ cột (mỗi sheet một lần):** dán link sheet. App kiểm tra tài khoản có **quyền sửa** sheet không, rồi cho chọn tab. App hiện 5 dòng đầu và tự đoán cột theo tiêu đề; người dùng xác nhận các cột Ảnh, Prompt, URL video và Trạng thái, rồi lưu.
5. **Chạy thử 1 dòng (app khuyến nghị):** chọn dòng 5, xem ảnh, prompt và chi phí ước tính (khoảng $1), bấm Chạy, xem video ngay trong app, rồi bấm **"Mở sheet tại ô D5"** để kiểm tra link nằm đúng chỗ.

### 5.2 Dùng hằng ngày
Mở app (sheet dùng gần nhất đã mở sẵn) → chọn dòng (`2-3, 7` hoặc "các dòng chưa có video") → xem trước, bao gồm dòng lỗi, dòng đã có video, dòng máy khác đang tạo và tổng chi phí → **Chạy** → có thể thu nhỏ app xuống khay hệ thống → Windows hiện thông báo khi xong lô.

### 5.3 Tình huống đặc biệt
- **Tắt app hoặc mất điện giữa chừng:** lần mở sau, app hỏi *"Còn N dòng chưa xong, chạy tiếp?"*. App không tạo lại video cho dòng đã xong.
- **Mất kết nối Google:** app dừng các job đang chờ và báo *"Kết nối lại Google"*. Kết nối lại xong thì chạy tiếp.
- **Vượt hạn mức ngày:** app chặn ngay từ màn hình xem trước và báo còn chạy được bao nhiêu dòng.

---

## 6. Đặc tả chức năng

**F1. Kết nối Google Sheet**
- Dán link sheet; app đọc danh sách tab.
- Tài khoản đã kết nối phải có **quyền chỉnh sửa** sheet. Ảnh chỉ cần tài khoản đó xem được.
- Thiếu quyền thì báo rõ: thiếu quyền gì, với sheet hay file ảnh nào.

**F2. Ánh xạ cột**
- 4 cột, chọn theo chữ cái hoặc theo tiêu đề:
  - **Ảnh** (vào): link Google Drive hoặc link ảnh công khai.
  - **Prompt** (vào).
  - **URL video** (ra).
  - **Trạng thái** (ra, **bắt buộc**).
- Chọn dòng tiêu đề (mặc định là dòng 1).
- Lưu theo cặp `(spreadsheetId, tab)`. Sheet chưa có cột URL video hoặc cột Trạng thái thì app đề nghị chọn một cột trống.

**F3. Chọn dòng và xem trước**
- Cách chọn: gõ khoảng dòng (`5`, `2-3, 7, 10-12`), tích chọn trong bảng, hoặc nút "Chọn các dòng chưa có URL video".
- **Đọc lại sheet ngay trước khi hiện bảng xem trước.** Mỗi dòng hiện: số dòng, ảnh thu nhỏ, prompt, link hiện có và trạng thái.
- Dòng không được chạy: thiếu ảnh, thiếu prompt, link ảnh không mở được, hoặc đang bị máy khác khoá (khoá chưa quá 30 phút).
- Dòng đã có link video: phải tích **"Ghi đè"** mới chạy.
- Hiện số video, chi phí ước tính và số tiền còn lại trong hạn mức hôm nay.

**F4. Đồng bộ đúng dòng (yêu cầu cốt lõi)**
- Mỗi job lưu cố định: `spreadsheetId`, `tab`, `rowNumber`, `outputCell` (ví dụ `Sheet1!D5`), `statusCell`, và `inputSnapshot` (link ảnh và prompt đọc được lúc tạo job).
- **Mỗi lần chỉ ghi một ô**, dùng `values.update` cho đúng một ô, không bao giờ ghi cả vùng.
- **Trước khi ghi kết quả:** đọc lại dòng N. Nếu link ảnh hoặc prompt khác `inputSnapshot` thì **không ghi**; job chuyển sang `row_mismatch`, giữ link Drive trong app và cho người dùng tự chọn ô để ghi.
- **Khoá dòng giữa nhiều máy:**
  1. Ghi `Đang tạo (<tên máy>) <thời gian ISO>` vào ô Trạng thái.
  2. Đợi 2 giây rồi đọc lại ô đó.
  3. Ô vẫn ghi tên máy mình thì chạy; nếu không thì job chuyển sang `skipped_locked`.
  4. Khoá quá 30 phút coi như bị bỏ dở; máy khác được chiếm lại.

**F5. Tạo video**
- Dùng `GeminiOmniProvider` (chi tiết gọi API ở mục 8.1).
- Tỉ lệ 9:16. Độ phân giải 720p (mặc định) hoặc 1080p.
- Chạy song song N job (mặc định 2, chỉnh được từ 1 đến 3).
- Lỗi tạm thời (429, 5xx, mất mạng): thử lại tối đa 3 lần, chờ lâu dần giữa các lần.
- Nội dung bị chặn hoặc lỗi 4xx khác: không thử lại, ghi lý do vào ô Trạng thái.

**F6. Lưu lên Drive và ghi link**
- Video được lưu tạm trong `%APPDATA%\MASYS-Video\tmp`, sau đó upload resumable vào `<thư mục gốc>/<tên sheet>/<YYYY-MM-DD>/row<N>_<HHmm>.mp4`.
- Đặt quyền file **"Ai có link đều xem được"**, rồi ghi `webViewLink` vào ô đầu ra.
- Upload thành công thì xoá bản tạm; upload lỗi thì giữ bản tạm và thử lại.
- Tuỳ chọn: giữ thêm một bản trong thư mục trên máy do người dùng chọn (mặc định tắt).

**F7. Bỏ âm thanh**
- Bật thì chạy `ffmpeg -i in.mp4 -c:v copy -an out.mp4` (giữ nguyên hình, chỉ bỏ track âm thanh).
- Bước này lỗi thì upload luôn video gốc và ghi chú vào nhật ký. **Không coi là job lỗi.**

**F8. Tiến độ và chi phí**
- Màn hình tiến độ hiện trạng thái từng dòng, có nút tạm dừng và huỷ lô, có nút "Mở ô" cho từng dòng đã xong.
- Ước tính chi phí theo công thức: `số video × số giây × đơn giá`. Đơn giá để trong cài đặt (mặc định khoảng $0.10/giây ở 720p), có thể sửa.
- Hạn mức chi tiêu mỗi ngày tính **riêng từng máy**. Để chặn **tổng** chi phí của cả đội thì dùng budget alert và quota trên Google Cloud (đưa vào hướng dẫn bàn giao).

**F9. Chạy trên máy**
- Có biểu tượng ở khay hệ thống. Bấm đóng cửa sổ khi lô đang chạy thì app hỏi thu nhỏ xuống khay hay dừng lô.
- `powerSaveBlocker` giữ máy không ngủ khi đang có lô chạy.
- Hàng đợi lưu trong SQLite nên chạy tiếp được sau khi khởi động lại.
- Có thông báo Windows khi xong lô.
- Tự cập nhật bằng `electron-updater` (qua GitHub Releases).
- Nút **"Xuất nhật ký"** tạo file `.zip` không chứa key hay token.

**F10. Dùng trên nhiều máy**
- Mỗi máy tự nhập API key và tự kết nối Google. **Khuyến nghị mọi máy dùng cùng một Gmail**, để mọi video nằm chung một Drive.
- Nút **Xuất/Nhập cấu hình** (file `.json`) gồm cài đặt mặc định, thư mục Drive, đơn giá và các ánh xạ cột. File này **không chứa bí mật**.

**F11. Interface provider**
- `VideoProvider.generate({ imageBytes, mimeType, prompt, aspectRatio, resolution }) → { videoBytes | videoUri, seconds }`.
- MVP chỉ có `GeminiOmniProvider`. Mỗi job lưu thêm trường `provider`.

---

## 7. Vòng đời một job

```
queued → locking ──(máy khác đang giữ)──► skipped_locked
           │
           ▼
      fetching_image ──(ảnh hỏng)──► failed
           │
           ▼
      generating ──(lỗi tạm thời: thử lại ≤3)──► generating
           │      └─(bị chặn / lỗi 4xx)──► failed
           ▼
      stripping_audio (tuỳ chọn; lỗi thì đi tiếp với video gốc)
           │
           ▼
      uploading ──(lỗi: thử lại; giữ bản tạm)──► uploading
           │
           ▼
      writing_back ──(lệch dòng)──► row_mismatch
           │
           ▼
         done
```

- Mỗi lần đổi trạng thái đều ghi vào SQLite **trước khi** làm bước tiếp theo, để có thể chạy tiếp sau khi khởi động lại.
- Khi khởi động lại: job đang ở `generating` thì chạy lại từ đầu (Omni Flash trả kết quả đồng bộ nên không có mã tác vụ để hỏi lại). Job đang ở `uploading` hoặc sau đó thì dùng file tạm đã có.
- Ô Trạng thái trong sheet chỉ ghi các trạng thái người dùng cần đọc: `Đang tạo (<máy>)`, `Xong`, `Lỗi: <lý do ngắn>`, `Lệch dòng`.

---

## 8. Tích hợp bên ngoài

> Các thông tin dưới đây đúng tại ngày 23/10/2026. **Kiểm tra lại tài liệu chính thức trước khi code**, vì Google vừa thay model tạo video cách đây một ngày.

### 8.1 Gemini Omni Flash (tạo video)
- `POST https://generativelanguage.googleapis.com/v1beta/interactions`
- Header: `x-goog-api-key: <key>`
- Body:
  ```json
  {
    "model": "gemini-omni-1.1-flash",
    "input": [
      {"type": "image", "data": "<base64>", "mime_type": "image/jpeg"},
      {"type": "text", "text": "<prompt của dòng> No dialogue, no music."}
    ],
    "response_format": {"type": "video", "aspect_ratio": "9:16", "resolution": "720p"}
  }
  ```
- Kết quả trả về **trong cùng request** (đồng bộ). Đặt timeout vài phút. Video nằm ở `steps[] → type "model_output" → content[] → type "video"`, dạng `data` (base64) hoặc `uri` (khi video lớn hơn 4MB). Với `uri`: đợi file có `state = ACTIVE`, rồi tải từ `/v1beta/files/{id}:download?alt=media`.
- Model **không có gói miễn phí**; API key phải thuộc project đã bật billing.
- Chưa có tham số tắt âm thanh hay chọn độ dài video.
- Tài liệu: https://ai.google.dev/gemini-api/docs/omni · Bảng giá: https://ai.google.dev/gemini-api/docs/pricing

### 8.2 OAuth Google (trên máy tính)
- Tạo OAuth client loại **Desktop app** trên Google Cloud. Dùng loopback `http://127.0.0.1:<cổng ngẫu nhiên>` kết hợp **PKCE**, và mở trình duyệt mặc định để đăng nhập.
- Màn hình đồng ý (consent screen): chọn **External** và chuyển sang **In production**. Nếu để Testing thì refresh token hết hạn sau 7 ngày.
- Không xin Google xác minh app (chỉ một khách dùng); chấp nhận khách thấy cảnh báo *"chưa xác minh"*.
- Xin `access_type=offline` để có refresh token.
- Scope cần xin:
  - `spreadsheets`
  - `drive.readonly` (đọc ảnh)
  - `drive.file` (tạo video)
  - Nếu khách dùng thư mục Drive **có sẵn** (không do app tạo) thì cần `drive` toàn quyền.

### 8.3 Sheets và Drive
- Thư viện `googleapis`.
- Đọc: `spreadsheets.values.get` theo vùng các cột đã ánh xạ.
- Ghi: `spreadsheets.values.update` cho **đúng 1 ô**, với `valueInputOption=RAW`.
- Ảnh: tách file ID từ link Drive rồi gọi `files.get?alt=media`. Link không phải Drive thì tải bằng HTTP GET thường.
- Video: `files.create` (upload resumable) → `permissions.create {role: reader, type: anyone}` → lấy `webViewLink`.

---

## 9. Dữ liệu (SQLite tại `%APPDATA%\MASYS-Video\app.db`)

| Bảng | Các trường chính |
|---|---|
| `settings` | `machineName`, `resolution`, `stripAudio`, `concurrency`, `dailyBudgetUsd`, `pricePerSecondUsd`, `driveRootFolderId`, `localCopyDir?` |
| `sheet_configs` | `spreadsheetId`, `tab`, `headerRow`, `colImage`, `colPrompt`, `colVideoUrl`, `colStatus`, `updatedAt` |
| `batches` | `id`, `spreadsheetId`, `tab`, `rowsSpec` (vd `"2-3,7"`), `status`, `createdAt` |
| `jobs` | `id`, `batchId`, `rowNumber`, `outputCell`, `statusCell`, `inputSnapshot` (JSON), `state`, `attempts`, `error`, `tmpPath`, `driveFileId`, `driveLink`, `audioStripped`, `seconds`, `costUsd`, `provider`, `updatedAt` |
| `usage_daily` | `date`, `videos`, `seconds`, `costUsd` |

Bí mật (Gemini API key, refresh token Google) **không lưu dạng chữ thường trong DB**. Chúng được mã hoá bằng `safeStorage` (dùng DPAPI của Windows) và lưu thành chuỗi đã mã hoá.

---

## 10. Bảo mật
- Key và token chỉ có trong main process, được mã hoá khi lưu, và giao diện chỉ hiện 4 ký tự cuối của key.
- File cấu hình xuất ra và file nhật ký **không bao giờ** chứa key hay token. Nhật ký phải che các header `x-goog-api-key` và `Authorization`.
- OAuth client secret của app Desktop không thực sự bí mật (Google cũng xác định như vậy). Bảo vệ chính đến từ PKCE và từ việc refresh token được mã hoá.
- Không commit key vào repo. Dùng `.env` khi dev và thêm `.env` vào `.gitignore`.

---

## 11. Ngoài phạm vi MVP
- macOS, Windows 32-bit, web, điện thoại.
- Đăng nhập trong app, phân quyền, đồng bộ cài đặt qua đám mây.
- Caption, chữ, logo, nhạc, edit video.
- Tự tạo ảnh người mẫu; tự đăng TikTok hoặc lên lịch đăng.
- Tự động hoá giao diện Google Flow, hoặc dùng API Flow không chính thức.
- Ảnh chèn trực tiếp vào ô sheet (chỉ hỗ trợ ảnh dạng link).
- Provider khác ngoài Gemini Omni Flash (mới chỉ để sẵn interface).

---

## 12. Tiêu chí hoàn thành
1. Cài `.exe` trên máy **Windows 10** sạch (và thử thêm một máy Windows 11), đi hết cài đặt mà không phải cài thêm gì.
2. **Một dòng:** chọn dòng 5 → video tạo từ đúng ảnh và prompt của dòng 5, link Drive vào đúng ô `[URL video]5`, không ô nào khác bị đổi.
3. **Nhiều dòng:** chọn `2-3` với hai ảnh khác hẳn nhau → mỗi dòng nhận đúng video của mình. Lặp lại 3 lần, kể cả khi dòng 3 xong trước dòng 2.
4. **Lô 10 dòng không liên tiếp** (`2-4, 8, 12-17`) → 10 link vào đúng 10 ô.
5. **Lệch dòng:** chèn một dòng mới phía trên trong lúc đang chạy → app không ghi nhầm; các job bị ảnh hưởng chuyển sang `row_mismatch`.
6. **Tắt app giữa chừng:** đang chạy 5 dòng thì tắt app → mở lại thì chạy tiếp, dòng đã xong không bị tạo lại.
7. **Hai máy cùng lúc:** máy A và máy B cùng chạy dòng 2–5 → mỗi dòng chỉ có 1 video, ô Trạng thái ghi đúng tên máy đã tạo.
8. **Khoá bị bỏ dở:** máy A tắt hẳn khi đang tạo dòng 6 → sau 30 phút, máy B chạy được dòng 6.
9. **Dòng lỗi** (link ảnh hỏng, nội dung bị chặn) → ô Trạng thái của đúng dòng đó ghi lỗi, các dòng khác vẫn xong.
10. **Âm thanh:** khi bật bỏ âm thanh, video trên Drive không có track âm thanh; khi FFmpeg lỗi thì vẫn có link video gốc.
11. Link Drive mở được trên một trình duyệt chưa đăng nhập, file nằm đúng thư mục con, và vẫn mở được sau 7 ngày.
12. Đóng rồi mở lại app: không phải nhập lại key, không phải kết nối lại Google, ánh xạ cột vẫn còn.
13. **Máy mới:** nhập file cấu hình → chỉ còn phải nhập key và kết nối Google.
14. Mở DB, file cấu hình và nhật ký bằng công cụ bất kỳ: không thấy key hay token ở dạng chữ thường.

---

## 13. Bối cảnh tham khảo (đã tìm hiểu, không cần làm lại)

### 13.1 Chi phí
- Omni Flash 720p khoảng **$0.10/giây**, tức khoảng **$0.8–1.0/video** 8–10 giây.
- **5 video/ngày** khoảng **$120–150/tháng**; **20 video/ngày** khoảng **$500–600/tháng**. Mỗi lần chạy lại video hỏng sẽ cộng thêm.
- Giá 1080p chưa được công bố rõ.
- Drive miễn phí 15GB chứa được khoảng 1.000–2.000 video.

### 13.2 Credit Google Flow không dùng được cho app
Gói Flow Pro hay Ultra (credit AI của gói cá nhân) **không cấp API key**, và credit Flow **gần như chắc chắn không trừ được qua Gemini API**. Một số báo cáo trên diễn đàn Google không nhất quán về điểm này. Cách kiểm tra: đăng nhập AI Studio bằng tài khoản có gói, xem mục Billing, rồi gọi thử một video. Credit Flow nên được dùng để **thử prompt bằng tay** trước khi đưa prompt vào sheet.

### 13.3 API Flow không chính thức đã bị loại
Lý do loại:
- Vi phạm điều khoản của Google, có nguy cơ **khoá tài khoản Gmail của khách** (chính tài khoản đang chứa sheet và Drive).
- Dễ hỏng bất cứ lúc nào.
- Phải giao thông tin đăng nhập cho bên thứ ba.
- Số tiền tiết kiệm được nhỏ (vài chục đến khoảng $100).

Nếu khách vẫn muốn dùng: chỉ làm như một provider phụ, chạy trên **một tài khoản Google riêng**, tự chuyển về API chính thức khi hỏng, và khách xác nhận rủi ro bằng văn bản.

### 13.4 Meta Muse
Tính đến 10/2026, API chính thức của Meta mới có Muse Image, **chưa có Muse Video**. Cách duy nhất hiện có là qua bên thứ ba (useapi.net), phải đưa mật khẩu tài khoản Muse cho họ. Khuyến mãi "1 tỷ token" là chương trình giới thiệu cho người dùng cá nhân, không phải tín dụng API. Có thể thêm Muse làm provider khi Meta mở API video chính thức.

### 13.5 Veo trên Vertex AI (provider dự phòng, chưa làm)
- `POST https://<location>-aiplatform.googleapis.com/v1/projects/<project>/locations/<location>/publishers/google/models/<model>:predictLongRunning`
- Xác thực bằng access token của service account.
- Request trả về tên tác vụ (operation); hỏi lại định kỳ đến khi `done: true`.
- Phức tạp hơn Omni Flash; chưa xác nhận được tên model nào đang là bản chính thức (GA).

---

## 14. Câu hỏi còn mở (cần chốt với khách)
1. Các máy có kết nối **cùng một tài khoản Gmail** không? Có máy nào chạy Windows 10 **32-bit** không?
2. Ai trả tiền Gemini API, hạn mức tháng bao nhiêu? Dùng chung một key hay mỗi máy một key? Ai sẽ đặt budget alert trên Google Cloud?
3. Rate limit (số yêu cầu mỗi phút và mỗi ngày) của project Gemini của khách là bao nhiêu? Con số này quyết định số job song song tối đa.
4. Xin **1 sheet mẫu thật** để chốt cột và nơi lưu ảnh (Drive hay link khác).
5. Dòng đã có link video: mặc định bỏ qua hay ghi đè?
6. Dùng 720p hay 1080p?
7. Có cần giữ thêm bản video trên máy cho người edit không?
8. Khách chấp nhận cảnh báo SmartScreen, hay muốn mua chứng chỉ ký số (khoảng vài trăm USD/năm)?
9. Cần báo khách: áo dùng nhân vật có bản quyền dễ bị TikTok Shop gỡ, và TikTok yêu cầu gắn nhãn nội dung do AI tạo.

---

## 15. Thứ tự build
1. **Phần lõi:** script Node gọi Omni Flash, 1 ảnh và 1 prompt ra 1 video 9:16. Ghi lại thời gian chờ và chi phí thật, rồi cập nhật mục 13.1.
2. **Google:** OAuth Desktop với PKCE; đọc đúng dòng N, ghi đúng 1 ô ở dòng N (thử với dữ liệu giả, chưa gọi model).
3. **Drive:** upload resumable, đặt quyền link, ghi link vào sheet.
4. **Hàng đợi:** SQLite, chạy song song, thử lại, chạy tiếp sau khi khởi động lại, khoá dòng, kiểm tra lệch dòng.
5. **Bỏ âm thanh** bằng `ffmpeg-static`.
6. **Giao diện:** trình hướng dẫn cài đặt, ánh xạ cột, chọn dòng và xem trước, tiến độ, khay hệ thống, thông báo.
7. `safeStorage`, theo dõi chi phí, xuất/nhập cấu hình, xuất nhật ký.
8. **Đóng gói** `.exe` bằng `electron-builder`, cài tự cập nhật, thử trên máy Windows 10 sạch, rồi bàn giao kèm hướng dẫn: tạo API key, bật billing, đặt budget alert, kết nối Google.
