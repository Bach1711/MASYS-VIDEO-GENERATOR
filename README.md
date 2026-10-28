# MASYS Video Generator

Tool chạy trên một máy Windows: đọc danh sách ảnh + prompt trong Google Sheet, rồi điều khiển **Meta Muse AI** (qua một cửa sổ Chrome riêng) tạo video dọc cho từng dòng. Muse tự lưu video lên Google Drive và dán link vào ô Video; tool chỉ điều phối, theo dõi, kiểm tra lại và ghi **đúng một ô Trạng thái** mỗi dòng.

- Đặc tả đầy đủ: [`SPEC-app-tao-video-ao.md`](SPEC-app-tao-video-ao.md)
- Tiến độ: [`TIEN-DO.md`](TIEN-DO.md) (mở `TIEN-DO.html` bằng trình duyệt để xem sơ đồ)

---

## 0. Người trong đội: tải zip, giải nén, bấm đúp (D15)

Không cần cài Node, git hay 1Password. Máy chỉ cần **Windows 10/11** và **Google Chrome**.

1. Nhận từ người phụ trách: file **`MASYS-Video-vX.Y.Z-win64.zip`** (≈50 MB) và **file khoá Google `.json`**. File khoá được gửi riêng, không gửi qua nhóm chat chung.
2. **Giải nén toàn bộ** zip ra một thư mục bất kỳ, ví dụ `Documents\MASYS-Video`. Đừng chạy thẳng trong file zip.
3. Bấm đúp **`Mo-MASYS.bat`**.
   - Một cửa sổ đen hiện ra và trình duyệt tự mở trang tool ở **http://localhost:4310**.
   - **Đừng đóng cửa sổ đen khi đang dùng tool.** Muốn tắt tool thì đóng cửa sổ đó.
   - Windows hỏi *"Windows protected your PC"* thì bấm **More info → Run anyway**.
   - Bấm đúp lần nữa khi tool đang chạy thì tool chỉ mở lại trang, không bật thêm bản thứ hai.
   - Cửa sổ báo *"Cổng 4310 đang bị một chương trình khác dùng"* thì tắt chương trình đó hoặc khởi động lại máy, rồi bấm đúp lại.
4. **Lần đầu**, tool mở trang **Cài khoá Google**.
   - Chọn file khoá `.json` rồi bấm **Lưu khoá**.
   - Tool kiểm tra khoá với Google, mã hoá khoá (Windows DPAPI) và cất ở `%LOCALAPPDATA%\masys-video\google-key.dpapi`. Chỉ đúng tài khoản Windows đó mở được file này.
   - Tool tự khởi động lại sau vài giây. Sau bước này có thể xoá file `.json` gốc.
   - Đổi khoá sau này: vào **Cài đặt → Đổi file khoá**. Nút bị khoá khi đang có lô chạy.
