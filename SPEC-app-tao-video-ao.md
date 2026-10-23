# MASYS Video Generator — Đặc tả sản phẩm (MVP)

> Phiên bản 2.6 · 23/10/2026 · Trạng thái: **đã chốt phạm vi, chưa bắt đầu code, đang chờ Giai đoạn 0 (kiểm chứng Max-Studio)**
> Thay đổi so với 2.0: nhà cung cấp video chính đổi từ Gemini API (tính tiền theo lượt) sang **Max-Studio** (dùng credit Google Flow của khách). Gemini API giữ lại làm dự phòng, mặc định tắt.
> Thay đổi so với 2.1: (1) mục 7 — lỗi khi hỏi trạng thái thì **hỏi lại, không gửi lại task**; (2) tách tài khoản và ký xác nhận rủi ro phải xong **trước Giai đoạn 0** (mục 5.0, 15); (3) tiêu chí 12.17 thêm Gemini API key.
> Thay đổi so với 2.2: (1) bước 3.1 có ô **email tài khoản Flow** để cảnh báo trùng tài khoản; (2) chốt câu 14.6: dòng đã có link video **mặc định bỏ qua**, kể cả khi máy khác vừa ghi link trong lúc lô đang chạy.
> Thay đổi so với 2.3: chốt D14 — **mỗi máy tự dán token Flow**; loại phương án chia sẻ token qua sheet.
> Thay đổi so với 2.4: **mục tiêu trải nghiệm — khách chỉ cần dán Max-Studio API key là tạo được video trên Flow.** Ô token Flow chỉ xuất hiện nếu Giai đoạn 0 cho thấy Max-Studio bắt buộc gửi token theo từng request.
> Thay đổi so với 2.5 (kết quả thử GĐ0 điểm 0): **chỉ dán API key hiện KHÔNG tạo được video** — API V2 (không cần giấy tờ Flow) chưa mở "ảnh thành video" (HTTP 422 *"No active pricing rule"*). **Chốt dùng API V3**: gửi kèm **cookie Google Labs của tài khoản Flow**. Trong spec, "token Flow" từ nay hiểu là **cookie Flow**; mọi quy tắc của token (D14, mục 10) áp dụng cho cookie.
> Tài liệu này viết để một người hoặc agent mới đọc **một lần là nắm được toàn bộ dự án**: làm gì, vì sao, đã chốt gì, còn gì chưa chốt, build theo thứ tự nào.

---

## 0. Tóm tắt trong 30 giây

- **Sản phẩm:** app **PC Windows** (Electron) đọc ảnh người mẫu và prompt từ **Google Sheet**, tạo video thử áo dọc 9:16 bằng **Veo 3 thông qua Max-Studio**, **upload video lên Google Drive**, rồi **ghi link Drive vào đúng ô** của đúng dòng trong sheet.
- **Khách hàng:** một chủ kênh TikTok bán áo thun dùng người mẫu AI. Đội của họ dùng app trên **nhiều máy Windows 10**, khoảng **5–20 video/ngày**. Khách **có gói Google Flow với hơn nghìn credit** và muốn **không mất thêm tiền API**.
- **Yêu cầu cốt lõi:** **đọc dòng N thì ghi về dòng N**, kể cả khi chạy nhiều dòng song song hoặc chạy trên nhiều máy cùng lúc.
- **Không làm:** caption, nhạc, edit video, tự đăng TikTok, tự tạo ảnh người mẫu, web app, macOS.
- **Chi phí vận hành:** gói Max-Studio **khoảng 199.000đ/tháng**, cộng với credit Flow khách đã có. Không có server nên không có tiền hosting.
- **⚠️ Rủi ro đã chấp nhận:** Max-Studio là dịch vụ **không chính thức**, do bên **ẩn danh** vận hành. Nó dùng token đăng nhập Flow của khách và có thể vi phạm điều khoản của Google. Cách giảm rủi ro được mô tả ở mục 3 (D7, D12) và mục 13.

---

## 1. Bối cảnh

### 1.1 Khách đang làm thế nào
Khách làm tay từng video: tạo ảnh người mẫu mặc áo, mở **Google Flow** (web tạo video của Google, chạy Veo), dán ảnh và một prompt có sẵn, chờ, tải video về, upload lên Drive, rồi dán link vào Google Sheet. Cách này chậm, dễ dán nhầm dòng, và không chạy hàng loạt được.

