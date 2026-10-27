# MASYS Video Generator — Đặc tả sản phẩm (MVP)

> Phiên bản 4.1 · 26/10/2026 · Trạng thái: **viết lại từ đầu; chưa có code**. 4.1: chốt D5 (service account), ảnh gửi Muse bằng link Drive, giới hạn 5 video/ngày (D13), số liệu GĐ0.
> **Thay đổi so với 3.0: bỏ toàn bộ hướng gọi API video (Gemini, Max-Studio, Flow) và web app có server.** App mới là **tool chạy trên một máy**: đọc Google Sheet, cho chọn dòng và chỉnh prompt, rồi **điều khiển trình duyệt** để gửi yêu cầu cho **Meta Muse AI** (tài khoản có 1 tỷ token). Muse tự tạo video, tự lưu lên Drive và tự ghi link vào sheet qua **MCP Google Sheets/Drive đã nối sẵn trong Muse**. App chỉ **điều phối, theo dõi và kiểm tra lại**.
> Lịch sử v2.x–3.0 xem trong git.
> Tài liệu này viết để một người hoặc agent mới đọc **một lần là nắm được toàn bộ dự án**.

---

## 0. Tóm tắt trong 30 giây

- **Sản phẩm:** tool đọc **Google Sheet** (mỗi dòng = một video), đánh dấu dòng **đã có link video**, cho chọn dòng, **chỉnh prompt / thêm yêu cầu**, chọn **thư mục Drive** lưu video, rồi mở **bot trình duyệt** gửi yêu cầu vào Muse AI. Muse tạo video, lưu Drive và dán link vào ô Video. App thấy ô Video có link hợp lệ thì **kết thúc lượt** và chuyển sang dòng tiếp theo.
- **Vì sao phải có tool** dù làm tay trên Muse được: nhiệm vụ yêu cầu một tool. Tool giúp chạy nhiều dòng liên tục, không dán nhầm dòng và có nhật ký.
- **Khách hàng:** chủ kênh TikTok bán áo thun dùng người mẫu AI, khoảng **5–20 video/ngày**. Sheet và thư mục Drive được chia sẻ cho cả đội.
- **Yêu cầu cốt lõi:** **lấy input dòng N thì link video về đúng ô Video dòng N.**
- **Chạy ở đâu:** **một máy Windows** có Chrome (bot cần trình duyệt thật và phiên đăng nhập Muse). Giao diện tool mở trên `localhost`.
- **Không làm:** caption, nhạc, edit video, tự đăng TikTok, tự tạo ảnh người mẫu, vượt captcha/2FA.

---

## 1. Bối cảnh

### 1.1 Khách đang làm thế nào
Khách có ảnh người mẫu mặc áo và prompt trong Google Sheet. Hiện tại làm tay: mở công cụ tạo video, dán ảnh + prompt, chờ, tải về, upload Drive, dán link vào sheet. Chậm và dễ dán nhầm dòng.

