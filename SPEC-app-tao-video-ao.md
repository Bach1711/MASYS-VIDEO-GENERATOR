# MASYS Video Generator — Đặc tả sản phẩm (MVP, bản web)

> Phiên bản 3.0 · 23/10/2026 · Trạng thái: **viết lại spec cho bản web; chưa có code**
> **Thay đổi lớn so với 2.8: chuyển từ app Electron cài trên Windows sang WEB APP CÓ SERVER** (Next.js + Supabase + worker chạy nền). Người dùng chỉ mở trình duyệt; lô vẫn chạy khi đóng tab. **Không đăng nhập tài khoản**; trang được bảo vệ bằng một **mã truy cập chung** (D9 — chờ xác nhận). Các quyết định về provider của v2.8 giữ nguyên: Gemini API là provider chính tạm thời, trang "Nhà cung cấp video" có nhiều ô key (D15), Meta Muse làm song song, Max-Studio tạm gác.
> Lịch sử 2.0–2.8 (bản Electron) xem trong git. Những phần bản Electron đã bỏ: file cài `.exe`, SmartScreen, khay hệ thống, `safeStorage`, SQLite trên máy, tên máy, khoá dòng giữa nhiều máy qua sheet, xuất/nhập cấu hình, tự cập nhật.
> Tài liệu này viết để một người hoặc agent mới đọc **một lần là nắm được toàn bộ dự án**: làm gì, vì sao, đã chốt gì, còn gì chưa chốt, build theo thứ tự nào.

---

## 0. Tóm tắt trong 30 giây

- **Sản phẩm:** **web app** đọc ảnh người mẫu và prompt từ **Google Sheet**, tạo video thử áo dọc 9:16 bằng **nhà cung cấp video người dùng chọn** (chính: **Gemini API — Omni Flash**; Max-Studio và Meta Muse gắn thêm qua cùng interface), **upload video lên Google Drive**, rồi **ghi link Drive vào đúng ô** của đúng dòng trong sheet.
- **Khách hàng:** một chủ kênh TikTok bán áo thun dùng người mẫu AI. Đội của họ dùng trên **nhiều máy**, khoảng **5–20 video/ngày**.
- **Yêu cầu cốt lõi:** **đọc dòng N thì ghi về dòng N**, kể cả khi chạy nhiều dòng song song hoặc nhiều người bấm Chạy cùng lúc.
- **Chạy ở đâu:** giao diện trên trình duyệt; việc tạo video, upload, ghi sheet do **worker trên server** làm. **Đóng tab hay tắt máy, lô vẫn chạy tiếp.**
- **Không làm:** caption, nhạc, edit video, tự đăng TikTok, tự tạo ảnh người mẫu, app cài trên máy, app điện thoại.
- **Chi phí vận hành:** Gemini khoảng **$1/video** (5–20 video/ngày ≈ $150–600/tháng) + hosting khoảng **$0–50/tháng** (mục 13.1).

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
Thay toàn bộ phần làm tay ở 1.1 bằng: **mở web → chọn dòng → bấm Chạy → link video tự xuất hiện trong sheet**.

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
| **Khoá dòng** | Trong DB, mỗi `(sheet, tab, dòng)` chỉ có tối đa **một job đang chạy**. Ô Trạng thái ghi `Đang tạo` để người xem sheet biết |
| **Lệch dòng** | Dữ liệu ở dòng N đã bị đổi (do chèn, xoá hoặc sắp xếp dòng) trong lúc job đang chạy |
| **Worker** | Tiến trình Node chạy nền trên server, lấy job từ DB và làm: tạo video → tải về → bỏ âm thanh → upload Drive → ghi sheet |
| **Mã truy cập** | Một mật khẩu chung cho cả đội để mở web (D9). Không có tài khoản riêng từng người |
| **Tên người chạy** | Tên tự gõ (lưu trong trình duyệt) gắn vào mỗi lô để biết ai đã chạy; không phải tài khoản |
| **Provider** | Dịch vụ tạo video đứng sau interface `VideoProvider`. Chính: `GeminiOmniProvider`. Song song: `MuseProvider`. Tạm gác: `MaxStudioProvider` |
| **Max-Studio** | Dịch vụ API bên thứ ba (max-studio.shop), thay mặt tài khoản Flow của khách để gọi Veo 3. Tạm gác |
| **Cookie Flow** | Giấy tờ của **tài khoản Flow** gửi kèm request tới Max-Studio (API V3). Bí mật nhạy cảm nhất |
| **Tài khoản Flow** | Tài khoản Google có gói Flow. Chỉ dùng cho việc tạo video qua Max-Studio |
| **Tài khoản dữ liệu** | Tài khoản Gmail mà server kết nối bằng OAuth để đọc sheet và upload Drive. **Phải khác tài khoản Flow** (D7) |

---

## 3. Các quyết định đã chốt

> Không mở lại các quyết định dưới đây nếu chưa hỏi người phụ trách.