### 1.2 Kiểu video cần tạo
Mẫu tham khảo là hai kênh TikTok [@scarletthayes40](https://www.tiktok.com/@scarletthayes40) và [@chloeamira](https://www.tiktok.com/@chloeamira), đã được xem trực tiếp:
- Dọc 9:16, dài khoảng 8–11 giây, **một cảnh**, trông như quay bằng điện thoại trong nhà.
- Người mẫu AI mặc áo thun oversized, nhìn camera, vuốt tóc, cười, **chỉ vào hình in trên áo**.
- Caption và nhạc trend do **người edit thêm sau**, ngoài phạm vi app.
- Lỗi chất lượng hay gặp nhất: **hình in trên áo bị méo**. Prompt nên có câu dặn giữ nguyên hình in.

### 1.3 Mục tiêu của app
Thay toàn bộ phần làm tay ở 1.1 bằng: **chọn dòng → bấm Chạy → link video tự xuất hiện trong sheet**, dùng credit Flow sẵn có thay vì trả tiền API theo lượt.

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
| **Lệch dòng** | Dữ liệu ở dòng N đã bị đổi (do chèn, xoá hoặc sắp xếp dòng) trong lúc job đang chạy |
| **Provider** | Dịch vụ tạo video đứng sau interface `VideoProvider`. Chính: `MaxStudioProvider`. Dự phòng: `GeminiOmniProvider` |
| **Max-Studio** | Dịch vụ API bên thứ ba (max-studio.shop), thay mặt tài khoản Flow của khách để gọi Veo 3 |
| **Max-Studio API key** | Key của tài khoản Max-Studio, gửi trong header `X-API-Key` |
| **Token Flow / cookie Flow** | Giấy tờ của **tài khoản Flow** gửi kèm mỗi request tới Max-Studio. Từ v2.6 dùng API V3 nên đây là **cookie Google Labs** (trường `cookie`); API V1 dùng JWT (trường `jwt`). Đây là bí mật nhạy cảm nhất |
| **Tài khoản Flow** | Tài khoản Google có gói Flow (đang giữ credit). Chỉ dùng cho việc tạo video. Người dùng nhập email của tài khoản này ở bước 3.1 để app cảnh báo trùng |
| **Tài khoản dữ liệu** | Tài khoản Gmail mà app kết nối bằng OAuth để đọc sheet và upload Drive. **Phải khác tài khoản Flow** (D7) |
| **Tên máy** | Tên đặt cho mỗi máy cài app (mặc định là tên máy Windows) |

---

## 3. Các quyết định đã chốt

Phần này giúp người mới **không mở lại những câu đã trả lời**. Muốn đổi quyết định nào thì phải hỏi người phụ trách dự án trước.

| # | Quyết định | Lý do | Phương án đã loại |
|---|---|---|---|
| D1 | **App PC Windows** (Electron), không phải web | Khách yêu cầu | Web app (Next.js + Supabase) |
| D2 | **Windows 10 64-bit là chính**, chạy được cả Windows 11 | Phần lớn máy của khách chạy Windows 10 | macOS, Windows 32-bit |
| D3 | **Provider chính: Max-Studio** (Veo 3, dùng credit Flow). Chỉ chính thức chốt **sau khi Giai đoạn 0 đạt** (mục 15) | Khách có credit Flow và không muốn trả tiền API (khoảng $1/video). Google Flow **không có API công khai**, và credit Flow **không dùng được** qua Gemini API | Gemini API làm đường chính (vẫn giữ làm dự phòng, D12); bot tự bấm Flow; useapi.net (dự phòng thứ hai nếu Max-Studio không đạt); Meta Muse (chưa có API video chính thức, chưa kiểm chứng chất lượng) |
| D4 | **Khách đã có sẵn ảnh người mẫu** (dạng link trong sheet) | Khách yêu cầu | App tự tạo hoặc ghép áo lên người mẫu |
| D5 | Dữ liệu vào và ra qua **Google Sheet**, người dùng **tự chọn cột và dòng** | Khách quản lý mọi thứ trong sheet | Tải ảnh lên tay; file `.xlsx`/`.csv` |
| D6 | Kết quả là **link Google Drive** ghi vào sheet | Khách yêu cầu | Link tạm của nhà cung cấp; kho lưu trữ riêng của app |
| D7 | **Tách tài khoản:** tài khoản Flow chỉ dùng để tạo video. Sheet và thư mục Drive nằm ở hoặc được chia sẻ cho **một Gmail khác** (tài khoản dữ liệu), và app kết nối OAuth bằng tài khoản dữ liệu này | Token Flow phải giao cho Max-Studio (bên ẩn danh), và tài khoản Flow có rủi ro bị khoá. Tách ra thì nếu có chuyện, sheet và video vẫn an toàn | Dùng chung một tài khoản (rủi ro mất cả Gmail, Drive, sheet); mua gói Flow cho tài khoản mới (tốn tiền) |
| D8 | Truy cập Sheet và Drive bằng **OAuth với tài khoản dữ liệu** | Khách dùng Gmail thường; service account không có dung lượng Drive | Service account; Shared Drive |
| D9 | **Không có đăng nhập, không phân quyền** trong app | App chạy trên máy của khách | Mật khẩu; Admin/Thành viên |
| D10 | **Không chèn caption.** Bỏ âm thanh là tuỳ chọn, mặc định bật, lỗi ở bước này không làm hỏng job | Người edit thêm caption và nhạc sau | Chèn caption; gợi ý caption bằng AI |
| D11 | **Dùng trên nhiều máy:** cột Trạng thái **bắt buộc**, có khoá dòng | Khách cài trên nhiều thiết bị | Đồng bộ cài đặt qua đám mây |
| D12 | **Dự phòng Gemini API (Omni Flash) có trong app nhưng mặc định TẮT** | Để không phát sinh tiền ngoài ý muốn. Khi Max-Studio hỏng, khách tự quyết có bật dự phòng hay không | Tự động chuyển sang dự phòng (gây mất tiền bất ngờ); bỏ hẳn dự phòng (mất đường lui khi Max-Studio ngừng) |
| D13 | Tạo video nằm sau interface `VideoProvider` | Max-Studio có thể ngừng bất cứ lúc nào; phải thay provider được mà không sửa phần còn lại | Gắn chặt vào một dịch vụ |
| D14 | **Mỗi máy tự dán token Flow** và lưu mã hoá trên máy đó. Token không bao giờ rời máy, ngoài việc gửi tới Max-Studio | Token Flow là bí mật nhạy cảm nhất (mục 10); để ở chỗ dùng chung là ai xem được chỗ đó cũng cầm được tài khoản Flow | **Chia sẻ token qua sheet** (token nằm dạng chữ thường, ai có quyền xem sheet đều đọc được); đồng bộ qua đám mây (không có server, D1) |

---

## 4. Kiến trúc tổng quan

```
┌──────────────────────── App Electron trên máy Windows ────────────────────────┐
│                                                                                │
│  Renderer (React UI)                      Main process (Node)                  │
│  ─ Trình hướng dẫn cài đặt    ◄──IPC──►   ─ JobQueue (SQLite, chạy song song)   │
│  ─ Ánh xạ cột                             ─ VideoProvider                      │
│  ─ Chọn dòng + xem trước                     ├ MaxStudioProvider (chính)       │
│  ─ Tiến độ lô                                └ GeminiOmniProvider (dự phòng)   │
│  ─ Cài đặt (key, token Flow)              ─ GoogleClient: OAuth, Sheets, Drive │
│                                           ─ AudioStripper: ffmpeg-static (-an) │
│                                           ─ SecretStore: Electron safeStorage  │
│                                           ─ Tray, thông báo, powerSaveBlocker  │
│                                           ─ Updater: electron-updater          │
└──────────────────────────────────────────┬─────────────────────────────────────┘
                                           │ HTTPS
     ┌──────────────────────┬──────────────┼───────────────────┬──────────────────┐
     ▼                      ▼              ▼                   ▼                  │
  Max-Studio API      Gemini API      Google Sheets API   Google Drive API        │
  (X-API-Key +        (dự phòng,      (tài khoản dữ liệu, (tài khoản dữ liệu,     │
   token Flow)         mặc định tắt)   OAuth)              OAuth)                 │
     │                                                                            │
     ▼                                                                            │
  Google Flow / Veo 3 (tài khoản Flow, tiêu credit Flow)                          │
```

Nguyên tắc:
- **Mọi lệnh gọi mạng và mọi bí mật chỉ nằm trong main process.** Renderer không bao giờ cầm key hay token.
- **Không có server riêng.** Trạng thái nằm trong SQLite trên máy, cộng với cột Trạng thái trong sheet (dùng để phối hợp giữa các máy).
- **Tài khoản Flow và tài khoản dữ liệu tách biệt** (D7). Token Flow không bao giờ được dùng để truy cập Sheets hay Drive.

---

## 5. Luồng người dùng

### 5.0 Chuẩn bị (làm một lần, **trước Giai đoạn 0**)
> Giai đoạn 0 đã phải giao token Flow thật cho Max-Studio, nên cả 4 bước dưới đây phải xong **trước khi chạy script GĐ0**, không đợi tới lúc bàn giao.

1. **Tách tài khoản (D7):** chọn hoặc tạo một Gmail làm **tài khoản dữ liệu**. Chuyển quyền sở hữu, hoặc chia sẻ quyền chỉnh sửa, sheet và thư mục ảnh/video cho tài khoản này. Tài khoản có gói Flow giữ nguyên làm **tài khoản Flow**.
2. Đăng ký **Max-Studio**, mua gói (Starter là đủ), lấy **Max-Studio API key**.
3. Lấy **token Flow** của tài khoản Flow theo hướng dẫn của Max-Studio (cách lấy sẽ chốt ở Giai đoạn 0).
4. Khách **ký xác nhận rủi ro** (mục 13.3).

### 5.1 Lần đầu trên một máy
1. **Cài app:** chạy `MASYS-Video-Setup.exe`. Nếu file chưa ký số, Windows SmartScreen sẽ cảnh báo; bấm *Thông tin thêm → Vẫn chạy*.
2. **Màn hình chào:** hỏi *"Đã có file cấu hình từ máy khác?"*. Có thì nhập file. Đặt **tên máy**.
3. **Trình hướng dẫn cài đặt 4 bước:**
   1. **Nhà cung cấp video:**
      - Nhập **email tài khoản Flow** (bắt buộc). Email này không phải bí mật, chỉ dùng để so với tài khoản Google ở bước 3 và được lưu trong file cấu hình xuất ra.
      - **Mục tiêu: khách chỉ dán Max-Studio API key.** Nếu Giai đoạn 0 xác nhận Max-Studio giữ liên kết với tài khoản Flow phía họ, bỏ hẳn ô token Flow (và D14 không còn áp dụng). Chỉ khi bắt buộc mới hiện thêm ô token Flow.
      - Dán **Max-Studio API key** (và **token Flow** nếu bắt buộc), rồi bấm **Kiểm tra**. App gọi một lệnh không tạo video; nếu Max-Studio không có lệnh như vậy thì kiểm tra số dư (chốt ở Giai đoạn 0).
      - App hiện số dư credit Max-Studio và trạng thái token.
      - Phía dưới, trong phần "Nâng cao", có ô **Gemini API key (dự phòng, tính tiền)**, có thể bỏ trống.
   2. **Mặc định:** bỏ âm thanh (bật), số job song song (mặc định 2, tối đa theo gói Max-Studio), **hạn mức credit mỗi ngày**.
   3. **Kết nối Google:** app mở trình duyệt mặc định. Màn hình nhắc **đăng nhập bằng tài khoản dữ liệu, KHÔNG dùng tài khoản Flow**. Nếu email kết nối trùng với email tài khoản Flow đã nhập ở bước 1 (so không phân biệt hoa thường), app hiện **cảnh báo đỏ** và yêu cầu xác nhận lần nữa mới cho đi tiếp. Bấm qua cảnh báo *"chưa xác minh"*: *Nâng cao → Đi tới app → Cho phép*.
   4. **Thư mục Drive lưu video:** dán link thư mục có sẵn, hoặc bấm "Tạo thư mục mới". App thử ghi để kiểm tra quyền.
4. **Ánh xạ cột (mỗi sheet một lần):** dán link sheet, kiểm tra **quyền sửa**, chọn tab, xác nhận các cột Ảnh, Prompt, URL video, Trạng thái, rồi lưu.
5. **Chạy thử 1 dòng (app khuyến nghị):** chọn dòng 5, chạy, xem video trong app, bấm **"Mở sheet tại ô D5"** để kiểm tra.

### 5.2 Dùng hằng ngày
Mở app → chọn dòng → xem trước (dòng lỗi, dòng đã có video — **mặc định bỏ qua**, dòng máy khác đang tạo, **số credit sẽ dùng và số dư còn lại**) → **Chạy** → thu nhỏ xuống khay → Windows hiện thông báo khi xong lô.

### 5.3 Tình huống đặc biệt
- **Token Flow hết hạn:** app **tạm dừng cả hàng đợi** và hiện thông báo Windows *"Token Flow hết hạn, hãy cập nhật"*. Dán token mới vào Cài đặt là chạy tiếp, không mất job.
- **Hết credit (Max-Studio hoặc Flow):** tạm dừng và báo rõ loại credit nào đã hết.
- **Max-Studio lỗi hoặc ngừng hoạt động:** job chuyển sang `provider_error`. App gợi ý: *"Thử lại sau"* hoặc *"Bật dự phòng Gemini API (tính khoảng $1/video)"*. **Không bao giờ tự bật dự phòng.**
- **Tắt app hoặc mất điện:** mở lại, app đề nghị chạy tiếp các dòng còn lại. Job đã gửi sang Max-Studio thì **hỏi lại theo `taskid` đã lưu**, không gửi lại để tránh tiêu credit hai lần.
- **Mất kết nối Google (tài khoản dữ liệu):** dừng các job đang chờ, báo *"Kết nối lại Google"*.

---

## 6. Đặc tả chức năng

**F1. Kết nối Google Sheet** (bằng tài khoản dữ liệu)
- Dán link sheet; app đọc danh sách tab.
- Tài khoản dữ liệu phải có **quyền chỉnh sửa** sheet và quyền xem ảnh.
- Thiếu quyền thì báo rõ thiếu quyền gì, ở file nào.

**F2. Ánh xạ cột**
- 4 cột: **Ảnh** (vào: link Drive hoặc link ảnh công khai), **Prompt** (vào), **URL video** (ra), **Trạng thái** (ra, **bắt buộc**).
- Chọn dòng tiêu đề (mặc định là dòng 1). Lưu theo `(spreadsheetId, tab)`.

**F3. Chọn dòng và xem trước**
- Cách chọn: gõ khoảng dòng (`5`, `2-3, 7, 10-12`), tích chọn, hoặc "Chọn các dòng chưa có URL video".
- **Đọc lại sheet ngay trước khi hiện bảng xem trước.**
- Dòng không được chạy: thiếu ảnh, thiếu prompt, link ảnh hỏng, hoặc đang bị máy khác khoá (khoá chưa quá 30 phút).
- Dòng đã có link video: **mặc định bỏ qua**, hiện trong bảng xem trước là *"Đã có video — bỏ qua"* và không tạo job. Muốn tạo lại thì người dùng tích **"Ghi đè"** cho từng dòng đó.
- Hiện số video, **số credit ước tính** và **số dư credit Max-Studio**. Chặn chạy nếu số dư không đủ hoặc vượt hạn mức ngày.

**F4. Đồng bộ đúng dòng (yêu cầu cốt lõi)**
- Mỗi job lưu cố định: `spreadsheetId`, `tab`, `rowNumber`, `outputCell`, `statusCell`, `inputSnapshot` (link ảnh và prompt lúc tạo job).
- **Mỗi lần chỉ ghi một ô** (`values.update` cho đúng một ô).
- **Trước khi ghi kết quả:** đọc lại dòng N. Nếu khác `inputSnapshot` thì **không ghi**; job chuyển sang `row_mismatch`, giữ link Drive trong app để người dùng tự chọn ô.
- **Khoá dòng giữa nhiều máy:**
  1. Ghi `Đang tạo (<tên máy>) <thời gian ISO>` vào ô Trạng thái.
  2. Đợi 2 giây rồi đọc lại.
  3. Ô vẫn ghi tên máy mình thì chạy; nếu không thì `skipped_locked`.
  4. Khoá quá 30 phút coi như bị bỏ dở.
  5. **Ngay trước bước 1**, đọc lại ô đầu ra. Nếu ô đã có link video (ví dụ máy khác vừa làm xong dòng này sau khi mình xem trước) và job không bật "Ghi đè" thì **không khoá, không tạo video**; job chuyển sang `skipped_has_video`.

**F5. Tạo video**
- **Provider chính: `MaxStudioProvider`** (chi tiết ở mục 8.1):
  - Tạo task image-to-video với `ratio: "9:16"`, nhận `taskid`, **lưu `taskid` vào SQLite ngay**.
  - Hỏi trạng thái định kỳ (mỗi 10–15 giây; chốt ở Giai đoạn 0) đến khi xong, rồi tải file video.
  - Thêm "No dialogue, no music." vào cuối prompt nếu Giai đoạn 0 cho thấy model tự sinh âm thanh.
- **Số job song song:** mặc định 2, không vượt giới hạn gói Max-Studio (Starter là 5).
- **Phân loại lỗi** (bảng mã lỗi cụ thể chốt ở Giai đoạn 0):

  | Loại lỗi | App xử lý |
  |---|---|
  | Lỗi tạm thời (mất mạng, 5xx, quá tải) | Thử lại tối đa 3 lần, chờ lâu dần |
  | Token Flow hết hạn hoặc không hợp lệ | **Tạm dừng cả hàng đợi**, báo cập nhật token |
  | Hết credit Max-Studio hoặc credit Flow | Tạm dừng hàng đợi, báo rõ loại credit |
  | Nội dung bị chặn | Không thử lại, ghi `Lỗi: nội dung bị chặn` vào ô Trạng thái |
  | Max-Studio không phản hồi hoặc ngừng dịch vụ | `provider_error`; gợi ý bật dự phòng (không tự bật) |

- **Provider dự phòng: `GeminiOmniProvider`** (mục 8.2), chỉ chạy khi người dùng **chủ động bật** cho một lô và đã nhập Gemini API key. Trước khi chạy, app hiện cảnh báo chi phí (khoảng $1/video).

**F6. Lưu lên Drive và ghi link** (bằng tài khoản dữ liệu)
- Lưu tạm trong `%APPDATA%\MASYS-Video\tmp`, rồi upload resumable vào `<thư mục gốc>/<tên sheet>/<YYYY-MM-DD>/row<N>_<HHmm>.mp4`.
- Đặt quyền **"Ai có link đều xem được"**, rồi ghi `webViewLink` vào ô đầu ra.
- Upload xong thì xoá bản tạm; lỗi thì giữ bản tạm và thử lại.
- Tuỳ chọn: giữ thêm một bản trên máy (mặc định tắt).
- Nếu Max-Studio trả về link video có hạn dùng, app phải tải về **ngay khi task xong**.

**F7. Bỏ âm thanh**
- Bật thì chạy `ffmpeg -i in.mp4 -c:v copy -an out.mp4`.
- Bước này lỗi thì upload video gốc. **Không coi là job lỗi.**

**F8. Tiến độ và credit**
- Màn hình tiến độ hiện từng dòng, có nút tạm dừng, huỷ và "Mở ô".
- **Theo dõi credit thay cho theo dõi tiền:**
  - Credit Max-Studio đã dùng mỗi ngày và mỗi tháng, cùng số dư (lấy từ trường `balance` trong phản hồi).
  - Credit Flow ước tính, nếu Giai đoạn 0 đo được tỉ lệ quy đổi.
- **Hạn mức credit mỗi ngày** cho từng máy.
- Riêng khi bật dự phòng Gemini: hiện thêm chi phí USD ước tính.

**F9. Chạy trên máy**
- Có biểu tượng ở khay hệ thống. Đóng cửa sổ khi đang chạy lô thì hỏi thu nhỏ hay dừng.
- `powerSaveBlocker` giữ máy không ngủ khi đang có lô.
- Hàng đợi lưu trong SQLite nên chạy tiếp được sau khi khởi động lại.
- Thông báo Windows khi xong lô, khi token hết hạn, và khi hết credit.
- Tự cập nhật bằng `electron-updater`.
- Nút **"Xuất nhật ký"** tạo file `.zip` không chứa key hay token.

**F10. Dùng trên nhiều máy**
- Mỗi máy tự nhập Max-Studio API key và token Flow, tự kết nối Google. **Mọi máy dùng cùng tài khoản dữ liệu và cùng tài khoản Flow.**
- Xuất/nhập cấu hình (file `.json`, **không chứa bí mật**), có cả email tài khoản Flow.
- **Token Flow (D14):** mỗi máy tự dán token trong Cài đặt. Khi token hết hạn, máy nào gặp lỗi thì máy đó tạm dừng hàng đợi và báo; người dùng dán token mới **trên từng máy**. Không chia sẻ token qua sheet, file cấu hình hay bất kỳ chỗ dùng chung nào.

**F11. Interface provider**
- `VideoProvider.submit(input) → { taskId }`, `poll(taskId) → { state, videoUrl?, error? }`, `download(videoUrl) → bytes`.
- Provider trả kết quả ngay trong một request (Gemini Omni Flash) thì `submit` có thể chạy luôn và trả kết quả.
- Mỗi job lưu `provider` và `providerTaskId`.

---

## 7. Vòng đời một job

```
queued → locking ──(máy khác đang giữ)──► skipped_locked
           │     └─(ô đầu ra đã có link, không bật Ghi đè)──► skipped_has_video
           │
           ▼
      fetching_image ──(ảnh hỏng)──► failed
           │
           ▼
      submitting ──(lỗi tạm thời, CHƯA có taskid: thử lại ≤3)──► submitting
           │
           ▼  (nhận taskid → lưu SQLite ngay)
      polling ──(lỗi tạm thời khi hỏi: HỎI LẠI, không gửi lại task)──► polling
           │   ├─(token hết hạn / hết credit)──► paused_auth / paused_credit (dừng cả hàng đợi)
           │   ├─(nội dung bị chặn)──► failed
           │   └─(dịch vụ ngừng)──► provider_error
           ▼
      downloading
           │
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

- Mỗi lần đổi trạng thái đều ghi vào SQLite **trước khi** làm bước tiếp theo.
- **Job đã có `providerTaskId` thì không bao giờ gửi lại task** (mỗi lần gửi là tiêu credit). Mọi lỗi tạm thời sau thời điểm đó chỉ dẫn tới hỏi lại trạng thái. Token hết hạn hoặc hết credit cũng có thể xảy ra ngay ở `submitting`; khi đó xử lý giống như ở `polling`.
- **Khi khởi động lại:**
  - Job ở `polling` thì **hỏi tiếp bằng `providerTaskId` đã lưu**, không gửi lại.
  - Job ở `submitting` mà chưa có `providerTaskId` thì gửi lại.
  - Job ở `uploading` hoặc sau đó thì dùng file tạm đã có.
- Ô Trạng thái trong sheet chỉ ghi các trạng thái người dùng cần đọc: `Đang tạo (<máy>)`, `Xong`, `Lỗi: <lý do ngắn>`, `Lệch dòng`, `Tạm dừng: token/credit`.

---

## 8. Tích hợp bên ngoài

### 8.1 Max-Studio (provider chính)

> ⚠️ **Tài liệu công khai của Max-Studio còn sơ sài.** Thông tin dưới đây lấy từ trang chủ và trang `/docs` ngày 23/10/2026. Mọi ô ghi **"CHỐT Ở GĐ0"** phải được điền bằng kết quả thử thật ở Giai đoạn 0 trước khi code `MaxStudioProvider`.

| Mục | Đã biết | Còn phải chốt |
|---|---|---|
| Trang | https://max-studio.shop · docs: https://max-studio.shop/docs (mã nguồn `js/docs*.js`) | — |
| Tên miền | **API tạo task:** `https://max-studio.online`. **Tài khoản** (số dư `GET /api/balance`, `GET /api/v1/quota`): `https://max-studio.shop` | — |
| Xác thực | Header `X-API-Key: <Max-Studio API key>` | — |
| 3 phiên bản API | **V1:** gửi JWT tài khoản Flow (`jwt`). **V2:** không cần giấy tờ Flow, Max-Studio dùng tài khoản của họ, chỉ model `Veo_3.1-Lite_Lower_Priority` — **"ảnh thành video" chưa mở** (422). **V3 (đã chọn):** như V1 nhưng gửi **cookie Google Labs** (`cookie`) | Cookie sống bao lâu, lấy thế nào. CHỐT Ở GĐ0 |
| Tạo video (V3) | `POST /api/v3/create-task/image-to-video`, body: `mediaId` (UUID / URL / **base64 data URI**), `prompt`, `ratio` (`PORTRAIT` = 9:16), `model` (mảng; `Veo_3.1-Lite`, `Veo_3.1-Fast`, `Veo_3.1-Quality`, `Omni_Flash`…), `length` (4/6/8; Omni_Flash thêm 10), `resolution` (`720p`/`360p`), `seed?`, `cookie` | Model nào giữ hình in áo tốt nhất. CHỐT Ở GĐ0 |
| Kết quả | Tạo task trả `taskid`, `status: "pending"`, `balance`. Hỏi trạng thái: `GET /api/v3/check-status/{task_id}`; xong khi `status` = `successfully` (lỗi: `failed`/`error`); link video ở `result[].fifeUrl` | Link có hạn dùng không. CHỐT Ở GĐ0 |
| Giá | Starter 199.000đ/tháng (500 lượt/ngày, 5 task song song); Pro 999.000đ; Ultra 2.999.000đ. Có 100 lượt thử miễn phí | Một video trừ bao nhiêu credit Max-Studio và bao nhiêu credit Flow. CHỐT Ở GĐ0 |
| Lỗi | Chưa có tài liệu | Mã lỗi cho token hết hạn, hết credit, nội dung bị chặn, quá tải. CHỐT Ở GĐ0 |

### 8.2 Gemini Omni Flash (dự phòng, mặc định tắt)
- `POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`.
- Body: `model: "gemini-omni-1.1-flash"`; `input` gồm ảnh (base64) và prompt; `response_format: {type: "video", aspect_ratio: "9:16", resolution: "720p"}`.
- Kết quả trả về **trong cùng request** (base64, hoặc `uri` khi video lớn hơn 4MB).
- Giá khoảng $0.10/giây (khoảng $1/video). Không có gói miễn phí.
- Veo 3.1 bản preview trên Gemini API **đã tắt từ 22/10/2026**.
- Tài liệu: https://ai.google.dev/gemini-api/docs/omni

### 8.3 OAuth Google (tài khoản dữ liệu)
- OAuth client loại **Desktop app**, loopback `http://127.0.0.1:<cổng ngẫu nhiên>` kết hợp **PKCE**, mở trình duyệt mặc định.
- Màn hình đồng ý: **External**, chuyển sang **In production** (để Testing thì token hết hạn sau 7 ngày). Chấp nhận cảnh báo *"chưa xác minh"*.
- `access_type=offline`. Scope: `spreadsheets`, `drive.readonly`, `drive.file` (dùng `drive` toàn quyền nếu thư mục video do khách tạo sẵn).

### 8.4 Sheets và Drive
- Thư viện `googleapis`.
- Đọc bằng `values.get`. Ghi **1 ô** bằng `values.update` với `RAW`.
- Ảnh: lấy file ID từ link Drive rồi gọi `files.get?alt=media`; link khác thì HTTP GET thường.
- Video: `files.create` (upload resumable) → `permissions.create {reader, anyone}` → `webViewLink`.

---

## 9. Dữ liệu (SQLite tại `%APPDATA%\MASYS-Video\app.db`)

| Bảng | Các trường chính |
|---|---|
| `settings` | `machineName`, `flowAccountEmail`, `primaryProvider` (`maxstudio`), `fallbackEnabled` (mặc định `false`), `stripAudio`, `concurrency`, `dailyCreditLimit`, `driveRootFolderId`, `localCopyDir?` |
| `sheet_configs` | `spreadsheetId`, `tab`, `headerRow`, `colImage`, `colPrompt`, `colVideoUrl`, `colStatus`, `updatedAt` |
| `batches` | `id`, `spreadsheetId`, `tab`, `rowsSpec`, `provider`, `status`, `createdAt` |
| `jobs` | `id`, `batchId`, `rowNumber`, `outputCell`, `statusCell`, `inputSnapshot` (JSON), `overwrite`, `state`, `attempts`, `error`, `provider`, `providerTaskId`, `tmpPath`, `driveFileId`, `driveLink`, `audioStripped`, `creditsUsed`, `costUsd?`, `updatedAt` |
| `usage_daily` | `date`, `provider`, `videos`, `creditsUsed`, `costUsd?`, `lastBalance` |

**Bí mật** gồm Max-Studio API key, token Flow, refresh token Google và Gemini API key (nếu có). **Không lưu dạng chữ thường trong DB**; chúng được mã hoá bằng `safeStorage` (DPAPI của Windows).

---

## 10. Bảo mật
- Key và token chỉ có trong main process, được mã hoá khi lưu. Giao diện chỉ hiện 4 ký tự cuối.
- **Token/cookie Flow là bí mật nhạy cảm nhất.** Cookie Google Labs (V3) gần như là cả phiên đăng nhập Google của tài khoản Flow, nên còn nhạy cảm hơn JWT. Vì vậy:
  - Chỉ gửi token tới Max-Studio, không gửi đi đâu khác, và không bao giờ ghi vào nhật ký.
  - Có nút **"Xoá token"** trong Cài đặt.
  - Hướng dẫn bàn giao ghi rõ cách **thu hồi token** (đăng xuất mọi phiên của tài khoản Flow, đổi mật khẩu) khi nghi bị lộ hoặc khi ngừng dùng Max-Studio.
- Nhật ký phải che các header `X-API-Key`, `x-goog-api-key`, `Authorization` và mọi trường chứa token.
- File cấu hình xuất ra **không chứa** bí mật.
- Không commit key vào repo; dùng `.env` khi dev.

---

## 11. Ngoài phạm vi MVP
- macOS, Windows 32-bit, web, điện thoại.
- Đăng nhập trong app, phân quyền, đồng bộ cài đặt qua đám mây.
- Caption, chữ, logo, nhạc, edit video.
- Tự tạo ảnh người mẫu (dù Max-Studio có model tạo ảnh); tự đăng TikTok.
- Tự viết bot hoặc tự gọi API nội bộ của Flow (đã giao cho Max-Studio).
- Provider useapi.net và Meta Muse (chỉ làm nếu Max-Studio không đạt hoặc ngừng dịch vụ).
- Ảnh chèn trực tiếp vào ô sheet.

---

## 12. Tiêu chí hoàn thành
1. Cài `.exe` trên máy **Windows 10** sạch (và thử thêm một máy Windows 11), không phải cài thêm gì.
2. **Một dòng:** dòng 5 → video từ đúng ảnh và prompt dòng 5, link Drive vào đúng ô `[URL video]5`, không ô nào khác bị đổi.
3. **Nhiều dòng:** `2-3` với hai ảnh khác hẳn nhau → mỗi dòng nhận đúng video. Lặp 3 lần, kể cả khi dòng 3 xong trước.
4. **Lô 10 dòng không liên tiếp** (`2-4, 8, 12-17`) → 10 link vào đúng 10 ô.
5. **Lệch dòng:** chèn một dòng mới phía trên khi đang chạy → không ghi nhầm, các job bị ảnh hưởng chuyển sang `row_mismatch`.
6. **Tắt app khi đang chờ Max-Studio:** mở lại → app hỏi tiếp bằng `taskid` đã lưu, **không gửi lại**, không tiêu credit hai lần.
7. **Hai máy cùng lúc:** chạy dòng 2–5 trên 2 máy → mỗi dòng chỉ có 1 video.
8. **Khoá bị bỏ dở:** máy A tắt khi đang tạo dòng 6 → sau 30 phút, máy B chạy được dòng 6.
9. **Token Flow hết hạn giữa lô:** hàng đợi tạm dừng, có thông báo Windows; dán token mới thì chạy tiếp, không mất job, không tạo trùng.
10. **Hết credit:** app chặn từ bước xem trước nếu số dư không đủ; nếu hết giữa lô thì tạm dừng và báo đúng loại credit.
11. **Max-Studio ngừng phản hồi:** job chuyển sang `provider_error`; app **không** tự chuyển sang Gemini.
12. **Bật dự phòng Gemini cho một lô:** app hiện cảnh báo chi phí; video vẫn về đúng ô.
13. **Dòng lỗi** (ảnh hỏng, nội dung bị chặn) → ô Trạng thái đúng dòng ghi lỗi, các dòng khác vẫn xong.
14. **Âm thanh:** bật bỏ âm thanh thì video trên Drive không có track âm thanh; FFmpeg lỗi thì vẫn có link video gốc.
15. Link Drive mở được trên trình duyệt chưa đăng nhập, file nằm đúng thư mục con, vẫn mở được sau 7 ngày.
16. Đóng rồi mở lại app: không phải nhập lại key hay token, không phải kết nối lại Google, ánh xạ cột vẫn còn.
17. Mở DB, file cấu hình và nhật ký bằng công cụ bất kỳ: **không thấy** Max-Studio API key, token Flow, Gemini API key hay token Google ở dạng chữ thường.
18. Kết nối Google bằng chính email tài khoản Flow đã nhập ở bước 3.1 → app hiện cảnh báo đỏ.
19. **Dòng đã có video:** chọn `2-5` khi dòng 3 đã có link → dòng 3 bị bỏ qua, link cũ giữ nguyên, không tiêu credit. Máy A ghi xong dòng 4 trong lúc máy B đang chờ chạy dòng 4 → máy B bỏ qua (`skipped_has_video`).

---

## 13. Bối cảnh tham khảo (đã tìm hiểu, không cần làm lại)

### 13.1 Chi phí

| Đường | Chi phí | Ghi chú |
|---|---|---|
| **Max-Studio (chính)** | **199.000đ/tháng** (gói Starter) + credit Flow có sẵn | Rẻ nhất trong các đường tự động; tỉ lệ credit Flow mỗi video chốt ở GĐ0 |
| Gemini API (dự phòng) | Khoảng $1/video. 5 video/ngày ≈ $120–150/tháng | Có thể bù bằng credit hằng tháng của gói AI Pro (khoảng $10) hoặc $300 dùng thử của Google Cloud mới (chưa xác nhận áp dụng cho Gemini API key) |

Drive miễn phí 15GB chứa được khoảng 1.000–2.000 video.

### 13.2 Vì sao credit Flow không dùng được qua API chính thức
Gói Flow (Google AI Pro/Ultra) **không cấp API key**, và credit Flow chỉ dùng được trên giao diện Flow. Tài liệu của Google ghi quyền lợi của gói *"chỉ áp dụng trong giao diện web AI Studio"*; dùng API thì *"tính tiền riêng"*. Chỉ có dịch vụ bên thứ ba thay mặt tài khoản Flow (như Max-Studio, useapi.net) mới tiêu được credit Flow một cách tự động.

### 13.3 Vì sao chọn Max-Studio dù có rủi ro, và các điều kiện kèm theo
**Lý do chọn:** khách muốn tự động hoàn toàn mà không trả tiền API theo lượt. Max-Studio rẻ (199k/tháng), có API HTTP rõ ràng (tạo task, hỏi trạng thái), có image-to-video và khung 9:16, có 100 lượt thử miễn phí, và là dịch vụ trong nước.

**Rủi ro đã ghi nhận:**
- **Bên vận hành ẩn danh:** không có tên công ty, không có liên hệ trực tiếp, link chính sách bảo mật để trống. Tên miền không thống nhất (`.shop`, `.online`, `autogrok.shop`). Ví dụ trong tài liệu còn lỗi cú pháp.
- **Phải giao token Flow cho họ.** Chưa rõ token đó cho phép làm gì với tài khoản.
- Họ quảng cáo **"vượt mọi captcha"**, tức là chủ động lách cơ chế chống bot của Google. Có thể vi phạm điều khoản và dẫn tới **khoá tài khoản Flow**.
- Có thể ngừng hoạt động bất cứ lúc nào.

**Điều kiện bắt buộc:**
1. Tách tài khoản (D7).
2. Qua được Giai đoạn 0.
3. Giữ dự phòng Gemini trong app (D12).
4. Thanh toán Max-Studio **theo tháng**, không trả trước dài hạn.
5. Khách **ký xác nhận rủi ro** trước khi bàn giao.

### 13.4 Các phương án thay thế (theo thứ tự nếu Max-Studio không đạt)
1. **useapi.net Google Flow API** (`https://api.useapi.net/v1/google-flow`, khoảng $15/tháng, tiêu credit Flow). Bên vận hành minh bạch hơn và tài liệu đầy đủ hơn. Rủi ro tài khoản tương tự.
2. **Gemini API chính thức** làm đường chính (tính tiền theo lượt, an toàn nhất).
3. **Chế độ "trợ lý Flow" bán tự động:** app chuẩn bị sẵn ảnh và prompt; người dùng tự bấm Tạo trên Flow; app bắt file trong thư mục Downloads, upload và ghi link. 0 đồng, không vi phạm gì, nhưng phải có người ngồi bấm.
4. **Meta Muse:** chưa có API video chính thức; chỉ qua useapi.net. Rủi ro khoá chỉ ở tài khoản Meta. Phải test chất lượng hình in trước.

---

## 14. Câu hỏi còn mở
1. **Token Flow sống bao lâu và có tự làm mới được không?** Cách cập nhật cho nhiều máy đã chốt là mỗi máy tự dán (D14), nên token càng sống ngắn thì càng phiền: nếu phải dán lại nhiều lần trong ngày trên mọi máy thì coi như GĐ0 không đạt điểm 1. Đây là câu **quan trọng nhất**, quyết định Max-Studio có dùng được thật hay không. Trả lời ở GĐ0.
2. **Ai đăng ký tài khoản Max-Studio và lấy token Flow** để chạy GĐ0: người làm app hay khách?
3. **Tài khoản dữ liệu** là Gmail nào? Ai chuyển hoặc chia sẻ sheet và thư mục Drive sang tài khoản đó?
4. Mỗi video trừ bao nhiêu credit Flow? Số credit hiện có đủ dùng bao lâu, và khi hết thì khách gia hạn gói Flow thế nào? (Trả lời ở GĐ0.)
5. Xin **1 sheet mẫu thật** để chốt cột và nơi lưu ảnh.
6. ~~Dòng đã có link video: mặc định bỏ qua hay ghi đè?~~ **Đã chốt (v2.3): mặc định bỏ qua**, ghi đè phải tích riêng từng dòng.
7. Có cần giữ thêm bản video trên máy cho người edit không?
8. Khách chấp nhận cảnh báo SmartScreen, hay muốn mua chứng chỉ ký số?
9. Cần báo khách: áo dùng nhân vật có bản quyền dễ bị TikTok Shop gỡ; TikTok yêu cầu gắn nhãn nội dung do AI tạo.

---

## 15. Thứ tự build

### Giai đoạn 0 — Kiểm chứng Max-Studio (bắt buộc, trước khi viết app)
**Điều kiện trước khi bắt đầu:** đã xong cả 4 bước ở mục 5.0 (tách tài khoản, có Max-Studio API key, có token Flow, khách đã ký xác nhận rủi ro).

Viết **một script Node nhỏ**, dùng 100 lượt thử miễn phí, rồi điền kết quả vào mục 8.1:

| # | Kiểm tra | Điều kiện đạt |
|---|---|---|
| 0 | **Chỉ dùng Max-Studio API key có tạo được video không** (tài khoản Flow liên kết sẵn phía Max-Studio, request không cần gửi token) | ✅ Đã thử 23/10/2026: **KHÔNG** — V2 trả 422, không trừ credit. Chuyển sang V3 (cookie Flow), làm tiếp điểm 1 |
| 1 | Cách lấy token Flow; token sống bao lâu; có tự làm mới được không | Không phải dán lại token nhiều lần trong ngày |
| 2 | Endpoint image-to-video, cách gửi ảnh, khung 9:16 | Tạo được video dọc 9:16 từ ảnh |
| 3 | Hỏi trạng thái theo `taskid`; link video có hạn dùng không | Tải được `.mp4` |
| 4 | Thời gian tạo một video | Dưới khoảng 5 phút |
| 5 | **Chất lượng: giữ mặt người mẫu và hình in áo**, thử 3–5 ảnh thật | Ít nhất 4/5 đạt |
| 6 | Credit Max-Studio và credit Flow bị trừ cho mỗi video | Đo được con số |
| 7 | Mã lỗi: token hết hạn, hết credit, nội dung bị chặn, quá tải | Phân biệt được từng loại |
| 8 | Chạy 5 video song song | Không bị chặn hay captcha |

**Đạt đủ các điểm** thì chốt D3 và đi tiếp. **Không đạt** thì chuyển sang phương án 13.4 theo thứ tự, và cập nhật spec trước khi build.

### Giai đoạn 1 — Build app
1. **Google:** OAuth Desktop với PKCE (tài khoản dữ liệu); đọc đúng dòng N, ghi đúng 1 ô ở dòng N (thử với dữ liệu giả).
2. **Drive:** upload resumable, đặt quyền link, ghi link vào sheet.
3. **`MaxStudioProvider`** theo kết quả GĐ0, kèm phân loại lỗi.
4. **Hàng đợi:** SQLite, chạy song song, thử lại, lưu `providerTaskId` để chạy tiếp, khoá dòng, kiểm tra lệch dòng, tạm dừng khi token hoặc credit có vấn đề.
5. **Bỏ âm thanh** bằng `ffmpeg-static`.
6. **Giao diện:** trình hướng dẫn cài đặt (Max-Studio key, token Flow, cảnh báo trùng tài khoản), ánh xạ cột, xem trước kèm số credit, tiến độ, khay hệ thống, thông báo.
7. **`GeminiOmniProvider`** (dự phòng, mặc định tắt) và cảnh báo chi phí khi bật.
8. `safeStorage`, theo dõi credit, xuất/nhập cấu hình, xuất nhật ký.
9. **Đóng gói** `.exe`, tự cập nhật, thử trên máy Windows 10 sạch, rồi bàn giao kèm hướng dẫn tách tài khoản, lấy và thu hồi token, và văn bản xác nhận rủi ro.