5. Làm tiếp [mục 3](#3-đăng-nhập-muse-trong-cửa-sổ-bot-làm-một-lần) để đăng nhập Muse trong cửa sổ bot. Trang Bot Muse báo nếu máy chưa cài Chrome.

Dữ liệu nằm ở `%LOCALAPPDATA%\masys-video`, ngoài thư mục zip: lịch sử lô, cài đặt, phiên đăng nhập Muse, khoá đã mã hoá và bản sao lưu. Số phiên bản hiện ở cuối mọi trang và trong **Cài đặt → Phiên bản**.

### Cập nhật tool (D16)

Không cần tải zip lại. Mỗi lần mở tool, tool tự hỏi GitHub **một lần**. Có bản mới thì trên đầu trang hiện *"Có bản mới vX.Y.Z → Xem và cập nhật"*. Tool **không bao giờ tự cập nhật**.

1. Vào **Cài đặt → Phiên bản**. Khung này hiện bản đang dùng, bản mới và ghi chú thay đổi. Bấm **Kiểm tra phiên bản** để hỏi lại GitHub.
2. Bấm **Cập nhật lên vX.Y.Z**. Tool tự làm:
   - tải bản mới;
   - kiểm tra file không hỏng (mã SHA-256);
   - sao lưu `data.db` vào `%LOCALAPPDATA%\masys-video\sao-luu`, giữ 3 bản mới nhất;
   - giải nén vào `phien-ban\X.Y.Z` cạnh bản cũ;
   - khởi động lại.
   
   Trang tự tải lại và báo *"Đã cập nhật lên vX.Y.Z"*.
3. **Đang có lô chạy, hoặc có dòng đang gửi hay đang chờ Muse,** thì nút bị mờ, kèm lý do *"Chờ lô #N xong hoặc bấm Tạm dừng"*. Như vậy không bao giờ cắt ngang một lượt Muse (D9).
4. **Bản mới không khởi động được** trong 60 giây thì tool tự quay về bản cũ, và báo *"Bản vX.Y.Z không khởi động được nên tool đã tự quay về…"*.
5. **Bản mới chạy có vấn đề:** bấm **Quay về vX.Y.Z** trong Cài đặt. Tool giữ đúng một bản trước, và dữ liệu giữ nguyên.

Cấu trúc thư mục sau khi giải nén: `MASYS-Video\Mo-MASYS.bat` và `MASYS-Video\phien-ban\`. Trong `phien-ban` có `hien-tai.txt` ghi bản đang dùng, cùng mỗi bản một thư mục. Đừng sửa tay các file trong `phien-ban`.

### Người phụ trách: tạo zip và phát hành

- `npm run package` dựng zip trên máy:
  - tải Node đúng bản đang dùng từ nodejs.org và kiểm tra SHA-256;
  - nén thành `release/MASYS-Video-vX.Y.Z-win64.zip`, kèm file `.sha256`;
  - quét lại zip: không có khoá, `.env`, SQLite, hồ sơ bot, test hay mã nguồn TypeScript. Thấy thứ gì thì xoá zip.
- **Phát hành bản mới** để các máy bấm Cập nhật được:
  1. Trong PR của ticket, nâng `version` trong `package.json`: sửa lỗi thì `x.y.Z`, tính năng mới thì `x.Y.0`. Viết mục `## vX.Y.Z` trong [`CHANGELOG.md`](CHANGELOG.md) bằng tiếng Việt cho người dùng đọc.
  2. Sau khi gộp PR: `git checkout main && git pull`, rồi `npm run release`. Lệnh kiểm tra main sạch và trùng GitHub, repo công khai, chưa có bản trùng số. Sau đó lệnh đóng gói và đăng zip + `.sha256` + ghi chú lên GitHub Releases.
- Migration SQLite **chỉ được thêm** bảng hoặc cột (D16), để bản cũ vẫn mở được dữ liệu khi người dùng bấm Quay về.

## 1. Cài trên một máy Windows mới (máy phát triển)

Cần cài sẵn:

| Phần mềm | Ghi chú |
|---|---|
| **Google Chrome** | Bot dùng Chrome đã cài trên máy (không tải Chrome riêng). |
| **Node.js 22 trở lên** | https://nodejs.org, bản LTS. |
| **Git** | Để tải code về. |
| **1Password** + **1Password CLI (`op`)** | Khoá service account nằm trong vault `MASYS-VIDEO-GENERATOR`. Bật *Settings → Developer → Integrate with 1Password CLI* trong app 1Password. |

Mở PowerShell hoặc Git Bash:

```
git clone https://github.com/Bach1711/MASYS-VIDEO-GENERATOR.git
cd MASYS-VIDEO-GENERATOR
npm install
op run --env-file=.env -- npm run dev
```

Mở **http://localhost:4310**. Trang chủ phải hiện *"Service account: …@….iam.gserviceaccount.com"*. Nếu hiện *"Chưa nạp được khoá service account"*, làm mục 2.

- Tool chỉ mở được trên chính máy này (nghe `127.0.0.1`).
- Muốn dừng tool: bấm `Ctrl + C` trong cửa sổ đang chạy. Tắt giữa chừng cũng không sao: mở lại thì tool **không gửi lại** dòng đã gửi, chỉ theo dõi nốt rồi chờ bạn bấm Tiếp tục.
- Dữ liệu của tool (SQLite, hồ sơ Chrome bot, ảnh chụp lỗi) nằm ở `%LOCALAPPDATA%\masys-video`, **ngoài repo**. Không gửi thư mục `bot-profile` cho ai: nó chứa phiên đăng nhập Muse.

> **Bí mật:** file `.env` chỉ chứa địa chỉ `op://…`, không chứa khoá thật. Luôn chạy bằng `op run --env-file=.env -- …`. Không bao giờ dán khoá vào code, commit hay khung chat.

## 2. Service account Google (làm một lần)

Tool đọc sheet, ghi ô Trạng thái và kiểm tra file video bằng một **service account** (một "tài khoản máy" của Google).

1. Vào https://console.cloud.google.com → tạo (hoặc chọn) một project.
2. **APIs & Services → Library**: bật **Google Sheets API** và **Google Drive API**.
3. **IAM & Admin → Service Accounts → Create service account**. Không cần cấp vai trò nào.
4. Mở service account vừa tạo → **Keys → Add key → Create new key → JSON**. Trình duyệt tải về một file `.json`.
5. Trong 1Password, vault `MASYS-VIDEO-GENERATOR`, tạo item tên **`Google Service Account`**, trường **`credential`**, dán **toàn bộ nội dung** file JSON. Sau đó **xoá file JSON** khỏi máy.
6. **Chia sẻ** cho email service account (dạng `…@….iam.gserviceaccount.com`):
   - **Google Sheet**: quyền **Người chỉnh sửa** (để ghi ô Trạng thái).
   - **Thư mục Drive gốc** chứa thư mục lưu video: quyền **Người xem** (để kiểm tra video).
   - Ảnh người mẫu trong cột Ảnh và ảnh thiết kế trong cột Ảnh áo: để chế độ *"Bất kỳ ai có đường liên kết"* (Muse cần mở được ảnh).
7. Chạy lại `op run --env-file=.env -- npm run dev`.

## 3. Đăng nhập Muse trong cửa sổ bot (làm một lần)

1. Vào trang **Bot Muse** → bấm **Mở trình duyệt bot**. Một cửa sổ Chrome riêng mở trang Muse.
2. **Tự đăng nhập Muse** bằng tài khoản Meta trong cửa sổ đó (kể cả mã xác nhận, captcha nếu có). Bot **không bao giờ** gõ mật khẩu hay tự vượt captcha.
3. Bấm **Kiểm tra trạng thái** → phải hiện *"Sẵn sàng (thấy ô chat Muse)"*.
4. Những lần sau Chrome bot tự nhớ đăng nhập. Nếu Meta bắt đăng nhập lại, lô sẽ tự tạm dừng (mục 5).

**Muse hỏi duyệt** ("Allow Như to create or upload files…", nút *Create / Always allow / Don't create*): bạn tự bấm **Always allow** trong cửa sổ bot. Bot không tự bấm duyệt; trang lô sẽ hiện *"Muse đang chờ bạn duyệt"* và đưa cửa sổ bot lên trước. Thời gian chờ vẫn tính, nên duyệt sớm.

## 4. Dùng hằng ngày

**Từ v1.2.0: chỉ cần màn hình Bảng** (trang đầu khi mở tool).
1. Bảng hiện đúng nội dung trang tính đã kết nối: ảnh người mẫu, ảnh áo, prompt, video (bấm **▶ Xem**), trạng thái. Đổi sheet/trang tính ở ô chọn trên cùng; bảng tự làm mới khi sheet đổi.
2. Tích các dòng cần làm (hoặc **☑ Chọn mọi dòng chưa có video**), bấm **▶ Tạo video**. Tool tự tạo lô và chạy luôn: dùng thư mục Drive gốc trong Cài đặt (thư mục con "Video" nếu có), mẫu yêu cầu trong Cài đặt, prompt đúng như trong sheet.
3. Trạng thái từng dòng và video hiện ngay trên bảng. Cần đăng nhập Muse thì bảng báo và có nút **Tiếp tục**; có nút **Tạm dừng** / **Huỷ**.
4. Muốn xem trước câu gửi Muse của một dòng: bấm **Xem yêu cầu gửi Muse** ở dòng đó.

Các trang cũ (kết nối sheet, quét kiểu cũ có sửa prompt riêng cho lần gửi, lịch sử lô, nhật ký, bot Muse, cài đặt) nằm trong nút **⚙ Nâng cao** góc trên. Cách dùng kiểu cũ:

1. **Kết nối sheet** (một lần mỗi sheet/tab): dán link sheet, chọn trang tính, chọn cột Ảnh / Prompt / Video / Trạng thái, và cột **Ảnh áo** nếu sheet có (tuỳ chọn, xem dưới).
2. **Quét và chọn dòng**: tick các dòng cần làm video. Dòng đã có link video bị khoá (muốn làm lại thì tick **Ghi đè**).
3. **Chuẩn bị lô**: chọn thư mục Drive lưu video, sửa prompt từng dòng hoặc thêm "yêu cầu thêm chung" nếu muốn (sheet **không** bị sửa), xem trước nguyên văn yêu cầu gửi Muse, bấm **Tạo lô**.
4. Ở trang **Lô #N**, bấm **Bắt đầu chạy**. Bot gửi lần lượt từng dòng, mỗi dòng một cuộc trò chuyện Muse mới, nghỉ 20–60 giây giữa hai dòng. Mỗi dòng thường mất 3–5 phút.
5. Theo dõi ở trang lô; xem lại ở **Lịch sử lô** và **Nhật ký** (có ảnh chụp màn hình khi lỗi).

**Ghép ảnh áo (từ v1.1.0):** sheet có cột **Ảnh áo** (link Drive ảnh thiết kế áo) thì ở **Kết nối sheet** chọn thêm cột này (tool tự nhận tiêu đề "Ảnh áo"). Sheet đã kết nối từ trước: bấm **Sửa** ở tab đó rồi **Lưu ánh xạ** một lần. Dòng có ảnh áo: bảng quét hiện 2 ảnh, yêu cầu gửi Muse có thêm đoạn dặn Muse **ghép áo vào ảnh người mẫu trước rồi tạo video theo prompt**, trong cùng một lượt; ảnh ghép không lưu. Dòng để trống ô Ảnh áo chạy như cũ. Câu chữ đoạn này sửa ở **Cài đặt → Đoạn ghép áo**.

> ⚠️ **Đang chạy lô thì đừng sửa sheet** (kể cả dán link vào dòng khác). Tool so toàn bộ trang tính trước và sau mỗi lượt để bắt Muse sửa nhầm ô; một ô bị đổi tay cũng bị coi là "Muse sửa ô khác" và lô tạm dừng. Muốn sửa thì bấm **Tạm dừng** trước, sửa xong bấm **Tiếp tục**.

**Giới hạn mỗi ngày** mặc định **5 video** (đổi ở Cài đặt). Đủ số thì lô tự tạm dừng, hôm sau bấm Tiếp tục. Tạo nhiều video tự động mỗi ngày làm tăng rủi ro tài khoản Meta bị hạn chế.

## 5. Khi lô tạm dừng

Dải báo trên đầu mọi trang và trang lô cho biết lý do. Xử lý xong thì bấm **Tiếp tục**: tool **không bao giờ gửi lại** dòng đã gửi Muse.

| Thông báo | Làm gì |
|---|---|
| **Cần đăng nhập lại Muse** | Mở trình duyệt bot (trang Bot Muse), tự đăng nhập / vượt kiểm tra bảo mật, rồi Tiếp tục. |
| **Giao diện Muse thay đổi** | Xem ảnh chụp trong **Nhật ký**. Nếu cửa sổ bot bị tắt: mở lại rồi Tiếp tục. Nếu Muse thật sự đổi giao diện: sửa theo mục 7. |
| **Muse hết lượt / hết token** | Chờ Muse có lượt lại (Free plan reset hằng tuần) rồi Tiếp tục. Dòng đang gửi dở chuyển *Lỗi*, không gửi lại; muốn làm lại thì tạo lô mới với dòng đó. |
| **Đã đủ video trong ngày** | Hôm sau bấm Tiếp tục. |
| **Muse sửa nhầm ô** | Mở sheet, xem ô ghi trong lý do (ví dụ *E9*), sửa lại cho đúng rồi Tiếp tục. |
| **Lệch dòng trong sheet** | Có người chèn/xoá dòng hoặc đổi ảnh/prompt sau khi tạo lô. Kiểm tra sheet; nên Huỷ lô và tạo lô mới. |
| **Lỗi Google Sheet** | Kiểm tra mạng và quyền chia sẻ cho service account, rồi Tiếp tục. |
| **Tool vừa mở lại** | Tool đã theo dõi nốt dòng dở; bấm Tiếp tục để chạy các dòng còn lại. |

**Huỷ lô**: dòng đang chờ Muse vẫn được theo dõi cho xong, các dòng chưa gửi chuyển *Đã huỷ*.

**Các trạng thái "Cần xem"** trong ô Trạng thái:

| Ô Trạng thái | Nghĩa | Làm gì |
|---|---|---|
| `Cần xem: quá thời gian` | Quá thời gian chờ (mặc định 20 phút) mà ô Video chưa có link. | Mở link cuộc trò chuyện Muse ở trang lô xem Muse đang làm gì (có thể đang chờ duyệt). Muse có thể vẫn dán link sau đó. |
| `Cần xem: link không hợp lệ (…)` | Link không phải file Drive, không phải video, hoặc không nằm trong thư mục đã chọn. | Mở link kiểm tra; chuyển file vào đúng thư mục nếu cần. |
| `Cần xem: Muse sửa ô khác (…)` | Trong lúc chờ có ô khác bị đổi. Video của dòng vẫn có thể đúng. | Kiểm tra ô được ghi trong ngoặc. |

## 6. Cài đặt

Trang **Cài đặt**: thời gian chờ mỗi dòng (1–120 phút), khoảng nghỉ giữa hai dòng, giới hạn video/ngày, địa chỉ trang Muse (để trống = `https://muse.ai/`), thư mục Drive gốc, mẫu yêu cầu gửi Muse và đoạn ghép áo (mẫu đã sửa tay mà thiếu chỗ `{doan_ghep_ao}` thì trang báo; bấm *Khôi phục mẫu gốc* là có). Đổi trong lúc lô chạy thì áp dụng từ dòng kế tiếp.

## 7. Khi Muse đổi giao diện: sửa selector

Mọi chỗ bot "nhìn" vào trang Muse nằm trong **một file**: [`src/bot/museSelectors.ts`](src/bot/museSelectors.ts). Không cần sửa chỗ nào khác.

| Nhóm | Dùng để |
|---|---|
| `login` | Nhận ra trang đăng nhập (tiêu đề *"Log in or create an account"*, ô *"Mobile number or email"*, địa chỉ `auth.muse.ai` / `facebook.com`). |
| `challenge` | Nhận ra captcha / kiểm tra bảo mật. |
| `chat` | Ô chat (*"Message"*), nút *"Send"*, nút *"Chats"* → *"New side chat"*, mẫu địa chỉ `/thread/new` và `/thread/<id>`. |
| `approval` | Thẻ xin duyệt của Muse (*"Needs approval"*, *Always allow* …). |
| `notices` | Câu Muse báo hết lượt, từ chối, lỗi. |

Cách sửa:

1. Mở trình duyệt bot, chuột phải vào phần tử bị đổi (ví dụ ô chat) → **Inspect** để xem tên hiển thị / nhãn mới (`aria-label`, chữ trên nút).
2. Sửa biểu thức tương ứng trong `museSelectors.ts` (ưu tiên khớp theo **vai trò + tên hiển thị**, ví dụ `getByRole("button", { name: /^send$/i })`, không khớp theo class CSS vì class đổi thường xuyên).
3. Chạy `npm test` (test `test/bot.test.ts` dùng một trang Muse giả lập), rồi ở trang Bot Muse bấm **Kiểm tra trạng thái** với Muse thật.
4. Ghi câu chữ mới vào spec §8.3 để lần sau còn biết.

## 8. Bảo mật

- Kiểm tra repo, SQLite và log không chứa khoá service account hay cookie Meta (§12.11):

  ```
  op run --env-file=.env -- npm run check-secrets -- <đường dẫn file log nếu có>
  ```

  Chạy qua `op run` thì lệnh so cả nguyên văn khoá thật. Lệnh không bao giờ in giá trị tìm thấy, chỉ in tên file và số dòng. Truyền thêm đường dẫn file `.zip` thì lệnh giải nén ra thư mục tạm, quét từng file trong đó và báo cả các file không được phép có trong zip.
- Máy dùng bản zip: khoá chỉ nằm trong `google-key.dpapi` đã mã hoá theo tài khoản Windows. Không gửi file này cho ai; chép sang máy khác thì nó cũng không mở được.
- Hồ sơ bot (`%LOCALAPPDATA%\masys-video\bot-profile`) chứa phiên Muse: không chép, không gửi cho ai. Muốn "đăng xuất" hẳn bot: tắt tool rồi xoá thư mục này.

## 9. Lệnh cho người phát triển

| Lệnh | Làm gì |
|---|---|
| `op run --env-file=.env -- npm run dev` | Chạy tool, tự nạp lại khi sửa code. |
| `npm test` | Chạy toàn bộ test (Sheet, Drive, Muse đều giả lập; không tốn video). |
| `npm run typecheck` | Kiểm tra kiểu TypeScript. |
| `npm run build` / `op run --env-file=.env -- npm start` | Build rồi chạy bản build. |
| `op run --env-file=.env -- npm run test:google` | Test với Google Sheet thật: ghi tạm ô Trạng thái dòng 2 (`MASYS_TEST_ROW`), kiểm tra chỉ ô đó đổi, rồi trả lại giá trị cũ. |
| `npm run tien-do` | Tạo lại `TIEN-DO.html` từ `TIEN-DO.md`. |
| `npm run package` | Tạo bản zip cho người trong đội (mục 0); không cần `op run`. |
| `npm run release` | Sau khi gộp PR: đăng bản `version` hiện tại lên GitHub Releases (mục 0, Cập nhật tool). |

Biến môi trường tuỳ chọn: `PORT` (mặc định 4310), `MASYS_DATA_DIR` (thư mục dữ liệu).