| # | Quyết định | Lý do | Phương án đã loại |
|---|---|---|---|
| D1 | **(v3.0) Web app có server:** Next.js (giao diện + API) + Supabase (Postgres) + **worker chạy nền** | Không phải cài đặt trên từng máy; lô chạy tiếp khi đóng tab; nhiều người dùng chung một hàng đợi | App Electron cài trên Windows (bản 2.x); web chạy hoàn toàn trong trình duyệt (phải giữ tab mở, key nằm ở từng máy) |
| D2 | Dùng trên **Chrome/Edge bản mới** (máy tính); điện thoại xem được tiến độ nhưng không tối ưu | Đội dùng PC | App điện thoại |
| D3 | **Provider chính tạm thời: Gemini API chính thức** (`gemini-omni-1.1-flash`, khoảng $1/video). Chốt sau khi Giai đoạn 0 (Gemini) đạt. Max-Studio **tạm gác** | Max-Studio không tạo được video (V2 422, V3/V1 lỗi 5099, endpoint cookie→JWT của Google trả 410). Gemini là API chính thức: không giao cookie cho bên thứ ba, không rủi ro khoá tài khoản. Đánh đổi: tốn tiền theo lượt, không dùng được credit Flow | Chờ Max-Studio; useapi.net; bot tự bấm Flow |
| D4 | **Khách đã có sẵn ảnh người mẫu** (dạng link trong sheet) | Khách yêu cầu | App tự tạo hoặc ghép áo lên người mẫu |
| D5 | Dữ liệu vào và ra qua **Google Sheet**, người dùng **tự chọn cột và dòng** | Khách quản lý mọi thứ trong sheet | Tải ảnh lên tay; file `.xlsx`/`.csv` |
| D6 | Kết quả là **link Google Drive** ghi vào sheet | Khách yêu cầu | Link tạm của nhà cung cấp; Supabase Storage |
| D7 | **Tách tài khoản:** sheet và thư mục Drive nằm ở hoặc được chia sẻ cho **tài khoản dữ liệu**; tài khoản Flow (nếu dùng Max-Studio) chỉ để tạo video | Nếu tài khoản Flow bị khoá, sheet và video vẫn an toàn | Dùng chung một tài khoản |
| D8 | **Server kết nối Google một lần** bằng OAuth (client loại **Web application**) với tài khoản dữ liệu; refresh token lưu mã hoá trong DB, dùng chung cho cả đội | Không có tài khoản người dùng (D9) nên chỉ có một kết nối Google cho toàn web | Service account (không có dung lượng Drive); mỗi người tự kết nối |
| D9 | **Không đăng nhập, không phân quyền.** Một **mã truy cập chung** chặn người lạ (cookie phiên ký bằng secret server, hết hạn sau 30 ngày; sai 5 lần/15 phút thì chặn IP tạm thời). ⚠️ *Mã truy cập là đề xuất bảo vệ tối thiểu — chờ người phụ trách xác nhận (mục 14 câu 1)* | Người phụ trách chọn không đăng nhập. Nhưng server giữ Gemini key và quyền ghi sheet/Drive: không chặn thì ai biết link cũng tiêu tiền và sửa sheet được | Đăng nhập Google + danh sách email; Admin/Thành viên |
| D10 | **Không chèn caption.** Bỏ âm thanh là tuỳ chọn, mặc định bật, lỗi ở bước này không làm hỏng job | Người edit thêm caption và nhạc sau | Chèn caption; gợi ý caption bằng AI |
| D11 | **Hàng đợi và khoá dòng nằm trong Postgres.** Cột Trạng thái **bắt buộc**, dùng để báo tiến độ/lỗi cho người xem sheet | Mọi người dùng chung một server nên khoá trong DB là đủ và chắc chắn hơn khoá qua sheet | Khoá qua ô Trạng thái (bản Electron) |
| D12 | **Không bao giờ tự chuyển nhà cung cấp.** Mỗi lô chạy bằng provider người dùng đã chọn; provider lỗi thì job `provider_error`, app chỉ **gợi ý** đổi. Provider tính tiền luôn hiện **cảnh báo chi phí** trước khi chạy | Tránh mất tiền và gửi dữ liệu tới dịch vụ chưa chọn | Tự động chuyển provider |
| D13 | Tạo video nằm sau interface `VideoProvider` | Thay provider được mà không sửa phần còn lại | Gắn chặt vào một dịch vụ |
| D14 | **(v3.0) Bí mật chỉ nằm trên server**, mã hoá AES-256-GCM trong DB bằng khoá ở biến môi trường. **Không bao giờ gửi về trình duyệt**; giao diện chỉ hiện 4 ký tự cuối | Web không có `safeStorage`; trình duyệt là nơi dễ lộ nhất | Lưu key trong trình duyệt; lưu chữ thường trong DB; chia sẻ qua sheet |
| D15 | **Trang "Nhà cung cấp video" có nhiều ô key**, mỗi provider một thẻ: **Gemini API key** (chính), **Meta Muse** (làm song song), **Max-Studio API key + email/cookie Flow** (tạm gác). Chọn **một provider mặc định**, đổi được cho từng lô. Thẻ của provider chưa sẵn sàng hiện *"Chưa hỗ trợ tạo video"* và không chọn được | Khách muốn thử nhiều nguồn mà không phải sửa app | Một ô key cố định |
| D16 | **(v3.0) Hosting:** Next.js trên **Vercel**, DB trên **Supabase**, worker trên một máy chủ Node chạy liên tục (**Railway/Render/Fly**, có `ffmpeg`) | Gemini trả video trong một request dài 1–3 phút và Max-Studio cần hỏi trạng thái nhiều phút; hàm serverless có giới hạn thời gian nên không hợp để chạy job | Chạy job trong hàm serverless của Vercel; tự thuê VPS |

---

## 4. Kiến trúc tổng quan

```
 Trình duyệt (Chrome/Edge)
   │  mã truy cập → cookie phiên
   ▼
┌─────────────── Next.js trên Vercel ───────────────┐
│ Giao diện: Nhà cung cấp · Google · Ánh xạ cột ·    │
│            Chọn dòng + xem trước · Tiến độ         │
│ API route: lưu key (mã hoá), OAuth Google, đọc     │
│            sheet để xem trước, tạo lô/job          │
└──────────────┬─────────────────────────────────────┘
               │ SQL
               ▼
┌──────── Supabase Postgres ────────┐
│ settings · secrets (mã hoá)       │◄──── Worker (Railway/Render/Fly, Node + ffmpeg)
│ sheet_configs · batches · jobs    │        ├ lấy job: SELECT … FOR UPDATE SKIP LOCKED
│ usage_daily · job_events          │        ├ VideoProvider
└───────────────────────────────────┘        │   ├ GeminiOmniProvider (chính)
                                             │   ├ MuseProvider (song song)
                                             │   └ MaxStudioProvider (tạm gác)
                                             ├ GoogleClient: Sheets, Drive (tài khoản dữ liệu)
                                             └ AudioStripper: ffmpeg -an
                                                     │ HTTPS
              ┌──────────────────┬───────────────────┼───────────────────┐
              ▼                  ▼                   ▼                   ▼
         Gemini API        Max-Studio (gác)   Google Sheets API   Google Drive API
```

