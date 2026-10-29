# MASYS Video Generator — Đặc tả sản phẩm (MVP)

> Phiên bản 6.0 · 29/10/2026 · Trạng thái: **GĐ1–GĐ3 xong; GĐ4 "một màn hình" xong CON-49…51 (bản v1.4.0); GĐ5 "không Drive, không sheet" đã chốt, chưa làm (mục 17)**. 6.0: theo góp ý của đội ngày 29/10/2026 → **ảnh chọn từ máy** và bot **đính kèm vào khung chat Muse**; **video tải về máy**, xem / tải / xoá ngay trên Bảng; **bỏ Google Sheet và Drive**, Bảng trong tool là nơi lưu (chỉ còn nút nhập từ sheet); áo hai mặt = 4 ảnh (người mẫu trước/sau, áo trước/sau), ghép trước với trước, sau với sau, ra **một video**; prompt giữ nguyên bối cảnh và nền; giới hạn ngày mặc định 100. Thêm D21–D27, thay D2, D3, D11, D12, D13, D14, D17, D18, D20. Chi tiết ở **mục 17**. 5.0: theo góp ý của đội (giao diện nhiều nút, hướng dẫn dài) → **màn hình chính là một bảng** đồng bộ hai chiều với sheet, chọn dòng rồi **một nút Tạo video**; sửa prompt / dán link / dải prompt / thêm dòng ngay trong app (tool được ghi thêm các ô dữ liệu, D18); áo **hai mặt** (cột Ảnh áo sau, D20); thêm D17–D20, chi tiết ở **mục 16**. 4.4: thêm cột tuỳ chọn **Ảnh áo**; dòng có ảnh áo thì yêu cầu gửi Muse có thêm **đoạn ghép áo** (Muse ghép áo vào ảnh người mẫu rồi tạo video trong cùng một lượt, đã thử tay 28/10/2026), không lưu ảnh ghép. 4.3: thêm D16 (kiểm tra và cập nhật phiên bản ngay trong tool qua GitHub Releases của repo công khai). 4.2: thêm D15 (đóng gói zip cho người trong đội, khoá Google chọn từ file lần đầu và mã hoá trong máy). 4.1: chốt D5 (service account), ảnh gửi Muse bằng link Drive, giới hạn 5 video/ngày (D13), số liệu GĐ0.
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
- **Từ v5.0 (mục 16):** người dùng chỉ cần **một màn hình bảng** trong app: thấy ảnh, prompt, video, trạng thái như trên sheet; sửa ngay trong bảng (tool ghi lên sheet); tích chọn dòng → bấm **Tạo video**. Không cần mở sheet hay Drive.
- **Từ v6.0 (mục 17):** không còn sheet và Drive trong luồng chính. Người dùng **chọn ảnh từ máy** vào Bảng, bấm **Tạo video**; bot đính kèm ảnh vào Muse, chờ video hiện trong cuộc trò chuyện rồi **tải về máy**; video xem, tải về và xoá ngay trên Bảng. Yêu cầu cốt lõi đổi thành: **ảnh và prompt của dòng N thì video về đúng dòng N trên Bảng.**

---

## 1. Bối cảnh

### 1.1 Khách đang làm thế nào
Khách có ảnh người mẫu mặc áo và prompt trong Google Sheet. Hiện tại làm tay: mở công cụ tạo video, dán ảnh + prompt, chờ, tải về, upload Drive, dán link vào sheet. Chậm và dễ dán nhầm dòng.