### 1.2 Kiểu video cần tạo
Mẫu: TikTok [@scarletthayes40](https://www.tiktok.com/@scarletthayes40), [@chloeamira](https://www.tiktok.com/@chloeamira).
- Dọc 9:16, khoảng 8–11 giây, **một cảnh**, như quay bằng điện thoại trong nhà.
- Người mẫu AI mặc áo thun oversized, nhìn camera, vuốt tóc, cười, **chỉ vào hình in trên áo**.
- Lỗi hay gặp nhất: **hình in trên áo bị méo** → prompt luôn có câu dặn giữ nguyên hình in.
- Caption và nhạc do người edit thêm sau, ngoài phạm vi.

### 1.3 Vì sao chọn Muse qua trình duyệt
- Tài khoản Muse của khách có **1 tỷ token**, nhưng đây là quyền lợi **dùng trên web/app Meta**, không phải credit API. Meta chưa có API video chính thức.
- Muse đã được nối **MCP Google Sheets và Google Drive** nên tự đọc ảnh, tự lưu video và tự ghi link được.
- **GĐ0 thủ công đã đạt (26/10/2026):** người phụ trách làm tay toàn bộ luồng trên Muse thành công: ảnh đưa vào bằng **link Drive**, mỗi video mất **vài phút** và tốn khoảng **3% hạn mức Free plan của tuần**. Chi tiết ở mục 13 và 15.

---

## 2. Thuật ngữ

| Thuật ngữ | Nghĩa trong dự án |
|---|---|
| **Sheet** | Google Sheet của khách, chia sẻ cho cả đội và cho Muse (qua MCP). Mỗi dòng là một video |
| **Dòng N** | Số dòng **đúng như hiển thị trong Google Sheet** (dòng 1 thường là tiêu đề) |
| **Ánh xạ cột** | Cấu hình cho biết cột nào là Ảnh, Prompt, Video, Trạng thái. Lưu theo từng sheet và tab |
| **Ô Video** | Ô `[cột Video][dòng N]`, nơi Muse dán link Drive |
| **Lượt (run)** | Việc tạo video cho **một dòng**: gửi yêu cầu cho Muse → chờ → kiểm tra → kết thúc |
| **Lô** | Danh sách dòng được chọn trong một lần bấm Chạy. Các lượt trong lô chạy **tuần tự** |
| **Yêu cầu gửi Muse** | Đoạn chữ bot dán vào ô chat Muse, ghép từ mẫu (mục 8.2) + prompt đã chỉnh + yêu cầu thêm + thư mục Drive + địa chỉ ô |
| **Bot** | Phần của tool điều khiển Chrome bằng **Playwright**, dùng **hồ sơ trình duyệt riêng** đã đăng nhập Muse |
| **Hồ sơ bot** | Thư mục profile Chrome riêng của bot (ngoài repo). Người phụ trách tự đăng nhập Muse vào đây một lần |
| **Service account** | Tài khoản Google kỹ thuật mà **tool** dùng để đọc sheet, ghi ô Trạng thái và kiểm tra file Drive (D5) |

---

## 3. Các quyết định đã chốt

> Không mở lại các quyết định dưới đây nếu chưa hỏi người phụ trách.

| # | Quyết định | Lý do | Phương án đã loại |
|---|---|---|---|
| D1 | **Muse AI là nơi duy nhất tạo video**, điều khiển qua **giao diện web Muse bằng bot trình duyệt** | Dùng được 1 tỷ token; Muse chưa có API video | Gemini API (tốn ~$1/video), Max-Studio (không chạy), useapi.net (giao tài khoản cho bên thứ ba) |
| D2 | **Muse tự làm phần ra:** tạo video, lưu vào thư mục Drive, dán link vào ô Video, qua MCP đã nối trong Muse. **Tool không tải, không upload video** | Đúng luồng đã kiểm chứng ở GĐ0; tool gọn | Tool tự tải video và upload Drive |
| D3 | **Tín hiệu "xong" là ô Video trên sheet**, không đọc chữ trong khung chat Muse | Sheet ổn định hơn giao diện chat; đúng thứ khách cần | Đọc câu trả lời của Muse |
| D4 | **Tool chạy trên một máy Windows** (Node + Playwright + Chrome), giao diện mở ở `localhost`. Cả đội dùng chung sheet/Drive; chỉ máy này chạy bot | Bot cần trình duyệt thật và phiên đăng nhập Muse; một tài khoản Muse thì chỉ nên một nơi điều khiển | Web app trên Vercel + Supabase (bản 3.0); mỗi người chạy bot riêng |
| D5 | **Tool đọc/ghi Google bằng service account**: chia sẻ sheet (quyền sửa) và thư mục Drive (quyền xem) cho email service account. Khoá JSON lưu trong 1Password, nạp qua `op run` | Không cần màn hình OAuth, không hết hạn token; tool chỉ đọc sheet, ghi ô Trạng thái, kiểm tra file | OAuth tài khoản người dùng; sheet công khai (không ghi được Trạng thái) |
| D6 | **Đăng nhập Muse do người làm tay** trong hồ sơ bot. Bot **không bao giờ gõ mật khẩu, không vượt captcha/2FA**. Phiên hết hạn → tạm dừng lô, báo *"Cần đăng nhập lại Muse"* | An toàn tài khoản; không tự động hoá bước xác thực | Lưu mật khẩu Meta để bot tự đăng nhập |
| D7 | **Chạy tuần tự, một dòng một lượt, mỗi lượt một cuộc trò chuyện Muse mới**; nghỉ ngẫu nhiên 20–60 giây giữa hai lượt | Tránh lẫn ngữ cảnh giữa các dòng; giảm nguy cơ bị coi là bot | Chạy song song nhiều tab |
| D8 | **Bot chạy có cửa sổ** (không headless) để người dùng nhìn thấy và can thiệp được | Dễ kiểm soát, ít bị chặn hơn | Headless |
| D9 | **Không tự gửi lại yêu cầu khi không chắc.** Quá thời gian chờ hoặc lỗi giữa chừng → lượt `Lỗi`/`Cần xem`, người dùng tự quyết định chạy lại | Tránh tạo trùng video và tốn token | Tự thử lại |
| D10 | **Dòng đã có link trong ô Video được đánh dấu "Đã có video" và mặc định không chọn được**; muốn làm lại phải tích **Ghi đè** từng dòng | Khách yêu cầu | Ghi đè mặc định |
| D11 | **Cột Trạng thái bắt buộc**; tool ghi `Đang chạy`, `Xong`, `Lỗi: …`, `Cần xem` để cả đội thấy và tránh hai người chạy trùng | Sheet là nơi cả đội cùng nhìn | Chỉ hiện trạng thái trong tool |
| D12 | **Kiểm tra lại sau khi Muse báo xong:** link phải là file Drive, tồn tại, là video, nằm trong đúng thư mục đã chọn; ảnh và prompt dòng N không bị đổi trong lúc chạy | Muse là agent, có thể làm nhầm ô hoặc nhầm thư mục | Tin hoàn toàn vào Muse |
| D13 | **Giới hạn mặc định 5 video/ngày** (đếm các lượt đã gửi Muse trong ngày theo giờ máy, kể cả lượt lỗi), sửa được trong Cài đặt. Chọn quá số còn lại thì không cho bấm Chạy; chạm giới hạn giữa lô thì các dòng còn lại chuyển `paused_limit` | Đúng nhu cầu thực tế (~5 video/ngày); giảm nguy cơ tài khoản bị coi là bot; giữ token | Không giới hạn |
| D14 | **Ảnh gửi Muse bằng link Drive** ghi trong yêu cầu; Muse tự đọc qua MCP Drive. Bot không tải ảnh lên khung chat | Đúng cách đã kiểm chứng ở GĐ0; bot đơn giản | Bot tải file ảnh lên Muse |

---

## 4. Kiến trúc tổng quan

```
 Người dùng ── trình duyệt ──► http://localhost:<port>  (giao diện tool)
                                     │
                      ┌──────────────┴──────────────┐
                      │   Tool (một tiến trình Node) │
                      │  • SheetReader  (service acc)│──► Google Sheets API (đọc, ghi ô Trạng thái)
                      │  • DriveChecker (service acc)│──► Google Drive API (kiểm tra file, liệt kê thư mục)
                      │  • RunQueue (tuần tự)        │
                      │  • MuseBot (Playwright)      │──► Chrome (hồ sơ bot) ──► muse (web Meta)
                      │  • Nhật ký (SQLite cục bộ)   │                                 │ MCP
                      └──────────────────────────────┘                                 ▼
                                                                    Google Sheets / Drive (Muse ghi link, lưu video)
```

Nguyên tắc:
- **Sheet là nguồn sự thật** về việc dòng nào đã có video. SQLite cục bộ chỉ lưu cấu hình, lịch sử lô và nhật ký.
- Tool **không cầm mật khẩu Meta**. Chỉ hồ sơ bot giữ phiên đăng nhập.
- Bí mật duy nhất của tool là **khoá service account**, nạp qua `op run`.

---

## 5. Luồng người dùng

### 5.0 Chuẩn bị (làm một lần)
1. Tạo **service account** trên Google Cloud, bật Sheets API + Drive API, lưu khoá JSON vào 1Password.
2. **Chia sẻ** sheet (quyền sửa) và thư mục Drive gốc chứa video (quyền xem) cho email service account. Sheet và Drive cũng phải chia sẻ cho tài khoản Google đã nối MCP trong Muse.
3. Cài tool trên máy chạy bot, mở tool, bấm **"Mở trình duyệt bot"** → tự đăng nhập Muse trong cửa sổ đó (D6).
4. **Ánh xạ cột** cho sheet: dán link sheet, chọn tab, xác nhận cột Ảnh, Prompt, Video, Trạng thái.

### 5.1 Dùng hằng ngày
1. Mở tool → chọn sheet/tab → bấm **Quét**. Bảng hiện mọi dòng: ảnh (thu nhỏ), prompt, trạng thái. Dòng có link trong ô Video hiện nhãn **"Đã có video"**.
2. **Chọn dòng** (tích chọn, gõ khoảng `2-5, 8`, hoặc "Chọn mọi dòng chưa có video").
3. Với mỗi dòng đã chọn: **xem/sửa prompt** (chỉ sửa bản gửi Muse, không sửa sheet) và **thêm yêu cầu** (ví dụ "giữ nguyên hình in", "nền phòng ngủ").
4. Chọn **thư mục Drive** lưu video cho lô (mặc định: thư mục gốc đã cài).
5. Xem trước **yêu cầu gửi Muse** của từng dòng → bấm **Chạy**.
6. Bot chạy từng dòng; tool hiện tiến độ. Hết lô thì hiện tổng kết.

### 5.2 Tình huống đặc biệt
- **Phiên Muse hết hạn / hiện trang đăng nhập / captcha:** tạm dừng lô, đưa cửa sổ bot lên trước, báo *"Cần đăng nhập lại Muse"*. Người dùng xử lý xong bấm **Tiếp tục**.
- **Muse không xong trong thời gian chờ** (mặc định 20 phút): lượt `Cần xem`, ô Trạng thái ghi `Cần xem: quá thời gian`. **Không gửi lại** (D9). Lô chạy tiếp dòng sau.
- **Muse báo lỗi / hết lượt / từ chối nội dung** (bot nhận ra được): lượt `Lỗi: <lý do>`, chạy tiếp dòng sau. Hết token/giới hạn → tạm dừng cả lô.
- **Link Muse ghi không hợp lệ** (không phải Drive, sai thư mục, file không tồn tại): `Cần xem: link không hợp lệ`, giữ nguyên link để người xem.
- **Muse ghi nhầm ô**: tool so ảnh chụp sheet trước/sau lượt; ô nào ngoài ô Video và ô Trạng thái dòng N bị đổi → `Cần xem: Muse sửa ô khác (<địa chỉ>)`, **tạm dừng lô**.
- **Có người dán tay link vào dòng N trước khi tới lượt:** bỏ qua dòng đó (`Đã có video`).
- **Dòng N bị đổi trong lúc chạy** (chèn/xoá/sắp xếp dòng): `Cần xem: lệch dòng`, tạm dừng lô.
- **Giao diện Muse đổi, bot không tìm thấy ô chat/nút gửi:** dừng lô, chụp màn hình vào nhật ký, báo *"Giao diện Muse thay đổi"*.

---

## 6. Đặc tả chức năng

**F1. Kết nối sheet**
- Dán link sheet → đọc danh sách tab bằng service account.
- Thiếu quyền → báo rõ: *"Chia sẻ sheet cho <email service account> với quyền chỉnh sửa"*.

**F2. Ánh xạ cột**
- 4 cột: **Ảnh** (link Drive hoặc link ảnh), **Prompt**, **Video** (Muse ghi), **Trạng thái** (tool ghi, bắt buộc).
- Chọn dòng tiêu đề (mặc định dòng 1); tự đoán cột theo tên tiêu đề; lưu theo `(spreadsheetId, tab)`.

**F3. Quét và chọn dòng**
- Đọc toàn bộ vùng dữ liệu của tab; mỗi dòng gắn nhãn:
  - **Đã có video:** ô Video có link → không chọn được (trừ khi tích Ghi đè).
  - **Thiếu dữ liệu:** thiếu ảnh hoặc prompt → không chọn được.
  - **Đang chạy:** ô Trạng thái là `Đang chạy` → không chọn được (có thể đang chạy ở lô khác hoặc lượt trước bị ngắt; có nút "Bỏ khoá" kèm xác nhận).
  - **Sẵn sàng.**
- Nút **Quét lại**; tool cũng **đọc lại dòng ngay trước khi gửi Muse**.
- Luôn hiện **"Hôm nay: X/5 video"** (D13). Số dòng chọn vượt số còn lại thì nút Chạy bị khoá kèm lời nhắc.

**F4. Chỉnh yêu cầu**
- Mỗi dòng có ô sửa prompt (mặc định = prompt trong sheet) và ô **Yêu cầu thêm**. Có ô **Yêu cầu thêm chung cho cả lô**.
- Chọn **thư mục Drive** cho lô: chọn từ thư mục gốc (tool liệt kê thư mục con bằng service account) hoặc dán link thư mục.
- Xem trước **yêu cầu gửi Muse** đầy đủ trước khi chạy.
- Bản chỉnh sửa **không ghi ngược vào sheet**; lưu trong lịch sử lô.

**F5. Chạy một lượt (MuseBot)**
1. Đọc lại dòng N: còn đúng ảnh/prompt lúc chọn không, ô Video còn trống không (trừ Ghi đè).
2. Chụp lại giá trị toàn tab (để phát hiện Muse sửa nhầm ô).
3. Ghi ô Trạng thái dòng N = `Đang chạy`.
4. Mở **cuộc trò chuyện mới** trên Muse, dán yêu cầu gửi Muse, bấm Gửi. Ghi `sentAt` **trước** khi bấm Gửi.
5. **Theo dõi ô Video dòng N** mỗi 20 giây (đọc sheet). Đồng thời kiểm tra trang Muse có hiện lỗi/đăng nhập/captcha không.
6. Ô Video có link → **kiểm tra (D12)**: lấy file ID, `files.get` bằng service account: tồn tại, `mimeType` `video/*`, `parents` chứa thư mục đã chọn. So lại toàn tab với bản chụp ở bước 2.
7. Đạt → ô Trạng thái = `Xong`, lưu link + URL cuộc trò chuyện Muse vào nhật ký. Không đạt → `Cần xem: <lý do>`.
8. Nghỉ ngẫu nhiên 20–60 giây rồi sang dòng tiếp theo.

**F6. Tiến độ và nhật ký**
- Trang tiến độ: từng dòng, trạng thái, thời gian, link video, link cuộc trò chuyện Muse; nút **Tạm dừng**, **Tiếp tục**, **Huỷ lô** (huỷ chỉ dừng trước dòng kế tiếp, không can thiệp lượt Muse đang chạy).
- Lịch sử lô: lúc nào, bao nhiêu dòng, kết quả, yêu cầu đã gửi.
- Nhật ký lỗi kèm **ảnh chụp màn hình** trang Muse khi có lỗi.

**F7. Cài đặt**
- Thời gian chờ tối đa mỗi lượt (mặc định 20 phút; GĐ0 mất vài phút/video), khoảng nghỉ giữa lượt, **giới hạn video/ngày** (mặc định 5, D13), thư mục Drive gốc, mẫu yêu cầu gửi Muse (sửa được, mục 8.2), URL trang Muse.
- Nút **Mở trình duyệt bot** (để đăng nhập hoặc xem).
- Giới hạn hợp lệ (CON-41): thời gian chờ 1–120 phút; nghỉ 0–600 giây (nhiều nhất ≥ ít nhất); giới hạn 1–50 video/ngày, trên 5 thì nhắc rủi ro D13; URL Muse phải là `https://` thuộc muse.ai, để trống là mặc định. Đổi lúc lô đang chạy thì áp dụng từ dòng kế tiếp.

---

## 7. Trạng thái một lượt

```
queued ──(đã đủ video trong ngày, D13)──► paused_limit
  │
  ▼
checking_row ──(đã có video)──► skipped_has_video
              │          └─(dòng bị đổi)──► needs_review (lệch dòng)
              ▼
           sending ──(trang đăng nhập/captcha)──► paused_login (dừng lô)
              │     └─(không thấy ô chat/nút gửi)──► paused_ui (dừng lô)
              ▼
           waiting ──(quá thời gian)──► needs_review
              │     ├─(Muse báo lỗi/từ chối)──► failed
              │     └─(Muse hết token/giới hạn)──► paused_quota (dừng lô)
              ▼
           verifying ──(link sai / sai thư mục / sửa nhầm ô)──► needs_review
              ▼
            done
```

- Mỗi lần đổi trạng thái ghi SQLite **trước** khi làm bước tiếp theo.
- Tool bị tắt giữa lượt: khi mở lại, lượt ở `sending`/`waiting` **không gửi lại**; tool tiếp tục theo dõi ô Video thêm một chu kỳ chờ, hết hạn thì `needs_review`.
- Ô Trạng thái trong sheet: `Đang chạy`, `Xong`, `Lỗi: …`, `Cần xem: …`.

---

## 8. Tích hợp

### 8.1 Google (service account)
- Sheets: `spreadsheets.get` (danh sách tab), `values.get` (đọc), `values.update` **đúng một ô** với `RAW` (chỉ ô Trạng thái).
- Drive: `files.get` (kiểm tra link Muse ghi), `files.list` (liệt kê thư mục con), lấy ảnh thu nhỏ để hiện trong bảng.
- Scope: `spreadsheets`, `drive.readonly`.

### 8.2 Mẫu yêu cầu gửi Muse
Mẫu mặc định (sửa được trong Cài đặt). Phải ghi **địa chỉ tuyệt đối**, không để Muse tự đoán:

```
Hãy tạo một video dọc 9:16, dài khoảng 8–10 giây, một cảnh, từ ảnh người mẫu sau:
Ảnh: {link_anh}

Prompt: {prompt}
Yêu cầu thêm: {yeu_cau_them}
Luôn giữ nguyên hình in trên áo, không làm méo hay đổi chữ/hình.

Sau khi tạo xong:
1. Lưu video vào thư mục Google Drive: {link_thu_muc} (tên file: {ten_file}).
2. Dán link Google Drive của video vào ô {o_video} của tab "{ten_tab}" trong Google Sheet {link_sheet}.
3. Chỉ sửa đúng ô {o_video}. Không sửa bất kỳ ô nào khác.
```

- `{ten_file}` = `<tên tab>_row<N>_<YYYYMMDD-HHmm>.mp4`.
- `{link_anh}` là link Drive lấy từ cột Ảnh (D14). Tool kiểm tra trước bằng service account rằng file ảnh tồn tại; link không phải Drive hoặc không mở được thì dòng bị đánh dấu **Thiếu dữ liệu**.

### 8.3 MuseBot (Playwright)
- `chromium.launchPersistentContext(<thư mục hồ sơ bot>, { channel: "chrome", headless: false })`. Hồ sơ bot nằm **ngoài repo** (ví dụ `%LOCALAPPDATA%\masys-video\bot-profile`).
- **Mọi selector gom vào một file** (`museSelectors`), ưu tiên role/label hơn class CSS, để sửa nhanh khi Muse đổi giao diện.
- Nhận diện: trang đăng nhập, captcha/kiểm tra bảo mật, thông báo lỗi/hết lượt (theo chữ trên trang — chốt ở GĐ0).
- Gõ/dán như người: dán qua clipboard hoặc `fill`, chờ ngắn trước khi bấm Gửi.
- **Không** đọc hay lưu cookie ra ngoài hồ sơ bot; không ghi cookie vào log.
- **Giao diện thật ghi nhận 26/10/2026** (`https://muse.ai/`, tiếng Anh; chi tiết trong `src/bot/museSelectors.ts`):
  - Chưa đăng nhập: `muse.ai` chuyển qua `auth.muse.ai` → `facebook.com/aymh` rồi về trang có tiêu đề *"Log in or create an account"* và ô *"Mobile number or email"*.
  - Đã đăng nhập: một **trò chuyện chính** liền mạch (đường dẫn `/`), ô chat tên *"Message"*, nút *"Send"* chỉ hiện khi ô chat có chữ.
  - **Cuộc trò chuyện mới = side chat:** nút *"Chats"* (Open chat and side chats) → nút *"New side chat"* → `/thread/new`; sau khi gửi thành `/thread/<id>`. Bot dùng một side chat mới cho mỗi dòng (D7); trò chuyện chính không bị đụng tới.
  - **Lần gửi thật đầu tiên (26/10/2026, CON-39):** gửi lúc 15:53 UTC, video xong lúc 15:57 (≈4 phút): đúng thư mục Video, đúng tên file, MP4 1080×1920 8 giây, link ghi đúng ô C2. Drive cần vài phút sau khi tải lên mới phát được video (*"Tệp video này vẫn đang được xử lý để phát"*): không phải lỗi.
  - **Muse xin duyệt (Approvals)** trước một số thao tác (lưu Drive, sửa Sheet). Người dùng chọn *Always allow* trong Muse để lần sau không bị hỏi. Lượt sau mà Muse vẫn chờ duyệt thì ô Video sẽ trống tới hết thời gian chờ → CON-40 cần nhận ra trạng thái "đang chờ duyệt" và báo người dùng (đề xuất: bot không tự bấm duyệt; chốt khi làm CON-40).
  - **Đã chốt 27/10/2026 (CON-40): bot không bao giờ tự bấm duyệt.** Màn hình duyệt thật: thẻ *"Allow Như to create or upload files that may be shared in Google Drive?"* với nút *"Create"* / *"Always allow"* / *"Don't create"*, nhãn *"Needs approval"* ở đầu cuộc trò chuyện. Tool thấy thì đưa cửa sổ bot lên trước và hiện "Muse đang chờ bạn duyệt" trên trang lô; thời gian chờ vẫn tính.
  - **Chạy thật CON-40 (27/10/2026, lô #2 dòng 2 Ghi đè + dòng 3):** tắt tool đột ngột khi dòng 2 đang chờ → mở lại, lô Tạm dừng, dòng 2 không gửi lại, tool theo dõi tiếp và ghi Xong (§12.10). Đăng xuất Muse rồi Tiếp tục → lô tạm dừng "Cần đăng nhập lại Muse", dòng 3 chưa gửi, ô Trạng thái trả về trống; đăng nhập lại + Tiếp tục → dòng 3 Xong sau ≈2,5 phút (§12.6). Mỗi dòng được gửi Muse đúng một lần. "Always allow" chọn hôm trước không áp dụng cho lần này: Muse hỏi duyệt lại một lần khi tải lên Drive.
  - Câu báo hết lượt / từ chối / lỗi của Muse: chưa gặp (đến 27/10/2026, xem §14.2); bot đang dò theo các câu phổ biến, gặp câu thật thì ghi bổ sung vào đây.

---

## 9. Dữ liệu cục bộ (SQLite)

| Bảng | Các trường chính |
|---|---|
| `settings` | `driveRootFolderId`, `timeoutMinutes`, `pauseMinSec`, `pauseMaxSec`, `dailyVideoLimit` (mặc định 5), `museUrl`, `requestTemplate` |
| `sheet_configs` | `spreadsheetId`, `tab`, `headerRow`, `colImage`, `colPrompt`, `colVideo`, `colStatus` |
| `batches` | `id`, `spreadsheetId`, `tab`, `driveFolderId`, `extraRequest`, `status`, `createdAt` |
| `runs` | `id`, `batchId`, `rowNumber`, `inputSnapshot` (ảnh, prompt gốc), `promptSent`, `requestText`, `overwrite`, `state`, `error`, `sentAt`, `doneAt`, `videoLink`, `driveFileId`, `museChatUrl` |
| `run_events` | `runId`, `at`, `fromState`, `toState`, `message`, `screenshotPath?` |

File SQLite và ảnh chụp màn hình nằm ngoài repo (cùng thư mục với hồ sơ bot).

---

## 10. Bảo mật và rủi ro

- **Bí mật:** chỉ có khoá service account. `.env` chứa `op://…`; chạy `op run --env-file=.env -- <lệnh>`. Không commit, không log.
- **Mật khẩu Meta không bao giờ vào tool** (D6). Hồ sơ bot chứa phiên đăng nhập → coi như bí mật: không đồng bộ, không chia sẻ, không đưa lên git.
- Giao diện tool chỉ nghe `127.0.0.1` (không mở ra mạng LAN) trừ khi người phụ trách quyết định khác.
- **Rủi ro điều khoản Meta:** tự động hoá giao diện web có thể vi phạm điều khoản, dẫn tới hạn chế hoặc khoá tài khoản Muse. Giảm thiểu: chạy tuần tự, có cửa sổ, nghỉ giữa lượt (D7, D8), giới hạn 5 video/ngày (D13). Khách cần biết và chấp nhận rủi ro này.
- **Rủi ro agent làm sai:** Muse có thể sửa nhầm ô hoặc lưu sai chỗ → kiểm tra D12 và dừng lô khi phát hiện.
- **Rủi ro giao diện thay đổi:** bot hỏng khi Meta đổi web → selector gom một chỗ, dừng sạch và báo rõ.

---

## 11. Ngoài phạm vi MVP
- Gọi API video bất kỳ (Gemini, Max-Studio, Flow, useapi.net).
- Web app trên server, nhiều máy cùng chạy bot, nhiều tài khoản Muse.
- Bot tự đăng nhập, vượt captcha/2FA.
- Caption, nhạc, edit video, bỏ âm thanh, tự đăng TikTok, tự tạo ảnh người mẫu.
- Ghi prompt đã chỉnh ngược vào sheet.

---

## 12. Tiêu chí hoàn thành
1. **Quét:** sheet 20 dòng, 5 dòng đã có link → đúng 5 dòng hiện "Đã có video" và không chọn được.
2. **Một dòng:** chạy dòng 5 → video từ đúng ảnh dòng 5, nằm trong đúng thư mục đã chọn, link ở đúng ô Video dòng 5, ô Trạng thái `Xong`, không ô nào khác bị đổi.
3. **Lô 5 dòng không liên tiếp** (`2, 4, 7-9`) → 5 link vào đúng 5 ô, chạy tuần tự, mỗi dòng một cuộc trò chuyện Muse.
4. **Chỉnh prompt:** prompt và yêu cầu thêm đã sửa xuất hiện đúng trong yêu cầu gửi Muse (xem trong nhật ký); sheet không bị sửa prompt.
5. **Đã có video:** có người dán tay link vào dòng 8 sau khi bấm Chạy → dòng 8 bị bỏ qua, không gửi Muse.
6. **Hết phiên Muse:** đăng xuất Muse giữa lô → lô tạm dừng, có thông báo; đăng nhập lại, bấm Tiếp tục → chạy tiếp, không gửi lại dòng đã gửi.
7. **Quá thời gian:** đặt thời gian chờ 1 phút → lượt chuyển `Cần xem`, không gửi lại, lô chạy tiếp.
8. **Link sai thư mục:** chuyển file video sang thư mục khác trước khi kiểm tra → `Cần xem: link không hợp lệ`.
9. **Sửa nhầm ô:** sửa tay một ô khác trong lúc chờ → `Cần xem`, lô tạm dừng.
10. **Tắt tool giữa lượt** rồi mở lại → không gửi lại yêu cầu; lượt được theo dõi tiếp hoặc `Cần xem`.
11. **Không lộ bí mật:** repo, log, SQLite không chứa khoá service account hay cookie Meta. Kiểm tra bằng `op run --env-file=.env -- npm run check-secrets -- <file log>` (CON-41): quét file trong repo, thư mục dữ liệu (trừ hồ sơ bot và ảnh chụp) và các file log được chỉ ra; chạy qua `op run` thì so cả nguyên văn khoá thật.
12. **Giới hạn ngày:** đã chạy 4 video trong ngày, chọn 3 dòng → không bấm Chạy được; chọn 1 dòng → chạy được, sau đó hiện "Hôm nay: 5/5".

### 12.1. Kết quả nghiệm thu GĐ1 (27/10/2026, CON-42)
Sheet thật "MASYS Video – Danh sách" → Trang tính1 (20 dòng), Drive thật, tài khoản Muse thật, máy Windows chạy bot. Hôm nay 7 video thật (giới hạn tạm nâng lên 7 cho buổi nghiệm thu rồi hạ lại 5). Mỗi dòng được gửi Muse **đúng một lần**.

| # | Kết quả | Cách thử |
|---|---|---|
| 1 | ✅ | Quét 20 dòng, 5 dòng có link (2, 3, 13, 14, 15) → đúng 5 dòng "Đã có video", không tick được; 15 dòng "Sẵn sàng". |
| 2 | ✅ | Dòng 6 (lô #3): file `Trang tính1_row6_20261027-0953.mp4` (video/mp4) trong đúng thư mục Video, link ở C6, D6 = `Xong`, tool so toàn tab không thấy ô nào khác đổi. |
| 3 | ✅ | Lô #3 dòng 4, 6, 9, 10, 11 (không liên tiếp): chạy tuần tự, mỗi dòng một side chat Muse riêng; 4 video vào đúng ô của từng dòng. Một lô 5 dòng "cả 5 đều Xong" không chạy riêng vì các dòng được dùng để thử 12.4/5/8/9 cùng lúc. |
| 4 | ✅ | Dòng 6: prompt sửa thêm "Slow camera push-in." và yêu cầu thêm chung "Ánh sáng ấm, tông màu tự nhiên." có đúng trong yêu cầu gửi Muse; ô B6 trong sheet không đổi. |
| 5 | ✅ | Dán tay link vào C10 sau khi bấm Chạy → dòng 10 `skipped_has_video`, không gửi Muse. Xem ghi chú bên dưới. |
| 6 | ✅ | CON-40 (27/10/2026, lô #2): đăng xuất Muse giữa lô → tạm dừng "Cần đăng nhập lại Muse", dòng 3 chưa gửi; đăng nhập lại + Tiếp tục → dòng 3 Xong, dòng 2 không gửi lại. |
| 7 | ✅ | Lô #4 dòng 12 + 16, thời gian chờ 1 phút → dòng 12 `Cần xem: quá thời gian`, không gửi lại; lô chạy tiếp dòng 16 (đã có link → bỏ qua) rồi xong. |
| 8 | ✅ | Chuyển video cũ ra thư mục gốc, dán link đó vào C11 khi dòng 11 đang chờ → `Cần xem: link không hợp lệ` (file không nằm trong thư mục đã chọn). |
| 9 | ✅ | Sửa tay ô E9 khi dòng 9 đang chờ → `Cần xem: Muse sửa ô khác (E9)`, lô tạm dừng; xoá lại E9 + Tiếp tục → chạy tiếp. |
| 10 | ✅ | CON-40 (lô #2): tắt hẳn tool khi dòng 2 đang chờ → mở lại không gửi lại, theo dõi tiếp, dòng 2 Xong. |
| 11 | ✅ | `op run --env-file=.env -- npm run check-secrets -- <các log chạy thử>`: repo, `data.db`, log sạch (có so nguyên văn khoá thật). |
| 12 | ✅ (tương đương) | Đã dùng 6/7 video trong ngày: chọn 2 dòng → *"Đã chọn 2 dòng nhưng hôm nay chỉ còn 1 video (giới hạn 7/ngày)"*, không tạo được lô; chọn 1 dòng → được. Thử với giới hạn 7 thay vì 5 (cùng cơ chế) để không tốn thêm video. |

**Ghi chú phát hiện khi nghiệm thu (12.5 × 12.9):** dán tay link vào C10 đúng lúc dòng 4 đang chờ Muse → tool so toàn tab thấy C10 đổi nên dòng 4 thành `Cần xem: Muse sửa ô khác (C10)` và lô tạm dừng, dù video dòng 4 vẫn đúng ở C4. Tool không phân biệt được người hay Muse sửa ô, nên đây là hành vi an toàn theo E7. Đã ghi vào README: *đang chạy lô thì đừng sửa sheet; muốn sửa thì Tạm dừng trước*. Có nên nới quy tắc (ví dụ bỏ qua ô Video của các dòng còn chờ trong cùng lô) là quyết định của người phụ trách, chưa đổi.

---

## 13. Chi phí
- Muse (trang Settings → Usage, 26/10/2026) có hai nguồn:
  - **Free plan:** hạn mức theo tuần (lần làm mới tới: 2/11). GĐ0: **mỗi video ≈ 3%** → khoảng 30 video/tuần.
  - **Additional tokens:** **1 tỷ token, không hết hạn**, chưa dùng (0%).
  - 5 video/ngày ≈ 35 video/tuần ≈ 105% Free plan → cuối tuần có thể dùng sang phần Additional tokens (xem mục 14).
- Google Cloud (service account, Sheets/Drive API): miễn phí trong hạn mức thường dùng.
- Drive 15GB miễn phí chứa khoảng 1.000–2.000 video.
- Máy chạy bot: máy sẵn có, phải bật khi chạy lô.

---

## 14. Câu hỏi còn mở
> Đã chốt 26/10/2026: service account (D5); ảnh gửi bằng link Drive (D14); mỗi video vài phút, ≈3% Free plan/tuần; giới hạn 5 video/ngày (D13).

1. **Máy chạy bot** là máy nào? Có cần người khác trong đội mở giao diện tool từ máy khác (qua LAN) không?
2. Khi **Free plan của tuần hết**, Muse **tự chuyển sang dùng 1 tỷ Additional tokens** hay báo hết lượt? Muse báo hết bằng câu chữ nào? (để bot nhận ra và chuyển `paused_quota`)
   - **Đến 27/10/2026 (CON-42): chưa gặp.** Sau 8 video thật qua tool trong 2 ngày, Muse chưa báo hết lượt lần nào, nên chưa có câu chữ thật và chưa biết Muse có tự dùng Additional tokens không. Bot dò theo các câu phổ biến (`notices.quota` trong `src/bot/museSelectors.ts`: *limit reached*, *out of tokens*, *hết lượt*…). Gặp câu khác thì lượt đó dừng ở *quá thời gian* hoặc lô dừng ở *Giao diện Muse thay đổi*, kèm ảnh chụp trong Nhật ký, không gửi lại; khi đó chép câu thật vào `notices.quota` và vào đây.
3. Sheet thật: tên các cột, đã có cột Trạng thái chưa? (xin 1 link sheet mẫu)
4. ~~Khách đã biết và chấp nhận **rủi ro điều khoản Meta** (mục 10) chưa?~~ **Đã chốt 26/10/2026: khách đã biết và chấp nhận.**

---

## 15. Thứ tự build

### Giai đoạn 0 — Kiểm chứng thủ công (ĐÃ ĐẠT 26/10/2026)
- Đã ghi nhận: ảnh đưa bằng link Drive; mỗi video vài phút; ≈3% Free plan/tuần mỗi video.
- Còn nên ghi lại (không chặn việc build): câu yêu cầu đã dùng (để đối chiếu mẫu 8.2); Muse ghi link đúng ô bao nhiêu lần / bao nhiêu lần thử; chất lượng giữ mặt và hình in áo.

### Giai đoạn 1 — Build tool (mỗi bước là một ticket, duyệt xong mới làm bước sau)
1. **Khung dự án:** Node + TypeScript, server cục bộ + giao diện, SQLite, nạp bí mật qua `op run`.
2. **Google:** service account, đọc tab, ánh xạ cột (F1–F2), ghi đúng một ô Trạng thái.
3. **Quét và chọn dòng** (F3) + bảng có ảnh thu nhỏ.
4. **Chỉnh yêu cầu** (F4): sửa prompt, yêu cầu thêm, chọn thư mục Drive, xem trước yêu cầu gửi Muse.
5. **MuseBot:** mở hồ sơ bot, nhận diện trang đăng nhập, mở cuộc trò chuyện mới, dán và gửi, chụp màn hình khi lỗi.
6. **Chạy lượt + kiểm tra** (F5, mục 7): theo dõi ô Video, kiểm tra D12, phát hiện sửa nhầm ô, khôi phục khi tool tắt giữa chừng.
7. **Tiến độ, lịch sử, nhật ký, cài đặt** (F6–F7).
8. **Chạy đủ 12 tiêu chí** mục 12 với sheet thật, bàn giao kèm hướng dẫn đăng nhập hồ sơ bot.