Nguyên tắc:
- **Mọi bí mật và mọi lệnh gọi tới provider/Google chỉ nằm ở server** (API route và worker). Trình duyệt không bao giờ cầm key, cookie hay token Google.
- **Trình duyệt không chạy job.** Bấm Chạy chỉ tạo bản ghi `jobs`; worker làm phần còn lại. Giao diện đọc tiến độ từ DB (hỏi lại mỗi 3–5 giây hoặc Supabase Realtime).
- **Một workspace duy nhất:** một bộ cài đặt, một kết nối Google, một bộ key cho cả đội.
- **Tài khoản Flow và tài khoản dữ liệu tách biệt** (D7).

---

## 5. Luồng người dùng

### 5.0 Chuẩn bị (người làm app + khách, làm một lần)
1. **Tài khoản dữ liệu (D7):** chọn hoặc tạo một Gmail; chia sẻ quyền chỉnh sửa sheet và thư mục ảnh/video cho tài khoản này.
2. **Gemini API key** từ một project Google Cloud **đã bật billing** (Omni Flash không có gói miễn phí). Nên đặt **budget alert** trong Google Cloud.
3. **OAuth client loại Web application** trên Google Cloud: redirect URI `https://<tên miền>/api/google/callback`; màn hình đồng ý **External**, chuyển **In production**.
4. Tạo project **Supabase**, tài khoản **Vercel** và **Railway/Render/Fly** cho worker; đặt các biến môi trường (mục 10).
5. Đặt **mã truy cập** và gửi cho đội qua kênh riêng.

### 5.1 Lần đầu dùng web
1. Mở link web → nhập **mã truy cập** → gõ **tên người chạy** (lưu trong trình duyệt).
2. **Trình hướng dẫn cài đặt 4 bước** (chỉ cần làm một lần cho cả đội; ai vào sau thấy đã cài sẵn):
   1. **Nhà cung cấp video (D15):** mỗi provider một thẻ, điền ít nhất một thẻ, chọn **provider mặc định**:
      - **Gemini API (mặc định):** dán **Gemini API key** → **Kiểm tra** (gọi lệnh liệt kê model, không tạo video, không tốn tiền). Hiện dòng nhắc *"Tính tiền theo lượt, khoảng $1/video"*.
      - **Meta Muse:** ô key theo mục 8.5. Chưa có đường gọi API video đã duyệt thì hiện *"Chưa hỗ trợ tạo video"*.
      - **Max-Studio (tạm gác):** ẩn sau *"Hiện thêm nhà cung cấp"*: Max-Studio API key, **email tài khoản Flow**, cookie Flow.
   2. **Mặc định:** bỏ âm thanh (bật), số job song song (mặc định 2), **hạn mức mỗi ngày** (số video và USD).
   3. **Kết nối Google:** chuyển sang trang đăng nhập Google. Màn hình nhắc **đăng nhập bằng tài khoản dữ liệu, KHÔNG dùng tài khoản Flow**. Nếu email trùng email tài khoản Flow đã nhập, hiện **cảnh báo đỏ** và yêu cầu xác nhận lần nữa. Bấm qua cảnh báo *"chưa xác minh"*: *Nâng cao → Đi tới app → Cho phép*.
   4. **Thư mục Drive lưu video:** dán link thư mục có sẵn, hoặc bấm "Tạo thư mục mới". Server thử ghi để kiểm tra quyền.
3. **Ánh xạ cột (mỗi sheet một lần):** dán link sheet, kiểm tra **quyền sửa**, chọn tab, xác nhận các cột Ảnh, Prompt, URL video, Trạng thái, rồi lưu.
4. **Chạy thử 1 dòng (khuyến nghị):** chọn dòng 5, chạy, xem video ngay trên web, bấm **"Mở sheet tại ô D5"** để kiểm tra.

### 5.2 Dùng hằng ngày
Mở web → chọn sheet → chọn dòng → xem trước (dòng lỗi, dòng đã có video — **mặc định bỏ qua**, dòng đang có job chạy, provider sẽ dùng, **chi phí ước tính**) → **Chạy** → có thể đóng tab. Mở lại bất cứ lúc nào để xem tiến độ; web báo khi xong lô (thông báo trình duyệt nếu tab còn mở).

### 5.3 Tình huống đặc biệt
- **Provider đang dùng lỗi hoặc ngừng hoạt động:** job chuyển sang `provider_error`. Web gợi ý *"Thử lại sau"* hoặc *"Chạy lại bằng provider khác"* (kèm cảnh báo chi phí). **Không bao giờ tự chuyển provider (D12).**
- **Gemini API key sai, bị thu hồi hoặc project hết quota/billing:** tạm dừng cả hàng đợi, hiện banner *"Kiểm tra Gemini API key / billing"*.
- **Vượt hạn mức USD ngày:** chặn từ bước xem trước; nếu chạm hạn mức giữa lô thì các job chưa gửi chuyển `paused_limit`.
- **Worker khởi động lại (deploy, lỗi):** job đang chạy được nhận lại khi hết hạn thuê (mục 7). Job đã có `providerTaskId` thì **hỏi lại theo mã đó**, không gửi lại.
- **Mất kết nối Google (refresh token bị thu hồi):** tạm dừng các job đang chờ, banner *"Kết nối lại Google"*.
- **Hai người chọn trùng dòng:** người bấm sau thấy dòng đó là *"Đang có job chạy"* trong xem trước và không tạo job trùng (khoá trong DB).

---

## 6. Đặc tả chức năng