### 1.2 Kiểu video cần tạo
Mẫu: TikTok [@scarletthayes40](https://www.tiktok.com/@scarletthayes40), [@chloeamira](https://www.tiktok.com/@chloeamira).
- Dọc 9:16, khoảng 8–11 giây, **một cảnh**, như quay bằng điện thoại trong nhà.
- Người mẫu AI mặc áo thun oversized, nhìn camera, vuốt tóc, cười, **chỉ vào hình in trên áo**.
- Lỗi hay gặp nhất: **hình in trên áo bị méo** → prompt luôn có câu dặn giữ nguyên hình in.
- **Áo theo thiết kế riêng (v4.4):** đội thường có ảnh người mẫu và ảnh thiết kế áo riêng. Khi dòng có cả hai, Muse **ghép áo vào người mẫu trước** (giữ mặt, dáng, hình in) rồi dùng ảnh ghép làm video, **trong cùng một lượt**. Người phụ trách đã thử tay trên Muse ngày 28/10/2026: đạt, Muse không hỏi lại. Ảnh ghép không lưu, chỉ lưu video.
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
| **Ánh xạ cột** | Cấu hình cho biết cột nào là Ảnh, Prompt, Video, Trạng thái, và Ảnh áo nếu có. Lưu theo từng sheet và tab |
| **Ảnh áo** | Ảnh thiết kế áo (link Drive) trong cột tuỳ chọn "Ảnh áo". Có thì Muse ghép áo này vào ảnh người mẫu trước khi tạo video |
| **Bảng** (v5.0) | Màn hình chính của app: hiện nội dung tab sheet đã kết nối thành bảng (ảnh, prompt, video, trạng thái), sửa được, đồng bộ hai chiều với sheet (mục 16) |
| **Ảnh áo sau** (v5.0) | Ảnh mặt sau của áo (link Drive) trong cột tuỳ chọn "Ảnh áo sau". Cột "Ảnh áo" hiện có được hiểu là **mặt trước** |
| **Dải prompt** (v5.0) | Lấy prompt của một dòng chép xuống các dòng đã chọn hoặc các dòng bên dưới, ghi lên sheet |
| **Đoạn ghép áo** | Đoạn chữ thêm vào yêu cầu gửi Muse cho dòng có ảnh áo (mục 8.2); dòng không có ảnh áo thì không có đoạn này |
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
| D15 | **Phát hành cho người trong đội bằng một file zip** (`MASYS-Video-vX.Y.Z-win64.zip`, gồm Node chạy liền + tool đã dựng + `Mo-MASYS.bat`); giải nén, bấm đúp là dùng, máy chỉ cần Google Chrome. **Khoá Google trên máy người dùng:** lần đầu mở tool, người dùng chọn file khoá `.json` do người phụ trách gửi riêng; tool kiểm tra, mã hoá bằng Windows DPAPI (gắn với tài khoản Windows đó) rồi lưu ở `%LOCALAPPDATA%\masys-video\google-key.dpapi`. Biến `GOOGLE_SERVICE_ACCOUNT_JSON` (máy phát triển chạy `op run`) luôn được ưu tiên | Người dùng là người trong đội, không rành kỹ thuật, không có 1Password; không cần cài gì thêm | Bộ cài .exe; bắt người dùng cài Node/1Password; nhúng khoá vào zip |
| D16 | **Cập nhật ngay trong tool, chỉ khi người dùng bấm.** Bản mới phát hành trên **GitHub Releases của repo `Bach1711/MASYS-VIDEO-GENERATOR` (công khai)**, kèm file SHA-256 và ghi chú tiếng Việt; tool chỉ tải đúng file zip của repo đó, không cần token. Mỗi lần mở tool, tool hỏi bản mới nhất một lần và chỉ hiện dải báo. Cập nhật: tải → so SHA-256 → sao lưu `data.db` (giữ 3 bản) → giải nén vào `phien-ban\<bản mới>` cạnh bản cũ → khởi động lại; bản mới không lên được trong 60 giây thì tự quay về bản cũ. Giữ một bản trước để bấm **Quay về**. Không cho cập nhật khi đang có lô chạy hoặc có dòng đang gửi / chờ Muse / kiểm tra (D9). Migration chỉ được **thêm** (bảng, cột) để bản cũ vẫn mở được dữ liệu khi quay về | Người trong đội không phải tải và giải nén lại; bản lỗi không làm hỏng máy người dùng | Tự cập nhật ngầm; repo riêng tư + token trong zip; kho phát hành riêng |
| D17 | **Màn hình chính là Bảng, Google Sheet vẫn là nơi lưu** (v5.0). Bảng hiện đúng nội dung tab sheet; sửa trong app thì ghi lên sheet, sửa trên sheet thì app tự đọc lại. Các trang Kết nối sheet, Lịch sử lô, Nhật ký, Bot Muse, Cài đặt gom vào nút **⚙ Nâng cao** | Muse chỉ ghi link video vào sheet (D2, D3) nên sheet phải còn là nơi lưu; cả đội vẫn dùng chung dữ liệu; không cần server | Supabase / database riêng làm nơi lưu (Muse không ghi vào được, phải dựng server, trái D4); giữ nhiều trang như v4 |
| D18 | **Tool được ghi các ô dữ liệu khi người dùng sửa trong bảng** (v5.0): Prompt, Ảnh người mẫu, Ảnh áo, Ảnh áo sau, và thêm dòng mới ở cuối. **Không bao giờ ghi ô Video** (chỉ Muse ghi). Bot khi chạy vẫn chỉ ghi ô Trạng thái. Trước khi ghi, tool đọc lại ô: giá trị khác lúc người dùng bắt đầu sửa → **không ghi**, báo *"Ô này vừa được người khác sửa"*. Không sửa được dòng đang chạy. **Không xoá dòng, không chèn dòng giữa bảng** từ app | Người dùng không phải mở sheet; tránh đè chữ của người khác; giữ "dòng N" ổn định cho bot | Chỉ sửa bản gửi Muse (v4, F4); cho xoá / chèn / sắp xếp dòng trong app |
| D19 | **Một nút Tạo video** (v5.0): tích chọn dòng → bấm **Tạo video (N dòng)** là tạo lô với cài đặt mặc định (thư mục Drive gốc, mẫu yêu cầu trong Cài đặt) và chạy luôn; trạng thái và video hiện ngay trên từng dòng của bảng. Xem trước yêu cầu gửi Muse là tuỳ chọn (mở từng dòng). Mọi lớp an toàn giữ nguyên (D6, D9–D13, mục 7). Muse chưa đăng nhập → tự mở cửa sổ bot, báo *"Hãy đăng nhập Muse rồi bấm Tiếp tục"* | Bớt bước: góp ý "quá nhiều nút" | Giữ các bước Tạo lô → Xem trước → Bắt đầu |
| D20 | **Áo hai mặt** (v5.0): cột tuỳ chọn **Ảnh áo sau**. Dòng có cả hai mặt dùng **đoạn ghép áo hai mặt** (mẫu riêng trong Cài đặt) để Muse tạo **một video** thấy cả mặt trước và mặt sau; dòng chỉ có mặt trước dùng đoạn ghép áo như v4.4. **Chỉ làm sau khi người phụ trách thử tay trên Muse đạt**; không đạt thì phương án dự phòng là mỗi mặt một video (cần chốt lại) | Góp ý của đội: một mẫu có cả mặt trước và mặt sau | Luôn hai video mỗi dòng; ghép hai mặt thành một ảnh trước khi gửi |
| D21 | **Bảng trong tool là nơi lưu** (v6.0, thay D17, D18, D11): mỗi dòng của Bảng nằm trong SQLite cục bộ, gồm ảnh, prompt, video và trạng thái. Tool **không đọc / ghi Google Sheet khi chạy**; chỉ còn nút **Nhập từ Google Sheet** để lấy dòng cũ, chạy một chiều và chỉ đọc. Dòng mới đánh số tăng dần, **không bao giờ đánh lại số** | Góp ý 29/10: không muốn mở sheet / Drive; sheet không chứa được ảnh và video tải từ máy | Giữ sheet làm nơi lưu (D17); Supabase (D4) |
| D22 | **Ảnh chọn từ máy, bot đính kèm vào khung chat Muse** (v6.0, thay D14): tool chép ảnh vào thư mục dữ liệu; bot đính kèm đúng thứ tự cố định (mục 17.4) và chỉ bấm Gửi khi Muse đã hiện đủ số ảnh | Góp ý 29/10: không muốn đưa ảnh lên Drive. Service account không có dung lượng Drive để tải hộ | Tool tải ảnh lên Drive bằng tài khoản người dùng / Drive dùng chung |
| D23 | **Video tải về máy, không lưu Drive** (v6.0, thay D2, D3, D12): tín hiệu xong là **video hiện trong cuộc trò chuyện Muse của dòng đó**. Bot tải file về; tool kiểm tra là video đọc được rồi gắn vào dòng. Muse không lưu Drive, không ghi sheet | Góp ý 29/10: video dùng xong là thôi, không cần Drive. Mỗi dòng một cuộc trò chuyện mới (D7) nên video trong cuộc trò chuyện chắc chắn thuộc dòng đó | Giữ Drive và chỉ phát video trên Bảng |
| D24 | **Áo hai mặt = 4 ảnh, một video** (v6.0, thay D20): người mẫu trước, áo trước, người mẫu sau, áo sau. Muse ghép **trước với trước, sau với sau** (không tự dựng mặt sau) rồi tạo **một video** theo **mẫu yêu cầu hai mặt** riêng. Không cần thử tay trước (người phụ trách chốt 29/10) | Đội có sẵn ảnh người mẫu quay lưng và thiết kế mặt sau | Muse tự dựng mặt sau; hai video mỗi dòng |
| D25 | **Giới hạn ngày mặc định 100, tối đa 150** (v6.0, sửa số của D13; cách đếm và chặn giữ nguyên). Vẫn chạy tuần tự (D7) | Đội cần 50–100 video/ngày. Hạn mức Muse do người phụ trách lo; Muse báo hết lượt thì dừng lô (`paused_quota`) | Chạy song song nhiều cuộc trò chuyện |
| D26 | **Dọn file do người dùng bấm** (v6.0): nút **Xoá** từng dòng và **Dọn tất cả**, có hỏi lại và hiện dung lượng. Tool không tự xoá | Người dùng tự quyết khi nào đã dùng xong video | Tự xoá sau N ngày |
| D27 | **Prompt giữ nguyên bối cảnh và nền** (v6.0, từ v1.4.1): mẫu yêu cầu dặn Muse giữ nguyên nền, bối cảnh, ánh sáng của ảnh người mẫu, từ prompt chỉ lấy động tác / biểu cảm / cách quay; đoạn ghép áo chỉ thay chiếc áo | Góp ý 29/10: video bị đổi bối cảnh, ghép áo làm mất nền | Bắt người dùng tự sửa từng prompt |

> Từ v6.0: D2, D3, D11, D12, D14, D17, D18, D20 **không còn áp dụng cho luồng mới** (thay bởi D21–D24); số của D13 đổi theo D25. Các dòng cũ giữ lại để tra lịch sử. Bản v1.x vẫn chạy theo chúng cho tới khi GĐ5 xong (mục 17.8).

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
- Bí mật duy nhất của tool là **khoá service account**, nạp qua `op run` (máy phát triển) hoặc từ file khoá đã mã hoá DPAPI (bản zip, D15).

---

## 5. Luồng người dùng

### 5.0 Chuẩn bị (làm một lần)
1. Tạo **service account** trên Google Cloud, bật Sheets API + Drive API, lưu khoá JSON vào 1Password.
2. **Chia sẻ** sheet (quyền sửa) và thư mục Drive gốc chứa video (quyền xem) cho email service account. Sheet và Drive cũng phải chia sẻ cho tài khoản Google đã nối MCP trong Muse.
3. Cài tool trên máy chạy bot, mở tool, bấm **"Mở trình duyệt bot"** → tự đăng nhập Muse trong cửa sổ đó (D6).
4. **Ánh xạ cột** cho sheet: dán link sheet, chọn tab, xác nhận cột Ảnh, Prompt, Video, Trạng thái, và cột Ảnh áo nếu sheet có.

### 5.1 Dùng hằng ngày
1. Mở tool → chọn sheet/tab → bấm **Quét**. Bảng hiện mọi dòng: ảnh (thu nhỏ; dòng có ảnh áo hiện thêm ảnh áo), prompt, trạng thái. Dòng có link trong ô Video hiện nhãn **"Đã có video"**.
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
- Cột tuỳ chọn thứ 5 (v4.4): **Ảnh áo** (link Drive ảnh thiết kế áo). Mặc định "Không có". Tự đoán theo tiêu đề "Ảnh áo"; cột "Ảnh" và cột "Ảnh áo" không được đoán lẫn sang nhau. Sheet đã kết nối từ trước chạy như cũ (coi như không có cột Ảnh áo) cho tới khi người dùng chọn thêm.
- Chọn dòng tiêu đề (mặc định dòng 1); tự đoán cột theo tên tiêu đề; lưu theo `(spreadsheetId, tab)`.

**F3. Quét và chọn dòng**
- Đọc toàn bộ vùng dữ liệu của tab; mỗi dòng gắn nhãn:
  - **Đã có video:** ô Video có link → không chọn được (trừ khi tích Ghi đè).
  - **Thiếu dữ liệu:** thiếu ảnh hoặc prompt → không chọn được. Ô Ảnh áo **có ghi** nhưng không phải link Drive hoặc không mở được → cũng Thiếu dữ liệu, kèm lý do. Ô Ảnh áo trống thì không sao: dòng chạy như không có ảnh áo.
  - **Đang chạy:** ô Trạng thái là `Đang chạy` → không chọn được (có thể đang chạy ở lô khác hoặc lượt trước bị ngắt; có nút "Bỏ khoá" kèm xác nhận).
  - **Sẵn sàng.**
- Nút **Quét lại**; tool cũng **đọc lại dòng ngay trước khi gửi Muse**.
- Luôn hiện **"Hôm nay: X/5 video"** (D13). Số dòng chọn vượt số còn lại thì nút Chạy bị khoá kèm lời nhắc.

**F4. Chỉnh yêu cầu**
- Mỗi dòng có ô sửa prompt (mặc định = prompt trong sheet) và ô **Yêu cầu thêm**. Có ô **Yêu cầu thêm chung cho cả lô**.
- Chọn **thư mục Drive** cho lô: chọn từ thư mục gốc (tool liệt kê thư mục con bằng service account) hoặc dán link thư mục.
- Xem trước **yêu cầu gửi Muse** đầy đủ trước khi chạy (dòng có ảnh áo: gồm cả đoạn ghép áo). Mẫu chính thiếu chỗ `{doan_ghep_ao}` mà lô có dòng có ảnh áo → trang Xem trước cảnh báo "dòng có ảnh áo sẽ không được ghép".
- Bản chỉnh sửa **không ghi ngược vào sheet**; lưu trong lịch sử lô. *(v5.0: trên Bảng, sửa prompt là sửa thẳng ô Prompt trên sheet (D18); trang chỉnh yêu cầu kiểu v4 chỉ còn trong ⚙ Nâng cao.)*

**F5. Chạy một lượt (MuseBot)**
1. Đọc lại dòng N: còn đúng ảnh/ảnh áo/prompt lúc chọn không, ô Video còn trống không (trừ Ghi đè).
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
- Thời gian chờ tối đa mỗi lượt (mặc định 20 phút; GĐ0 mất vài phút/video), khoảng nghỉ giữa lượt, **giới hạn video/ngày** (mặc định 5, D13), thư mục Drive gốc, mẫu yêu cầu gửi Muse và **đoạn ghép áo** (sửa được, mục 8.2), URL trang Muse.
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
{doan_ghep_ao}
Giữ nguyên nền, bối cảnh và ánh sáng của ảnh người mẫu; không đổi sang phòng hay khung cảnh khác.
Từ prompt dưới đây chỉ lấy động tác, biểu cảm và cách quay; bỏ qua mọi mô tả bối cảnh, phòng, ánh sáng.
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

**Đoạn ghép áo (v4.4).** Mẫu riêng, sửa được trong Cài đặt, bắt buộc có `{link_anh_ao}`. Mặc định:

```
Ảnh áo: {link_anh_ao}
Hãy ghép chiếc áo trong ảnh áo vào người mẫu trong ảnh người mẫu ở trên: chỉ thay chiếc áo, giữ nguyên khuôn mặt, tóc, dáng, tư thế, nền, bối cảnh và ánh sáng của ảnh người mẫu, giữ nguyên hình in trên áo. Dùng ảnh vừa ghép để tạo video theo prompt dưới đây. Không cần lưu ảnh vừa ghép.
```

(v1.4.1, D27: thêm hai dòng giữ bối cảnh / chỉ lấy động tác vào mẫu chính, và "chỉ thay chiếc áo, giữ nguyên nền…" vào đoạn ghép áo. Máy dùng mẫu gốc tự nhận câu mới; máy đã sửa mẫu giữ bản của mình. Phỏng theo câu người phụ trách đã thử tay thành công ngày 28/10/2026. Khi thử tay, Muse tự đọc link ảnh từ sheet; tool đưa thẳng hai link vào yêu cầu theo D14, chắc chắn hơn và Muse không phải đọc sheet.)

- Dòng **có** ảnh áo: `{doan_ghep_ao}` trong mẫu chính được thay bằng đoạn ghép áo đã điền `{link_anh_ao}` (link Drive từ cột Ảnh áo, kiểm tra như ảnh người mẫu). Dòng **không có** ảnh áo: `{doan_ghep_ao}` thành rỗng, không để lại dòng trống thừa.
- `{doan_ghep_ao}` không bắt buộc trong mẫu chính (để mẫu đã sửa trước v4.4 vẫn hợp lệ), nhưng thiếu thì Cài đặt và trang Xem trước báo rõ.
- Muse vẫn chỉ lưu **video** và chỉ ghi **ô Video**; ảnh ghép không lưu đi đâu. Mọi kiểm tra ở F5 giữ nguyên.

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
  - **Dò khả năng cho v6.0 (29/10/2026, CON-71 bước đầu, 17.7):**
    - **Đính kèm ảnh: đạt.** Ô chat có `input[type=file]` (`multiple`, không giới hạn `accept`), cạnh nút *"Attach file"* (dấu +). Đính kèm 4 ảnh một lần → Muse hiện 4 ảnh xem trước, mỗi ảnh một nút *"Remove attachment"*; nút *"Send"* hiện ra. Đếm nút *Remove attachment* để biết Muse đã nhận đủ ảnh.
    - **Video trong cuộc trò chuyện: đạt.** Gửi thật một lần (người phụ trách đồng ý; ảnh dòng 2 đính kèm từ máy, yêu cầu theo 17.4, dặn không lưu Drive / không sửa sheet): Muse trả lời sau ≈4 phút, video **hiện ngay trong khung chat** dạng thẻ `<video>` (nguồn `blob:`), 720×1280, 10 giây; Muse tự xác nhận giữ nền và bối cảnh. Không có nút Download trên giao diện; bot **đọc blob ngay trong trang** (`fetch(blob)`) → file MP4 hợp lệ (`ftypisom`, ≈2 MB). Cuộc trò chuyện cũ được dặn lưu Drive thì chỉ có link Drive, không có video.
    - Phân biệt video kết quả với **ảnh đại diện động của trợ lý** (cũng là `<video>` 720×720, ở bảng bên phải, rộng 128 px hoặc 48 px): chỉ lấy `<video>` trong khung chat (rộng > 150 px, nằm ở cột giữa).
    - Đang làm thì có nút *"Stop task"* / *"Stop"*; đóng trình duyệt giữa chừng **không** dừng việc của Muse (Muse làm trên máy chủ), mở lại cuộc trò chuyện là thấy kết quả.
    - Library → Videos có vài video cũ nhưng không đủ và tải chậm: không dùng.
  - Câu báo hết lượt / từ chối / lỗi của Muse: chưa gặp (đến 27/10/2026, xem §14.2); bot đang dò theo các câu phổ biến, gặp câu thật thì ghi bổ sung vào đây.

---

## 9. Dữ liệu cục bộ (SQLite)

| Bảng | Các trường chính |
|---|---|
| `settings` | `driveRootFolderId`, `timeoutMinutes`, `pauseMinSec`, `pauseMaxSec`, `dailyVideoLimit` (mặc định 5), `museUrl`, `requestTemplate`, `shirtTemplate` (đoạn ghép áo, v4.4) |
| `sheet_configs` | `spreadsheetId`, `tab`, `headerRow`, `colImage`, `colPrompt`, `colVideo`, `colStatus`, `colShirt` (có thể trống, v4.4) |
| `batches` | `id`, `spreadsheetId`, `tab`, `driveFolderId`, `extraRequest`, `status`, `createdAt` |
| `runs` | `id`, `batchId`, `rowNumber`, `inputSnapshot` (ảnh, ảnh áo nếu có, prompt gốc), `promptSent`, `requestText`, `overwrite`, `state`, `error`, `sentAt`, `doneAt`, `videoLink`, `driveFileId`, `museChatUrl` |
| `run_events` | `runId`, `at`, `fromState`, `toState`, `message`, `screenshotPath?` |

File SQLite và ảnh chụp màn hình nằm ngoài repo (cùng thư mục với hồ sơ bot).

---

## 10. Bảo mật và rủi ro

- **Bí mật:** chỉ có khoá service account. `.env` chứa `op://…`; chạy `op run --env-file=.env -- <lệnh>`. Không commit, không log. Bản zip (D15): khoá chỉ nằm trong `google-key.dpapi` đã mã hoá theo tài khoản Windows; không bao giờ nằm trong thư mục zip, SQLite hay log. File zip được `check-secrets` quét trước khi phát hành.
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
- ~~Ghi prompt đã chỉnh ngược vào sheet.~~ v5.0 cho phép khi sửa trên Bảng (D18).
- Supabase hoặc database riêng làm nơi lưu dữ liệu (D17).
- Tải ảnh từ máy lên Drive trong app (v5.0): khoá service account không có dung lượng Drive riêng; chỉ làm được khi có **Shared Drive** (Google Workspace). Đợt đầu người dùng dán link Drive vào bảng.
- Xoá, chèn giữa, sắp xếp dòng từ app (D18).

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

### Giai đoạn 2 — Phát hành cho đội
9. **Đóng gói zip** (D15, CON-43): `npm run package`, `Mo-MASYS.bat`, cài khoá Google lần đầu, số phiên bản hiện trên tool.
10. **Kiểm tra và cập nhật phiên bản ngay trong tool** (D16, CON-44): `npm run release`, nút Kiểm tra / Cập nhật / Quay về trong Cài đặt.
11. **Sửa lỗi cập nhật** (CON-45, v1.0.2): tải bản mới song song nhiều đoạn, tự thử lại và tải tiếp khi mạng chập chờn.

### Giai đoạn 3 — Theo góp ý của đội
12. **Ghép ảnh áo** (v4.4, CON-46, v1.1.0): cột tuỳ chọn Ảnh áo (F2), ảnh thu nhỏ và kiểm tra link ảnh áo (F3), đoạn ghép áo trong yêu cầu gửi Muse và trong Cài đặt (§8.2, F7), xem trước (F4). Migration chỉ thêm cột (`sheet_configs.colShirt`, `settings.shirtTemplate`).
13. **Sửa lỗi cập nhật EPERM** (CON-47, v1.1.1): chờ / sao chép khi phần mềm diệt virus giữ file bản mới.
14. **Logo MASYS** (CON-48, v1.1.2): tab Chrome, thanh trên cùng, Trang chủ.
- Góp ý khác ngày 28/10/2026: cần tới ~100 video/ngày. Người phụ trách chốt **chưa đổi D13 / giới hạn tối đa**: người làm video tự đặt 50 trong Cài đặt (giới hạn hiện cho 1–50) là đủ; nâng hơn 50 để sau.

### Giai đoạn 4 — Một màn hình (v5.0, mục 16; mỗi bước một ticket, một bản phát hành)
15. **Bảng + một nút Tạo video** (D17, D19): màn hình chính là bảng đọc từ sheet, chọn dòng / chọn tất cả, nút Tạo video, trạng thái và video trên từng dòng, ⚙ Nâng cao.
16. **Sửa ngay trên bảng** (D18): sửa prompt và link, dải prompt, thêm dòng, kiểm tra xung đột trước khi ghi.
17. **Bắt đầu nhanh, hướng dẫn gọn**: danh sách 3 bước lần đầu ngay trên màn hình, chữ gợi ý tại chỗ, kết nối sheet một bước, README ngắn.
18. **Áo hai mặt** (D20): chỉ làm sau khi thử tay trên Muse đạt. *(v6.0: gộp vào GĐ5 bước 21 theo D24.)*

### Giai đoạn 5 — Không Drive, không sheet (v6.0, mục 17; mỗi bước một ticket, một bản phát hành)
19. **Prompt giữ bối cảnh và nền** (D27), v1.4.1: sửa mẫu yêu cầu và đoạn ghép áo mặc định của luồng hiện tại.
20. **Bảng cục bộ + ảnh từ máy** (D21, D22, D25), v1.5.0: mở đầu bằng việc dò khả năng bot (mục 17.7); Bảng mới chạy song song với Bảng cũ (mục 17.8).
21. **Bot đính kèm ảnh + áo hai mặt** (D22, D24), v1.6.0.
22. **Tải video về + xem / tải / xoá / dọn** (D23, D26), v2.0.0: Bảng mới thành màn hình chính.

---

## 16. Bản 5.0 — Một màn hình (theo góp ý của đội, 28/10/2026)

### 16.1 Vấn đề
Đội nhận xét video đầu ra ổn nhưng **giao diện phức tạp**: phải qua Kết nối sheet → Quét → chọn → Chuẩn bị lô → Xem trước → Bắt đầu, lại phải mở sheet và Drive ở trình duyệt khác để xem và sửa dữ liệu; **hướng dẫn quá dài**. Mục tiêu: người dùng **nhìn một lần là biết dùng**, mỗi việc chỉ **1–2 lần bấm**.

### 16.2 Màn hình chính (Bảng)
```
[Logo] MASYS Video   Sheet: Masys Video › Trang tính1 ▾      Muse: ✅ đã đăng nhập   Hôm nay 2/50   ⚙
┌──┬───┬───────────┬──────────┬──────────┬──────────────────────┬─────────┬───────────┐
│☐ │ # │ Người mẫu │ Áo trước │ Áo sau   │ Prompt               │ Video   │ Trạng thái│
│☑ │ 2 │ [ảnh]     │ [ảnh]    │ [ảnh]    │ Người mẫu xoay…  ✎   │         │ Sẵn sàng  │
│☑ │ 3 │ [ảnh]     │ [ảnh]    │  +       │ Người mẫu xoay…  ✎   │         │ Sẵn sàng  │
│☐ │ 4 │ [ảnh]     │  +       │  +       │ …                ✎   │ [▶ Xem] │ Xong      │
│  │ + │ Thêm dòng                                                                     │
└──┴───┴───────────┴──────────┴──────────┴──────────────────────┴─────────┴───────────┘
[☑ Chọn mọi dòng chưa có video]   [Dải prompt ▾]                     [▶ Tạo video (2 dòng)]
```
- **Đầu trang:** chọn sheet/tab (nhớ lần dùng trước), trạng thái đăng nhập Muse, số video hôm nay / giới hạn (D13), nút ⚙ Nâng cao.
- **Mỗi dòng** = một dòng sheet, đúng số dòng N. Ảnh thu nhỏ (bấm để xem lớn), prompt (bấm ✎ để sửa), video (bấm ▶ để xem trên Drive), nhãn trạng thái như F3 (Sẵn sàng / Đã có video / Thiếu dữ liệu / Đang chạy / Xong / Lỗi / Cần xem).
- **Chọn:** ô tích từng dòng, **Chọn mọi dòng chưa có video** (chỉ chọn dòng Sẵn sàng, không vượt số video còn lại hôm nay). Dòng Đã có video vẫn cần tích *Ghi đè* (D10).
- **Tạo video (N dòng)** (D19): tạo lô + chạy ngay. Nút khoá khi: không chọn dòng nào, vượt giới hạn ngày, đang có lô chạy (khi đó nút thành **Tạm dừng / Tiếp tục**).
- **Đang chạy:** dòng đang gửi sáng lên, nhãn đổi theo mục 7 (Đang gửi → Chờ Muse → Kiểm tra → Xong). Video xong hiện ngay ô Video. Bảng tự làm mới: ~5 giây khi có lô chạy, ~30 giây khi rảnh, và có nút 🔄.

### 16.3 Đồng bộ với sheet (D17, D18)
| Việc | Kết quả |
|---|---|
| Mở app / làm mới | Tool đọc tab sheet (service account) và vẽ lại bảng |
| Sửa ô trong bảng (Prompt, Ảnh người mẫu, Ảnh áo, Ảnh áo sau) | Tool đọc lại ô; còn đúng giá trị lúc bắt đầu sửa thì ghi lên sheet, khác thì báo *"Ô này vừa được người khác sửa"* và hiện giá trị mới |
| Dán link ảnh | Kiểm tra như F3 (link Drive, đọc được bằng service account) rồi mới ghi; sai thì báo ngay tại ô |
| **Thêm dòng** | Ghi vào dòng trống đầu tiên **sau dòng dữ liệu cuối** (không chèn giữa) |
| **Dải prompt** | Chọn dòng nguồn → *Áp cho các dòng đã chọn* hoặc *Dải xuống tới dòng cuối*; trước khi ghi hiện *"Sẽ thay prompt của N dòng"* để xác nhận; bỏ qua dòng Đang chạy / Đã có video (trừ khi tích) |
| Người khác sửa trực tiếp trên sheet | Lần làm mới sau bảng hiện giá trị mới |
| Muse ghi link video | Bảng hiện video ở dòng đó (như F5) |
- Mỗi lần ghi chỉ ghi **đúng các ô người dùng sửa**, mỗi ô ghi một lần; ghi vào nhật ký (ô, giá trị cũ, giá trị mới, giờ).
- Tool **không bao giờ** ghi ô Video; không xoá / chèn / sắp xếp dòng (D18).
- Dòng đang trong lô (từ lúc bấm Tạo video tới khi xong) **khoá sửa**; F5 bước 1 vẫn đọc lại dòng trước khi gửi.

### 16.4 Áo hai mặt (D20)
- Cột **Ảnh áo** hiện có = mặt trước; thêm cột tuỳ chọn **Ảnh áo sau** (tự đoán tiêu đề "Ảnh áo sau", "Mặt sau"…).
- Có mặt sau mà không có mặt trước → Thiếu dữ liệu.
- **Đoạn ghép áo hai mặt** (mẫu riêng, sửa trong Cài đặt), có `{link_anh_ao}` và `{link_anh_ao_sau}`. Câu mặc định (chốt sau khi thử tay): *"Ảnh áo: {link_anh_ao} (mặt trước). Ảnh áo mặt sau: {link_anh_ao_sau}. Hãy ghép áo này vào người mẫu ở trên, rồi dựa theo prompt dưới đây tạo một video người mẫu xoay người để thấy cả mặt trước và mặt sau áo. Giữ nguyên khuôn mặt người mẫu và hình in từng mặt. Không cần lưu ảnh vừa ghép."*
- Trước khi code: người phụ trách **thử tay trên Muse** với một dòng có hai mặt. Không đạt → chốt lại phương án (mỗi mặt một video).

### 16.5 Bắt đầu nhanh, hướng dẫn gọn
- Lần đầu mở (hoặc khi thiếu bước), trên Bảng hiện **3 bước** có dấu ✅: *1. Chọn file khoá Google* (đã có, D15) · *2. Dán link sheet* (tool tự đoán cột, bấm **Xác nhận** một lần; chỉ hiện chọn cột khi đoán không ra) · *3. Đăng nhập Muse* (nút mở cửa sổ bot).
- Chữ gợi ý ngắn ngay chỗ cần (ví dụ cạnh ô link: *"Dán link Drive của ảnh, chế độ 'Bất kỳ ai có đường liên kết'"*).
- README rút còn ~1 trang: cài, mở, 3 bước, chỗ hỏi khi lỗi. Hướng dẫn chi tiết cũ chuyển vào phần Nâng cao.

### 16.6 Giữ nguyên
- Kiến trúc (D1–D4), service account (D5), đăng nhập tay (D6), tuần tự + cuộc trò chuyện mới (D7–D8), không tự gửi lại (D9), kiểm tra sau khi Muse xong (D12), giới hạn ngày (D13), ảnh bằng link Drive (D14), phát hành và cập nhật (D15–D16).
- Các trang v4 vẫn còn trong **⚙ Nâng cao** cho người phụ trách (ánh xạ cột thủ công, mẫu yêu cầu, lịch sử lô, nhật ký, phiên bản).
- Migration SQLite chỉ thêm (D16).

---

## 17. Bản 6.0 — Không Drive, không sheet (theo góp ý của đội, 29/10/2026)

### 17.1 Góp ý (Google Doc "Tool tạo video", thẻ Take note, mục 29/10/2026)
1. Không muốn lưu ảnh áo và ảnh người mẫu trên Drive, muốn **tải thẳng từ máy lên**.
2. Không muốn video lưu trên Drive, muốn **hiện ngay trên bảng, bấm xem và tải về được**. Video dùng xong là thôi.
3. Prompt tạo video phải **bỏ các chữ làm đổi bối cảnh**, chỉ giữ động tác của nhân vật.
4. Prompt ghép ảnh **không được làm mất nền** của ảnh người mẫu.
5. Thêm ảnh **mặt sau**: có ảnh người mẫu quay lưng và thiết kế áo mặt sau; ghép trước với trước, sau với sau.

Người phụ trách chốt thêm trong chat: bỏ hẳn sheet (chỉ giữ nút nhập), áo hai mặt ra một video với mẫu yêu cầu riêng, xoá file do người dùng tự bấm, cần 50–100 video/ngày, không cần thử tay trên Muse trước.

### 17.2 Màn hình chính (Bảng mới)
```
[Logo] MASYS Video     Muse: ✅ đã đăng nhập   Hôm nay 12/100   Đang dùng 1,4 GB   ⚙
[Tất cả] [Hôm nay] [Chưa tạo] [Đang chạy] [Xong] [Lỗi]          🔍 tìm số dòng / chữ trong prompt
┌──┬────┬──────────┬─────────┬──────────┬────────┬──────────────────┬──────────────┬───────────┐
│☐ │ #  │ Mẫu trước│ Áo trước│ Mẫu sau  │ Áo sau │ Prompt           │ Video        │ Trạng thái│
│☑ │ 41 │ [ảnh]    │ [ảnh]   │ [ảnh]    │ [ảnh]  │ Xoay người… ✎    │              │ Sẵn sàng  │
│☑ │ 42 │ [ảnh]    │ [ảnh]   │  +       │  +     │ Vuốt tóc…   ✎    │              │ Sẵn sàng  │
│☐ │ 40 │ [ảnh]    │  +      │  +       │  +     │ …           ✎    │ [▶] [⬇] [🗑] │ Xong      │
│  │ +  │ Thêm dòng (hoặc kéo thả nhiều ảnh vào đây)                                              │
└──┴────┴──────────┴─────────┴──────────┴────────┴──────────────────┴──────────────┴───────────┘
[☑ Chọn mọi dòng chưa có video] [Dải prompt ▾] [Nhập từ Google Sheet]  [Dọn tất cả]  [▶ Tạo video (2 dòng)]
```
- **Ô ảnh:** bấm **+** để chọn ảnh từ máy, hoặc kéo thả. Bấm ảnh để xem lớn, có nút đổi / bỏ ảnh. Nhận JPG, PNG, WEBP, mỗi ảnh tối đa 20 MB (giới hạn thật của Muse chốt ở 17.7). Tool **chép** ảnh vào thư mục dữ liệu, nên người dùng xoá ảnh gốc trên máy cũng không sao.
- **Thêm dòng:** một dòng trống, hoặc kéo thả nhiều ảnh vào thì mỗi ảnh thành một dòng mới với ảnh đó là *Mẫu trước*.
- **Prompt, chọn tất cả, dải prompt, Tạo video, Tạm dừng / Tiếp tục:** như v5.0 (16.2), chỉ khác là ghi vào Bảng chứ không ghi sheet.
- **Ô Video:** ảnh nhỏ của video, chỉ tải khi bấm ▶ (xem ngay trên trang), **⬇ Tải về** (lưu vào thư mục Tải xuống của trình duyệt, tên file `MASYS_<số dòng>_<YYYYMMDD-HHmm>.mp4`), **🗑 Xoá**.
- **Số dòng** (#) tăng dần, không bao giờ đánh lại, kể cả khi đã xoá dòng (D21).
- **Dòng đang trong lô** khoá sửa và khoá xoá.

### 17.3 Dữ liệu (D21)
- Thư mục file: `%LOCALAPPDATA%\masys-video\tep\anh\` và `tep\video\`. Tên file do tool đặt (số dòng + loại + giờ), không dùng tên gốc.
- Bảng SQLite mới (chỉ **thêm**, theo D16):
  - `bang_rows`: `id` (số dòng), `createdAt`, `prompt`, `modelFront`, `shirtFront`, `modelBack`, `shirtBack` (đường dẫn file tương đối, có thể trống), `videoFile`, `videoBytes`, `videoAt`, `deletedAt`, `importedFrom` (sheet, tab, dòng nếu nhập từ sheet).
  - `runs` thêm cột `bangRowId` (lượt của Bảng mới); các cột cũ để trống với lượt mới.
  - `settings` thêm `twoSidedTemplate` (mẫu hai mặt).
- Bảng cũ (`sheet_configs`, `sheet_edits`, các lô theo sheet) giữ nguyên để bản cũ và trang Nâng cao còn đọc được.

### 17.4 Yêu cầu gửi Muse (D22, D24, D27)
Ảnh luôn đính kèm theo **thứ tự cố định**: 1 = người mẫu trước, 2 = áo trước, 3 = người mẫu sau, 4 = áo sau (bỏ ảnh không có, giữ thứ tự còn lại).

| Dòng có | Ảnh đính kèm | Mẫu dùng |
|---|---|---|
| Chỉ người mẫu trước | 1 | Mẫu thường, `{doan_ghep_ao}` rỗng |
| Người mẫu trước + áo trước | 1, 2 | Mẫu thường + đoạn ghép áo |
| Đủ 4 ảnh | 1, 2, 3, 4 | **Mẫu hai mặt** |
| Có người mẫu sau hoặc áo sau nhưng thiếu ảnh nào trong 4 | — | **Thiếu dữ liệu**, kèm lý do |
| Không có người mẫu trước, hoặc không có prompt | — | **Thiếu dữ liệu** |

Mẫu thường (mặc định, sửa được trong Cài đặt):
```
Tôi gửi kèm {so_anh} ảnh: {danh_sach_anh}.
Hãy tạo một video dọc 9:16, dài khoảng 8–10 giây, một cảnh, từ ảnh người mẫu (ảnh 1).
{doan_ghep_ao}
Giữ nguyên nền, bối cảnh và ánh sáng của ảnh người mẫu; không đổi sang phòng hay khung cảnh khác.
Từ prompt dưới đây chỉ lấy động tác, biểu cảm và cách quay; bỏ qua mọi mô tả bối cảnh, phòng, ánh sáng.
Prompt: {prompt}
Yêu cầu thêm: {yeu_cau_them}
Luôn giữ nguyên hình in trên áo, không làm méo hay đổi chữ/hình.
Tạo xong thì gửi video ngay trong cuộc trò chuyện này. Không lưu lên Google Drive, không sửa Google Sheet.
```
Đoạn ghép áo (mặc định):
```
Trước khi tạo video, hãy ghép chiếc áo ở ảnh 2 vào người mẫu ở ảnh 1: chỉ thay chiếc áo, giữ nguyên khuôn mặt, tóc, dáng, tư thế, nền, bối cảnh và ánh sáng của ảnh 1, giữ nguyên hình in trên áo. Dùng ảnh vừa ghép để tạo video. Không cần lưu ảnh vừa ghép.
```
Mẫu hai mặt (mặc định):
```
Tôi gửi kèm 4 ảnh: ảnh 1 là người mẫu mặt trước, ảnh 2 là thiết kế áo mặt trước, ảnh 3 là người mẫu mặt sau (quay lưng), ảnh 4 là thiết kế áo mặt sau.
Bước 1: ghép áo ở ảnh 2 vào người mẫu ở ảnh 1, và ghép áo ở ảnh 4 vào người mẫu ở ảnh 3. Chỉ thay chiếc áo; giữ nguyên khuôn mặt, tóc, dáng, nền, bối cảnh và ánh sáng của từng ảnh người mẫu; giữ nguyên hình in từng mặt. Không tự dựng thêm mặt nào.
Bước 2: dùng hai ảnh vừa ghép tạo một video dọc 9:16, dài khoảng 8–10 giây, một cảnh: người mẫu bắt đầu ở mặt trước rồi xoay người để thấy mặt sau áo.
Giữ nguyên nền và bối cảnh của ảnh người mẫu. Từ prompt dưới đây chỉ lấy động tác, biểu cảm và cách quay; bỏ qua mọi mô tả bối cảnh, phòng, ánh sáng.
Prompt: {prompt}
Yêu cầu thêm: {yeu_cau_them}
Tạo xong thì gửi video ngay trong cuộc trò chuyện này. Không lưu lên Google Drive, không sửa Google Sheet. Không cần lưu ảnh vừa ghép.
```
- `{danh_sach_anh}` do tool điền, ví dụ *"ảnh 1 là người mẫu, ảnh 2 là thiết kế áo"*.
- Câu chữ mặc định có thể chỉnh sau khi chạy thật; người dùng sửa mẫu trong Cài đặt thì tool cảnh báo khi thiếu `{prompt}`.

### 17.5 Chạy một lượt (thay F5 cho Bảng mới)
1. **Đọc lại dòng** trong SQLite: còn đủ file ảnh trên đĩa, prompt còn, chưa có video (trừ Ghi đè). Thiếu → `needs_review`, không gửi.
2. Mở **cuộc trò chuyện mới** (side chat, D7). Ghi `museChatUrl` ngay khi có.
3. **Đính kèm ảnh** theo thứ tự 17.4, chờ Muse hiện đủ số ảnh xem trước. Không đủ trong thời gian chờ ngắn → `paused_ui` (chưa gửi nên không vi phạm D9).
4. Dán yêu cầu, ghi `sentAt` **trước** khi bấm Gửi, bấm Gửi.
5. **Chờ video xuất hiện trong cuộc trò chuyện** (dò mỗi 20 giây), đồng thời dò đăng nhập / captcha / chờ duyệt / lỗi / hết lượt như cũ. Quá thời gian chờ → `needs_review`.
6. **Tải video** (trạng thái mới `downloading`) bằng phiên của hồ sơ bot, lưu vào `tep\video\`. Lỗi tải → `needs_review`, giữ `museChatUrl` để người dùng tự mở cuộc trò chuyện tải tay; **không gửi lại**.
7. **Kiểm tra** (thay D12): file là video (`video/*`, đọc được phần đầu MP4), dung lượng > 0. Cuộc trò chuyện có nhiều video → lấy video mới nhất và ghi chú trong nhật ký.
8. Đạt → `done`, gắn video vào dòng. Nghỉ 20–60 giây, sang dòng tiếp.
- **Tool tắt giữa chừng:** lượt `sending` / `waiting` / `downloading` khi mở lại **không gửi lại**; tool mở lại `museChatUrl` và tiếp tục chờ / tải video, hết thời gian thì `needs_review`.
- Trạng thái chỉ hiện trên Bảng (không còn ô Trạng thái trên sheet, D11 thôi áp dụng).
- **v1.6.0 (CON-52, bước tạm trước CON-72):** làm bước 1–5. Video hiện trong cuộc trò chuyện → lượt **Xong**, Bảng hiện nút *"Mở trong Muse"* (link cuộc trò chuyện) để người dùng xem và tải tay; bước 6–8 (tải về máy, kiểm tra file, gắn vào dòng) làm ở CON-72. Lô của Bảng mới lưu ở `batches.source = 'bang'` (không có sheet / thư mục Drive), mỗi lượt gắn dòng qua `runs.bangRowId`; dùng chung hàng đợi và giới hạn ngày với Bảng theo sheet (mỗi lúc chỉ một lô). Lô của Bảng mới chạy được cả khi chưa nạp khoá Google.
- Bảng mới lọc thêm **Đang chạy / Xong / Cần xem** theo lượt gần nhất của dòng.
- **Gửi thử thật CON-52 (29/10/2026, người phụ trách đồng ý, 2 lượt):** dòng ghép áo một mặt (2 ảnh) và dòng áo hai mặt (4 ảnh). Bot đính kèm đủ ảnh đúng thứ tự, mỗi dòng gửi đúng một lần. Cả hai lần Muse trả lời *"Xong rồi"* nhưng ô video trong chat trống / báo **"Video not found"**, mở bằng Chrome thường (có VPN) cũng vậy, nên là lỗi phía Muse. Bot nhận câu này (`notices.videoMissing`) và ghi lượt **Cần xem** ngay, không chờ hết giờ, không gửi lại. Cũng ghi nhận: tab trống Chrome mở sẵn cùng hồ sơ có lúc tải Muse mãi không xong, bot làm việc trên tab mới; ô chat hiện trước danh sách trò chuyện, bot chờ nút *New side chat*.

### 17.6 Nhập từ Google Sheet
- Nút **Nhập từ Google Sheet** → dán link sheet / chọn sheet đã kết nối → tool đọc (service account, chỉ đọc) và hiện trước *"Sẽ thêm N dòng"*.
- Mỗi dòng sheet chưa có video → một dòng mới trên Bảng: prompt, và **tải ảnh từ link Drive về máy** (Ảnh người mẫu → Mẫu trước, Ảnh áo → Áo trước). Link không đọc được → vẫn thêm dòng, để trống ô ảnh đó và ghi lý do.
- Dòng sheet đã có video thì bỏ qua (có ô tích *"Nhập cả dòng đã có video"*, khi đó chỉ lấy prompt và ảnh).
- Nhập lại cùng một sheet → bỏ qua dòng đã nhập (so `importedFrom`). Tool **không ghi gì** lên sheet.

### 17.7 Dò khả năng bot (bước đầu tiên của bước 20, trước khi code tiếp)
Trong hồ sơ bot đã đăng nhập Muse, dò (không gửi yêu cầu tạo video):
1. Ô chat có chỗ đính kèm ảnh (`input[type=file]` hoặc nút đính kèm), nhận **nhiều ảnh** một lần; giới hạn số ảnh và dung lượng.
2. Video trong cuộc trò chuyện: có thẻ `<video>` / nút tải; tải được bằng phiên của hồ sơ bot. Dò trên một cuộc trò chuyện **đã có video** từ trước.
3. Ghi selector vào `museSelectors` và ghi kết quả vào 8.3.

Không đạt mục 1 hoặc 2 → **dừng, báo người phụ trách**, chốt lại phương án trước khi làm tiếp. Một lượt gửi thật để thử (tốn hạn mức Muse) chỉ làm khi người phụ trách đồng ý.

**Kết quả (29/10/2026): đạt cả hai mục**, chi tiết ở 8.3. Cuộc trò chuyện cũ chỉ có link Drive nên mục 2 được thử bằng **một lượt gửi thật** (người phụ trách đồng ý): video hiện ngay trong chat dạng `<video>` nguồn `blob:`, không có nút tải; bot đọc blob trong trang ra file MP4. CON-72 tải video theo cách này. Selector ghi vào `museSelectors` ở CON-52 (bước dùng tới).

### 17.8 Chuyển tiếp từ v1.4 sang v2.0
- **v1.4.1:** sửa mẫu yêu cầu của luồng sheet hiện tại theo D27 (giữ bối cảnh, giữ nền). Người đã sửa mẫu trong Cài đặt thì giữ bản của họ; Cài đặt có sẵn *"Khôi phục mẫu gốc"*.
- **v1.5.0 – v1.6.0:** Bảng mới mở ở **⚙ Nâng cao → Bảng mới (đang thử)**. Bảng theo sheet vẫn là màn hình chính và chạy như v1.4.
- **v2.0.0:** Bảng mới thành màn hình chính; Bảng theo sheet chuyển vào ⚙ Nâng cao để xem lại dữ liệu cũ. Bắt đầu nhanh còn 2 bước: *Đăng nhập Muse* · *Thêm dòng đầu tiên* (khoá Google chỉ cần khi nhập từ sheet).
  - **Làm ở CON-72:** trang chủ `/` (và `/bang-moi`) là Bảng; Bảng theo sheet ở `/bang-sheet`, 4 bước cũ ở `/bat-dau/sheet`. Chưa có khoá Google thì chỉ các trang cần sheet (`/bang-sheet`, `/sheets`, `/ket-noi`, `/scan`, `/bang/…`, `/bang-moi/nhap`, `/bat-dau/sheet`) dẫn về Cài khoá. Bước 6–8 của 17.5: trạng thái `downloading`; bot đọc video `<video>` mới nhất (cạnh > 150 px) bằng `fetch(blob)` trong trang, tối đa 300 MB; tool kiểm tra hộp `ftyp`, lưu `tep\video\<dòng>-video-….mp4`, gắn vào dòng (video cũ của dòng bị thay thì xoá file cũ). Thử 3 lần cách nhau 5 giây; không được → `needs_review` *"không tải được video"*, giữ link cuộc trò chuyện. Ước lượng thời gian = số dòng × (trung bình 20 lượt Xong gần nhất, chưa có thì 5 phút + nghỉ trung bình). Xoá dòng là đặt `deletedAt` (số dòng không dùng lại). Không bao giờ lưu `/thread/new` làm link cuộc trò chuyện: Muse có lúc đổi sang `/thread/<id>` sau hơn 15 giây, bot chờ tới 45 giây, chưa có thì lấy link trong lúc chờ video; mở lại tool mà chưa có link thật → `needs_review`. Gửi thử thật 29/10/2026 (3 lượt, đồng ý): dòng một ảnh tự tải video về (1,3 MB, ~5 phút); dòng ghép áo lộ lỗi lưu `/thread/new` (đã sửa ở trên); dòng hai mặt gửi đúng.
- Quy tắc ghi sheet trong CLAUDE.md (D18) chỉ còn áp dụng cho Bảng theo sheet.

### 17.9 Khi có 50–100 dòng mỗi ngày (D25)
- Bảng không giới hạn số dòng. **Lọc nhanh** (Tất cả / Hôm nay / Chưa tạo / Đang chạy / Xong / Lỗi), **tìm** theo số dòng hoặc chữ trong prompt, **chia trang 50 dòng**.
- Ảnh nhỏ tải dần khi cuộn; video chỉ tải khi bấm ▶.
- Đầu trang hiện **dung lượng đang dùng**. **Dọn tất cả** hỏi lại, hiện số dòng và dung lượng sẽ giải phóng, xoá các dòng **Xong** cùng ảnh và video của chúng (có ô tích *"Xoá cả dòng chưa tạo"*). Dòng đang chạy không bao giờ bị xoá.
- Khi bấm Tạo video, hiện ước lượng *"khoảng X giờ"* (số dòng × (thời gian trung bình gần đây + nghỉ)). Máy phải bật suốt lô.
- Cài đặt: giới hạn ngày 1–150, mặc định 100; nhắc rủi ro hạn mức Muse khi > 50.

### 17.10 Giữ nguyên
- Muse là nơi duy nhất tạo video, điều khiển qua web bằng bot (D1); một máy Windows (D4); đăng nhập tay, không gõ mật khẩu, không vượt captcha (D6); tuần tự, mỗi dòng một cuộc trò chuyện mới, có cửa sổ (D7, D8); **không tự gửi lại khi không chắc** (D9); Ghi đè khi dòng đã có video (D10); cách đếm giới hạn ngày (D13); phát hành và cập nhật (D15, D16); migration chỉ thêm.
- Bot không bao giờ tự bấm duyệt trong Muse (8.3).