**F0. Mã truy cập và tên người chạy (D9)**
- Trang nhập mã. Đúng thì server đặt cookie phiên `HttpOnly; Secure; SameSite=Lax`, ký bằng `SESSION_SECRET`, hết hạn 30 ngày.
- Mọi trang và API route (trừ trang nhập mã và callback OAuth) đều kiểm tra cookie.
- Sai 5 lần trong 15 phút từ một IP → chặn IP đó 15 phút.
- Đổi mã truy cập trong Cài đặt → mọi phiên cũ hết hiệu lực.
- **Tên người chạy** lưu ở `localStorage`, gửi kèm khi tạo lô, hiện trong lịch sử. Không phải xác thực.

**F1. Kết nối Google Sheet** (bằng tài khoản dữ liệu)
- Dán link sheet; server đọc danh sách tab.
- Tài khoản dữ liệu phải có **quyền chỉnh sửa** sheet và quyền xem ảnh.
- Thiếu quyền thì báo rõ thiếu quyền gì, ở file nào, chia sẻ cho email nào.

**F2. Ánh xạ cột**
- 4 cột: **Ảnh** (vào: link Drive hoặc link ảnh công khai), **Prompt** (vào), **URL video** (ra), **Trạng thái** (ra, **bắt buộc**).
- Chọn dòng tiêu đề (mặc định là dòng 1). Hiện 5 dòng đầu, tự đoán cột theo tiêu đề. Lưu theo `(spreadsheetId, tab)`.

**F3. Chọn dòng và xem trước**
- Cách chọn: gõ khoảng dòng (`5`, `2-3, 7, 10-12`), tích chọn, hoặc "Chọn các dòng chưa có URL video".
- **Đọc lại sheet ngay trước khi hiện bảng xem trước.**
- Dòng không được chạy: thiếu ảnh, thiếu prompt, link ảnh hỏng, hoặc **đang có job chạy** (khoá trong DB).
- Dòng đã có link video: **mặc định bỏ qua**, hiện *"Đã có video — bỏ qua"*. Muốn tạo lại thì tích **"Ghi đè"** cho từng dòng.
- Hiện số video, provider của lô và **chi phí ước tính** (USD với Gemini; credit với Max-Studio). Chặn chạy nếu vượt hạn mức ngày.
- Bấm **Chạy** → tạo `batch` + các `jobs` trong **một transaction**; dòng nào vừa bị người khác tạo job thì bỏ qua và báo lại.

**F4. Đồng bộ đúng dòng (yêu cầu cốt lõi)**
- Mỗi job lưu cố định: `spreadsheetId`, `tab`, `rowNumber`, `outputCell`, `statusCell`, `inputSnapshot` (link ảnh và prompt lúc tạo job).
- **Mỗi lần chỉ ghi một ô** (`values.update` cho đúng một ô, `RAW`).
- **Trước mỗi lần ghi** (Trạng thái lẫn link): đọc lại dòng N. Khác `inputSnapshot` thì **không ghi**; job chuyển sang `row_mismatch`, giữ link Drive trên web để người dùng tự chọn ô.
- **Khoá dòng (D11):** ràng buộc duy nhất trong DB — mỗi `(spreadsheetId, tab, rowNumber)` có tối đa một job ở trạng thái chưa kết thúc.
- **Ngay trước khi gửi sang provider**, đọc lại ô đầu ra. Đã có link (ví dụ có người dán tay) và job không bật "Ghi đè" → **không tạo video**; job chuyển `skipped_has_video`.

**F5. Tạo video**
- **Provider chính: `GeminiOmniProvider`** (mục 8.2). Kết quả trả về trong cùng request nên `submit` trả luôn video. Trước khi gửi, worker lưu `submittedAt`; nếu worker chết giữa request thì **không tự gửi lại** — job chuyển `failed` với lý do *"Không rõ đã tạo hay chưa — kiểm tra rồi chạy lại"* (tránh tính tiền hai lần).
  - Lỗi: 400 (ảnh/prompt sai) → `failed`; 401/403 → tạm dừng hàng đợi, báo key; 429 → chờ rồi thử lại; nội dung bị chặn → `failed`; 5xx trả về rõ ràng → thử lại tối đa 3 lần. Chi tiết chốt ở Giai đoạn 0.
- **`MuseProvider`** (mục 8.5): làm song song; chỉ bật khi có đường gọi API video đã được duyệt.
- **`MaxStudioProvider`** (mục 8.1, tạm gác): tạo task, **lưu `taskid` ngay**, hỏi trạng thái mỗi 10–15 giây, lỗi khi hỏi thì hỏi lại, không gửi lại task.
- **Số job song song:** mặc định 2, cài được; worker không chạy quá số này.
- Đổi provider cho một lô là việc **người dùng chủ động chọn** (D12).

**F6. Lưu lên Drive và ghi link** (bằng tài khoản dữ liệu)
- Worker lưu tạm trên đĩa của nó, rồi upload resumable vào `<thư mục gốc>/<tên sheet>/<YYYY-MM-DD>/row<N>_<HHmm>.mp4`.
- Đặt quyền **"Ai có link đều xem được"**, rồi ghi `webViewLink` vào ô đầu ra.
- Upload xong thì xoá bản tạm; lỗi thì thử lại (tối đa 3 lần). Bản tạm mất (worker khởi động lại) thì job `failed` với lý do rõ, **không** tạo lại video tự động.

**F7. Bỏ âm thanh**
- Bật thì worker chạy `ffmpeg -i in.mp4 -c:v copy -an out.mp4`.
- Bước này lỗi thì upload video gốc. **Không coi là job lỗi.**

**F8. Tiến độ và chi phí**
- Trang tiến độ: từng dòng, trạng thái, nút **Tạm dừng lô**, **Huỷ**, **"Mở ô"**, xem video. Cập nhật mỗi 3–5 giây.
- **Lịch sử lô:** ai chạy (tên người chạy), lúc nào, provider, bao nhiêu video, chi phí.
- **Chi phí USD với Gemini** = số giây video × đơn giá (cài đặt, đo lại ở GĐ0), theo ngày/tháng; **hạn mức USD mỗi ngày** cho cả workspace. Google không trả số dư qua API; chặn cứng thì đặt thêm budget/quota trong Google Cloud.
- Max-Studio (khi gắn lại): credit và số dư lấy từ phản hồi.

**F9. Vận hành**
- Worker ghi log có cấu trúc (không có bí mật); trang **"Nhật ký"** trên web hiện lỗi gần đây của job.
- Banner trên web khi: hàng đợi bị tạm dừng, mất kết nối Google, worker không gửi tín hiệu sống quá 2 phút.
- Thông báo trình duyệt khi xong lô (nếu tab còn mở).

**F10. Interface provider**
- `VideoProvider.submit(input) → { taskId } | { video }`, `poll(taskId) → { state, videoUrl?, error? }`, `download(videoUrl) → bytes`.
- Provider trả kết quả ngay (Gemini) thì `submit` trả luôn `video`.
- Mỗi job lưu `provider` và `providerTaskId`.

---

## 7. Vòng đời một job

```
queued ──(worker nhận, đặt lease)──► checking_row
           │   ├─(ô đầu ra đã có link, không Ghi đè)──► skipped_has_video
           │   └─(ảnh/prompt khác inputSnapshot)──► row_mismatch
           ▼
      fetching_image ──(ảnh hỏng)──► failed
           │
           ▼
      submitting ──(lỗi tạm thời rõ ràng, CHƯA tạo: thử lại ≤3)──► submitting
           │   ├─(key sai / hết quota)──► paused_auth / paused_credit (dừng cả hàng đợi)
           │   ├─(vượt hạn mức USD ngày)──► paused_limit
           │   ├─(nội dung bị chặn)──► failed
           │   └─(dịch vụ ngừng)──► provider_error
           ▼  (Gemini: có video luôn · Max-Studio: nhận taskid → lưu DB → polling)
      polling (chỉ Max-Studio; lỗi khi hỏi: HỎI LẠI, không gửi lại)
           │
           ▼
      downloading → stripping_audio (tuỳ chọn; lỗi thì đi tiếp với video gốc)
           │
           ▼
      uploading ──(lỗi: thử lại ≤3)──► uploading
           │
           ▼
      writing_back ──(lệch dòng)──► row_mismatch
           │
           ▼
         done
```

- **Lấy job:** `SELECT … FOR UPDATE SKIP LOCKED`, đặt `leaseUntil = now + 10 phút`; worker gia hạn lease mỗi phút khi đang làm. Lease hết hạn (worker chết) thì job được nhận lại.
- Mỗi lần đổi trạng thái đều ghi DB **trước khi** làm bước tiếp theo, kèm một dòng `job_events`.
- **Nhận lại job khi lease hết hạn:**
  - `polling` → hỏi tiếp bằng `providerTaskId`, không gửi lại.
  - `submitting` của Gemini mà đã có `submittedAt` → `failed` (*"Không rõ đã tạo hay chưa"*), không gửi lại.
  - `submitting` chưa có `submittedAt`, hoặc các bước trước đó → làm lại từ đầu.
  - `uploading`/`writing_back` mà mất bản tạm → `failed` với lý do rõ.
- Ô Trạng thái trong sheet chỉ ghi các trạng thái người dùng cần đọc: `Đang tạo`, `Xong`, `Lỗi: <lý do ngắn>`, `Lệch dòng`, `Tạm dừng`.

---

## 8. Tích hợp bên ngoài

### 8.1 Max-Studio (tạm gác từ v2.8)

> Kết quả thử 23/10/2026: V2 (chỉ API key) trả 422 *"No active pricing rule"* với ảnh→video; V3 (cookie Flow) và V1 (JWT) đều lỗi 5099; endpoint Google đổi cookie → JWT trả 410. Gắn lại khi Max-Studio sửa xong, sau khi qua lại GĐ0 Max-Studio (mục 15).

| Mục | Đã biết |
|---|---|
| Tên miền | **API tạo task:** `https://max-studio.online`. **Tài khoản** (số dư `GET /api/balance` → `balance_raw`, `GET /api/v1/quota`): `https://max-studio.shop` |
| Xác thực | Header `X-API-Key` |
| Phiên bản | **V1:** gửi JWT tài khoản Flow (`jwt`). **V2:** không cần giấy tờ Flow, chỉ model `Veo_3.1-Lite_Lower_Priority`, ảnh→video chưa mở. **V3:** như V1 nhưng gửi `cookie` Google Labs |
| Tạo video | `POST /api/{v}/create-task/image-to-video`: `mediaId` (UUID / URL / base64 data URI), `prompt`, `ratio` (`PORTRAIT`), `model` (mảng: `Veo_3.1-Lite`, `Veo_3.1-Fast`, `Veo_3.1-Quality`, `Omni_Flash`…), `length` (4/6/8; Omni_Flash thêm 10), `resolution` (`720p`/`360p`), `seed?` |
| Kết quả | Trả `taskid`. `GET /api/{v}/check-status/{task_id}`: xong khi `status` = `successfully` (lỗi: `failed`/`error`); link ở `result[].fifeUrl` |
| Giá | Starter 199.000đ/tháng. Mỗi task trừ 1 credit Max-Studio lúc tạo, hoàn lại khi lỗi |
| Còn phải chốt | Cookie sống bao lâu; model nào giữ hình in tốt nhất; link có hạn dùng không; mã lỗi |

### 8.2 Gemini Omni Flash (provider chính)
- `POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`.
- Body: `model: "gemini-omni-1.1-flash"`; `input` gồm ảnh (base64) và prompt; `response_format: {type: "video", aspect_ratio: "9:16", resolution: "720p"}`.
- Kết quả trả về **trong cùng request** (base64, hoặc `uri` khi video lớn hơn 4MB).
- Giá khoảng $0.10/giây (khoảng $1/video). Không có gói miễn phí.
- Veo 3.1 bản preview trên Gemini API **đã tắt từ 22/10/2026**.
- Tài liệu: https://ai.google.dev/gemini-api/docs/omni
- **CHỐT Ở GĐ0 (Gemini):** body/endpoint còn đúng không; thời gian chờ thật; giá thật mỗi video 8 giây; chất lượng giữ mặt và hình in áo; có tự sinh âm thanh không; mã lỗi khi key sai, hết quota, nội dung bị chặn; giới hạn request song song.

### 8.3 OAuth Google (tài khoản dữ liệu, phía server)
- OAuth client loại **Web application**. Luồng authorization code phía server, có **PKCE** và `state` lưu trong cookie tạm.
- Redirect: `https://<tên miền>/api/google/callback` (thêm `http://localhost:3000/api/google/callback` khi dev).
- Màn hình đồng ý: **External**, **In production** (để Testing thì refresh token hết hạn sau 7 ngày). Chấp nhận cảnh báo *"chưa xác minh"*.
- `access_type=offline`, `prompt=consent`. Scope: `spreadsheets`, `drive.readonly`, `drive.file` (dùng `drive` toàn quyền nếu thư mục video do khách tạo sẵn). Lấy email đã kết nối qua Drive `about.get`.
- Refresh token lưu mã hoá (D14). Worker và API route đều dùng chung kết nối này.

### 8.4 Sheets và Drive
- Gọi REST (`fetch` hoặc `googleapis`) từ server.
- Đọc bằng `values.get`. Ghi **1 ô** bằng `values.update` với `RAW`.
- Ảnh: lấy file ID từ link Drive rồi gọi `files.get?alt=media`; link khác thì HTTP GET thường (giới hạn 20MB, chỉ `image/*`).
- Video: `files.create` (upload resumable) → `permissions.create {reader, anyone}` → `webViewLink`.

### 8.5 Meta Muse (làm song song, D15)
- **Hiện trạng (23/10/2026):** API chính thức của Meta mới có **Muse Image**, **chưa có Muse Video**. Khuyến mãi "hàng triệu/1 tỷ token miễn phí" là cho người dùng cá nhân trên app/web Meta, **không phải credit API**.
- Đường gọi tự động duy nhất hiện nay là **useapi.net** (bên thứ ba, phải giao thông tin đăng nhập tài khoản Meta) — **chưa được duyệt**.
- Phạm vi làm song song: thẻ Meta Muse (ô key, nút Kiểm tra, trạng thái *"Chưa hỗ trợ tạo video"*), khung `MuseProvider` theo F10. Phần gọi tạo video **chỉ code khi** có API video chính thức hoặc người phụ trách duyệt useapi.net, và sau khi thử chất lượng hình in 3–5 ảnh.

---

## 9. Dữ liệu (Supabase Postgres)

| Bảng | Các trường chính |
|---|---|
| `settings` (1 dòng) | `defaultProvider` (`gemini` \| `maxstudio` \| `muse`), `flowAccountEmail?`, `stripAudio`, `concurrency`, `dailyUsdLimit`, `dailyVideoLimit`, `geminiUsdPerSecond`, `driveRootFolderId`, `googleEmail`, `accessCodeHash`, `sessionVersion` |
| `secrets` | `name` (`gemini_api_key`, `maxstudio_api_key`, `flow_cookie`, `muse_key`, `google_refresh_token`), `ciphertext`, `iv`, `last4`, `updatedAt` |
| `sheet_configs` | `spreadsheetId`, `tab`, `headerRow`, `colImage`, `colPrompt`, `colVideoUrl`, `colStatus`, `updatedAt` |
| `batches` | `id`, `spreadsheetId`, `tab`, `rowsSpec`, `provider`, `runnerName`, `status`, `createdAt` |
| `jobs` | `id`, `batchId`, `spreadsheetId`, `tab`, `rowNumber`, `outputCell`, `statusCell`, `inputSnapshot` (JSON), `overwrite`, `state`, `attempts`, `error`, `provider`, `providerTaskId`, `submittedAt`, `leaseUntil`, `driveFileId`, `driveLink`, `audioStripped`, `costUsd`, `creditsUsed`, `updatedAt` |
| `job_events` | `jobId`, `at`, `fromState`, `toState`, `message` |
| `usage_daily` | `date`, `provider`, `videos`, `costUsd`, `creditsUsed` |
| `worker_heartbeat` | `workerId`, `at` |

- **Khoá dòng:** unique index một phần trên `jobs (spreadsheetId, tab, rowNumber) WHERE state NOT IN (done, failed, skipped_*, row_mismatch, provider_error, cancelled)`.
- **Supabase chỉ dùng làm Postgres** truy cập từ server bằng service role. **Bật RLS và không tạo policy nào** cho `anon`, để khoá anon (nếu lộ) cũng không đọc được bảng.

---

## 10. Bảo mật
- **Biến môi trường (Vercel + worker):** `DATABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, `SECRETS_ENCRYPTION_KEY` (32 byte), `SESSION_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `APP_BASE_URL`. Khi dev: `.env` chỉ chứa `op://…`, chạy qua `op run`.
- **Key provider và refresh token Google** nhập trên web → gửi một lần qua HTTPS tới API route → mã hoá AES-256-GCM → lưu `secrets`. **Không bao giờ trả về trình duyệt**; giao diện chỉ hiện `last4`. Mỗi thẻ có nút **"Xoá"**.
- **Cookie Flow** (khi gắn lại Max-Studio) chỉ gửi tới Max-Studio, không ghi log.
- **Mã truy cập** lưu dạng hash (scrypt/argon2). Cookie phiên `HttpOnly; Secure; SameSite=Lax`. Mọi API route ghi dữ liệu kiểm tra phiên và chống CSRF (kiểm tra header `Origin`).
- Log phải che `X-API-Key`, `x-goog-api-key`, `Authorization` và mọi trường token/cookie.
- Không commit bí mật vào repo.
- **Rủi ro còn lại (D9):** ai có mã truy cập là dùng được toàn bộ quyền (chạy lô tốn tiền, ghi sheet/Drive qua tài khoản dữ liệu). Giảm thiểu: hạn mức USD/ngày, budget alert Google Cloud, đổi mã khi có người nghỉ.

---

## 11. Ngoài phạm vi MVP
- App cài trên máy (Electron), app điện thoại.
- Tài khoản người dùng, phân quyền, nhiều workspace / nhiều khách trên một bản triển khai.
- Caption, chữ, logo, nhạc, edit video.
- Tự tạo ảnh người mẫu; tự đăng TikTok.
- Tự viết bot hoặc gọi API nội bộ của Flow.
- Provider useapi.net. Gọi Meta Muse qua useapi.net khi chưa được duyệt.
- Ảnh chèn trực tiếp vào ô sheet.

---

## 12. Tiêu chí hoàn thành
1. Mở link web trên Chrome/Edge (Windows 10 và 11): chưa nhập mã truy cập thì không xem được trang nào và mọi API route trả 401.
2. **Một dòng:** dòng 5 → video từ đúng ảnh và prompt dòng 5, link Drive vào đúng ô `[URL video]5`, không ô nào khác bị đổi.
3. **Nhiều dòng:** `2-3` với hai ảnh khác hẳn nhau → mỗi dòng nhận đúng video. Lặp 3 lần, kể cả khi dòng 3 xong trước.
4. **Lô 10 dòng không liên tiếp** (`2-4, 8, 12-17`) → 10 link vào đúng 10 ô.
5. **Lệch dòng:** chèn một dòng mới phía trên khi đang chạy → không ghi nhầm, các job bị ảnh hưởng chuyển sang `row_mismatch`.
6. **Đóng tab khi đang chạy:** lô vẫn chạy hết; mở lại thấy đúng tiến độ.
7. **Khởi động lại worker giữa lô:** job được nhận lại sau khi hết lease; không job nào bị gửi lại sau khi đã gửi sang provider; không tạo trùng video.
8. **Hai người cùng chọn dòng 2–5 và bấm Chạy gần như cùng lúc:** mỗi dòng chỉ có 1 job, 1 video.
9. **Gemini key sai / hết quota giữa lô:** hàng đợi tạm dừng, có banner; sửa key rồi bấm Tiếp tục thì chạy tiếp, không mất job, không tạo trùng.
10. **Hạn mức USD ngày:** vượt hạn mức thì chặn từ bước xem trước; chạm hạn mức giữa lô thì các job chưa gửi chuyển `paused_limit`.
11. **Provider đang dùng ngừng phản hồi:** job chuyển sang `provider_error`; app **không** tự chuyển sang provider khác.
12. **Chạy một lô bằng Gemini:** hiện cảnh báo chi phí và chi phí USD ước tính; video về đúng ô; chi phí đã dùng cập nhật sau lô.
13. **Dòng lỗi** (ảnh hỏng, nội dung bị chặn) → ô Trạng thái đúng dòng ghi lỗi, các dòng khác vẫn xong.
14. **Âm thanh:** bật bỏ âm thanh thì video trên Drive không có track âm thanh; ffmpeg lỗi thì vẫn có link video gốc.
15. Link Drive mở được trên trình duyệt chưa đăng nhập, file nằm đúng thư mục con, vẫn mở được sau 7 ngày.
16. **Không lộ bí mật:** xem mã nguồn trang, mọi phản hồi API, DB (bảng `secrets` chỉ có ciphertext) và log: **không thấy** Gemini key, Max-Studio key, cookie Flow, key Muse hay token Google ở dạng chữ thường.
17. Kết nối Google bằng chính email tài khoản Flow đã nhập → hiện cảnh báo đỏ.
18. **Dòng đã có video:** chọn `2-5` khi dòng 3 đã có link → dòng 3 bị bỏ qua, link cũ giữ nguyên, không tốn tiền. Có người dán tay link vào dòng 4 sau khi bấm Chạy → job dòng 4 `skipped_has_video`.
19. **Nhiều ô key (D15):** điền Gemini key và để trống các thẻ khác → chạy được bằng Gemini; thẻ Meta Muse hiện *"Chưa hỗ trợ tạo video"* và không chọn được làm mặc định; xoá key một provider không ảnh hưởng key provider khác.
20. **Mã truy cập:** sai 5 lần → bị chặn 15 phút; đổi mã → phiên cũ bị đăng xuất.

---

## 13. Bối cảnh tham khảo (đã tìm hiểu, không cần làm lại)

### 13.1 Chi phí

| Hạng mục | Chi phí | Ghi chú |
|---|---|---|
| **Gemini API (chính)** | Khoảng $1/video. 5 video/ngày ≈ $150/tháng; 20 video/ngày ≈ $600/tháng | Trả qua Google Cloud Billing |
| Vercel | Hobby $0 / Pro $20/tháng | ⚠️ Gói Hobby **chỉ cho dùng phi thương mại**; dùng cho việc kinh doanh nên tính gói Pro |
| Supabase | Free $0 / Pro $25/tháng | Gói Free **tạm dừng project sau 1 tuần không hoạt động** và không có backup tự động |
| Worker (Railway/Render/Fly) | Khoảng $5–10/tháng | Cần chạy liên tục và có `ffmpeg` |
| Max-Studio (khi gắn lại) | 199.000đ/tháng + credit Flow | Tạm gác |

Drive miễn phí 15GB chứa được khoảng 1.000–2.000 video.

### 13.2 Vì sao credit Flow không dùng được qua API chính thức
Gói Flow (Google AI Pro/Ultra) **không cấp API key**, và credit Flow chỉ dùng được trên giao diện Flow. Dùng API thì *"tính tiền riêng"*. Chỉ có dịch vụ bên thứ ba thay mặt tài khoản Flow (như Max-Studio, useapi.net) mới tiêu được credit Flow tự động.

### 13.3 Rủi ro của Max-Studio (khi gắn lại)
- **Bên vận hành ẩn danh:** không có tên công ty, link chính sách bảo mật để trống, tên miền không thống nhất.
- **Phải giao cookie Flow** — gần như cả phiên đăng nhập Google của tài khoản Flow.
- Quảng cáo **"vượt mọi captcha"**: có thể vi phạm điều khoản Google và dẫn tới **khoá tài khoản Flow**.
- Có thể ngừng hoạt động bất cứ lúc nào.
- Điều kiện khi gắn lại: tách tài khoản (D7), qua GĐ0 Max-Studio, trả theo tháng, khách ký xác nhận rủi ro.

### 13.4 Các phương án tạo video khác
1. **useapi.net Google Flow API** (khoảng $15/tháng, tiêu credit Flow). Rủi ro tài khoản tương tự Max-Studio.
2. **Chế độ "trợ lý Flow" bán tự động:** web chuẩn bị ảnh và prompt; người dùng tự bấm Tạo trên Flow rồi tải video lên web; server upload và ghi link. 0 đồng nhưng phải có người bấm.
3. **Meta Muse:** chưa có API video chính thức (mục 8.5).

---

## 14. Câu hỏi còn mở
1. **(v3.0) Mã truy cập chung (D9):** đồng ý dùng một mã chung để chặn người lạ không? Nếu không có lớp chặn nào, ai biết link cũng tiêu được tiền Gemini và ghi được vào sheet/Drive.
2. **(v3.0) Tên miền** dùng gì (tên miền riêng hay `*.vercel.app`)? Ai đứng tên tài khoản Vercel/Supabase/worker và trả phí?
3. **Tài khoản dữ liệu** là Gmail nào? Ai chia sẻ sheet và thư mục Drive sang tài khoản đó?
4. Khách đồng ý chi phí Gemini (khoảng $1/video) chưa? Thẻ thanh toán gắn với project Google Cloud nào?
5. Xin **1 sheet mẫu thật** để chốt cột và nơi lưu ảnh.
6. ~~Dòng đã có link video: mặc định bỏ qua hay ghi đè?~~ **Đã chốt: mặc định bỏ qua**, ghi đè phải tích riêng từng dòng.
7. Có cần cho tải video về máy từ web (cho người edit) không?
8. **Meta Muse:** chờ API video chính thức, hay duyệt đi qua useapi.net?
9. Cần báo khách: áo dùng nhân vật có bản quyền dễ bị TikTok Shop gỡ; TikTok yêu cầu gắn nhãn nội dung do AI tạo.

---

## 15. Thứ tự build

### Giai đoạn 0 — Kiểm chứng Gemini Omni Flash
**Điều kiện:** có Gemini API key từ project đã bật billing.

Viết **một script Node nhỏ** trong `gd0/`, không tự gửi lại khi lỗi, rồi điền kết quả vào mục 8.2:

| # | Kiểm tra | Điều kiện đạt |
|---|---|---|
| 1 | Endpoint, body, khung 9:16 còn đúng tài liệu | Tạo được video dọc 9:16 từ ảnh |
| 2 | Thời gian chờ một video | Dưới khoảng 5 phút |
| 3 | **Chất lượng: giữ mặt người mẫu và hình in áo**, thử 3–5 ảnh thật | Ít nhất 4/5 đạt (người phụ trách duyệt) |
| 4 | Giá thật mỗi video (Google Cloud Billing) | Đo được, gần $1/video |
| 5 | Có tự sinh âm thanh không | Biết có cần bước bỏ âm thanh |
| 6 | Mã lỗi: key sai, hết quota/billing, nội dung bị chặn, quá tải | Phân biệt được từng loại |
| 7 | 2–3 video song song | Không bị 429 liên tục |

> Người phụ trách đã chọn **code trước, thử sau**: được build các bước không phụ thuộc provider trước khi GĐ0 xong; phần gọi Gemini viết theo tài liệu và phải sửa theo kết quả GĐ0.

### Giai đoạn 1 — Build web
1. **Khung dự án:** Next.js + TypeScript, Supabase (schema mục 9, RLS bật), mã truy cập + cookie phiên (F0), mã hoá bí mật (D14), deploy thử lên Vercel.
2. **Google:** OAuth Web phía server (8.3), đọc tab, kiểm tra quyền sửa, đọc đúng dòng N, ghi đúng 1 ô, kiểm tra lệch dòng (thử với dữ liệu giả).
3. **Drive:** upload resumable, đặt quyền link, ghi link vào sheet.
4. **`GeminiOmniProvider`** theo mục 8.2, phân loại lỗi, cảnh báo chi phí.
5. **Worker + hàng đợi:** Postgres `SKIP LOCKED`, lease, song song, thử lại, khoá dòng bằng unique index, tạm dừng khi key/quota/hạn mức có vấn đề, heartbeat.
6. **Bỏ âm thanh** bằng ffmpeg trên worker.
7. **Giao diện:** trang Nhà cung cấp nhiều ô key (D15), kết nối Google + cảnh báo trùng tài khoản, ánh xạ cột, chọn dòng + xem trước kèm chi phí, tiến độ, lịch sử lô, banner.
8. **Chi phí USD + hạn mức, nhật ký, trang Cài đặt** (đổi mã truy cập, xoá key).
9. **Triển khai production** (Vercel + Supabase + worker), chạy đủ 20 tiêu chí mục 12, bàn giao kèm hướng dẫn tách tài khoản, đổi mã truy cập, budget alert.

- **Song song — Meta Muse (D15, mục 8.5):** thẻ key + khung `MuseProvider`; phần tạo video chờ API chính thức hoặc người phụ trách duyệt useapi.net.
- **Sau cùng — `MaxStudioProvider`**, khi Max-Studio tạo được video thật (qua lại GĐ0 Max-Studio trước).
