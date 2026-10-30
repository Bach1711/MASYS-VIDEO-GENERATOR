# Ghi chú thay đổi

Mỗi bản phát hành có một mục `## vX.Y.Z`. Nội dung mục được đăng nguyên văn làm ghi chú trên GitHub Releases và hiện trong tool, ở **Cài đặt → Phiên bản**. Viết bằng tiếng Việt, cho người dùng đọc: nói về thay đổi họ thấy được, không nói về code.

## v2.1.0

**Tạo nhiều video cùng lúc, mẫu áo hai mặt mới, tên mới: KOL Fashion MASYS Video.**

- **Chạy song song:** bot gửi lần lượt từng dòng cho Muse, mỗi dòng một cuộc trò chuyện trong một tab riêng, và **chờ nhiều video cùng lúc** thay vì làm xong dòng này mới gửi dòng sau. Video nào xong trước thì tải về trước, luôn gắn đúng dòng của nó. Lô 100 dòng nhanh hơn khoảng 3 lần.
  - Chỉnh ở **Cài đặt → Số video chạy cùng lúc**: từ 1 đến 6, mặc định 3. Đặt 1 thì chạy như trước.
  - Bấm **Tạm dừng**, hoặc Muse đòi đăng nhập / hết lượt, hoặc đủ giới hạn ngày: bot ngừng gửi dòng mới nhưng vẫn chờ và tải nốt các video đã gửi.
  - Tool tắt giữa chừng: khi mở lại, bot mở lại tất cả cuộc trò chuyện đang dở và tải tiếp, không gửi lại. Bấm Tiếp tục ngay được, không phải chờ.
  - Thời gian ước lượng ở trang xem trước đã tính theo số video chạy cùng lúc.
- **Mẫu áo hai mặt mới:** Muse ghép áo ra 2 ảnh (mặt trước, quay lưng) rồi làm video: mặt trước → cắt cảnh sang quay lưng, người mẫu vẫn cử động nhẹ (quay đầu, vuốt tóc, dồn chân) → trở lại mặt trước. Người mẫu không xoay người liền mạch nữa, vì lúc xoay Muse hay vẽ sai hình in mặt sau. Máy chưa sửa mẫu tự dùng mẫu mới; máy đã sửa mẫu ở Cài đặt giữ bản của mình (bấm *Khôi phục bản gốc* để lấy mẫu mới).
- **Tên mới: KOL Fashion MASYS Video**, hiện ở đầu trang, tab trình duyệt và cửa sổ mở tool. File tải mới là `KOL-Fashion-MASYS-Video-v2.1.0-win64.zip`. Ảnh, video và đăng nhập Muse giữ nguyên. Máy đang dùng cứ bấm Cập nhật như mọi lần; thư mục cài đặt giữ tên cũ (muốn thì tắt tool rồi tự đổi tên thư mục).

## v2.0.0

**Bảng là màn hình chính: video tải thẳng về máy, xem / tải / xoá ngay trên Bảng. Không cần Google Sheet hay Drive nữa.**

- Mở tool là vào **Bảng** (trước đây ở ⚙ Nâng cao → Bảng mới). Bảng theo Google Sheet cũ vẫn còn ở **⚙ Nâng cao → Bảng theo sheet (cũ)**.
- Muse làm xong video thì bot **tự tải video về máy** và gắn vào dòng. Ở cột **Video**:
  - **▶** xem ngay trên trang (video chỉ tải khi bấm);
  - **⬇** tải về máy, tên file `MASYS_<số dòng>_<ngày-giờ>.mp4`;
  - **🗑** xoá video (ảnh và prompt giữ nguyên).
- Không tải được video thì dòng hiện **Cần xem**: bấm *Mở trong Muse* để tải tay. Tool không tự gửi lại.
- **Xoá dòng đã chọn** (cùng ảnh và video) và **Dọn tất cả**: hỏi lại, cho biết số dòng và dung lượng sẽ giải phóng; mặc định chỉ xoá dòng **Xong**, tích thêm để xoá cả dòng chưa tạo. Dòng đang tạo video không bao giờ bị xoá.
- Trang xem trước khi Tạo video cho biết lô mất **khoảng bao lâu** (theo thời gian các video gần đây).
- **Bắt đầu nhanh còn 2 bước:** *Đăng nhập Muse* và *Thêm dòng đầu tiên*. Máy mới **không cần khoá Google**; khoá chỉ cần khi *Nhập từ Google Sheet* hoặc dùng Bảng theo sheet.
- Tool tắt giữa chừng: khi mở lại, bot mở đúng cuộc trò chuyện của dòng đang dở và chờ / tải video tiếp, không gửi lại.
- Sửa lỗi: Muse đổi sang link riêng của cuộc trò chuyện chậm thì bot không còn lưu nhầm link trang trò chuyện trống; bot lấy link đúng trong lúc chờ video.
- Hướng dẫn trong tool viết lại theo Bảng mới.

## v1.6.0

**Mới: Bảng mới tạo được video, kể cả áo hai mặt. Ảnh gửi thẳng từ máy vào Muse, không qua Drive.**

- Trên **Bảng mới** (⚙ Nâng cao → Bảng mới), tích các dòng rồi bấm **▶ Tạo video**. Tool hiện trang **xem trước**: từng dòng làm kiểu gì (*Một ảnh người mẫu*, *Ghép áo một mặt*, *Áo hai mặt*), các ảnh sẽ đính kèm theo thứ tự, và yêu cầu gửi Muse. Có ô *Yêu cầu thêm chung* nếu muốn dặn thêm Muse.
- **Áo hai mặt:** dòng có đủ 4 ảnh (Mẫu trước, Áo trước, Mẫu sau, Áo sau) ra **một video**: Muse ghép áo mặt trước vào người mẫu quay mặt trước, áo mặt sau vào người mẫu quay lưng, rồi làm video người mẫu xoay từ trước ra sau.
- Bot mở một cuộc trò chuyện Muse mới cho mỗi dòng, đính kèm ảnh, và **chỉ bấm Gửi khi Muse đã nhận đủ ảnh**. Muse nhận thiếu ảnh thì bot tạm dừng, chưa gửi.
- Video xong thì dòng hiện **Xong** kèm nút **Mở trong Muse ↗**: bấm để xem và tải video trong Muse. Bản tiếp theo tool sẽ tự tải video về máy.
- Bảng mới lọc thêm **Đang chạy / Xong / Cần xem**; bảng tự cập nhật trong lúc tạo video.
- Ba mẫu yêu cầu của Bảng mới (*Mẫu thường*, *Đoạn ghép áo*, *Mẫu hai mặt*) sửa được ở **Cài đặt**, có nút *Khôi phục bản gốc*. Mẫu luôn dặn Muse giữ nguyên nền và bối cảnh của ảnh người mẫu.
- Bảng theo sheet vẫn chạy như cũ. Hai bảng dùng chung hàng đợi (mỗi lúc chỉ một lô) và chung giới hạn video mỗi ngày.

## v1.5.0

**Mới (đang thử): Bảng mới, ảnh chọn thẳng từ máy, không cần Google Drive.**

- Mở ở **⚙ Nâng cao → Bảng mới (đang thử)**. Bảng cũ theo Google Sheet vẫn là màn hình chính và tạo video như trước.
- Mỗi dòng có 4 ô ảnh: **Mẫu trước, Áo trước, Mẫu sau, Áo sau**. Bấm **+** để chọn ảnh từ máy, hoặc kéo ảnh thả vào ô. Bấm ảnh để xem lớn, ✎ để đổi, ✕ để bỏ. Nhận JPG, PNG, WEBP, mỗi ảnh tối đa 20 MB. Tool tự chép ảnh vào máy, xoá ảnh gốc cũng không sao.
- **Thêm dòng:** bấm **+ Thêm dòng**, hoặc chọn / kéo nhiều ảnh người mẫu cùng lúc: mỗi ảnh thành một dòng mới.
- Sửa prompt ngay trên dòng (✎), **Dải prompt** sang nhiều dòng, **Chọn mọi dòng sẵn sàng**. Mỗi dòng có nhãn *Sẵn sàng* hoặc *Thiếu dữ liệu* kèm lý do (ví dụ có ảnh mặt sau thì cần đủ 4 ảnh).
- Nhiều dòng vẫn dễ tìm: lọc **Tất cả / Hôm nay / Chưa tạo / Thiếu dữ liệu / Đã có video**, ô tìm theo số dòng hoặc chữ trong prompt, mỗi trang 50 dòng. Đầu trang hiện dung lượng ảnh đang dùng.
- **Nhập từ Google Sheet:** tool chỉ đọc sheet đã kết nối, tải ảnh về máy và thêm thành dòng mới; hiện trước "Sẽ thêm N dòng" rồi mới nhập. Dòng đã có video hoặc đã nhập lần trước được bỏ qua. Không ghi gì lên sheet.
- Nút **Tạo video** của Bảng mới có ở bản tiếp theo.
- **Giới hạn video mỗi ngày** giờ mặc định **100**, đặt được tới 150. Máy đang để mức cũ 5 được tự nâng lên 100; máy đã tự đặt số khác thì giữ nguyên.

## v1.4.1

**Video giữ nguyên bối cảnh, ghép áo không làm mất nền.**

- Yêu cầu gửi Muse giờ dặn thêm: **giữ nguyên nền, bối cảnh và ánh sáng của ảnh người mẫu**, và từ prompt **chỉ lấy động tác, biểu cảm, cách quay**. Prompt có tả phòng ngủ, phòng khách… cũng không làm video đổi sang khung cảnh khác, không cần sửa từng prompt.
- Dòng có ảnh áo: Muse được dặn **chỉ thay chiếc áo**, giữ nguyên khuôn mặt, tóc, dáng, tư thế, nền, bối cảnh và ánh sáng của ảnh người mẫu, giữ nguyên hình in.
- Nếu bạn đã tự sửa mẫu yêu cầu trong **⚙ Nâng cao → Cài đặt**, tool giữ nguyên bản của bạn. Muốn dùng câu mới thì bấm **Khôi phục mẫu gốc**.

## v1.4.0

**Mới: bắt đầu trong 4 bước, hướng dẫn gọn.**

- Máy mới mở tool là thấy **4 bước**, bước nào xong có dấu ✅: *1. Khoá Google* · *2. Dán link Google Sheet* · *3. Đăng nhập Muse* · *4. Thư mục Drive lưu video*. Còn thiếu bước nào thì Bảng nhắc đúng bước đó ở trên cùng.
- **Kết nối sheet một bước:** dán link, tool tự chọn trang tính và tự tìm cột Ảnh, Prompt, Video, Trạng thái, Ảnh áo, rồi bạn chỉ bấm **Xác nhận**. Chỉ khi tool không tìm ra cột mới phải chọn tay. Nút **+ Thêm sheet** cũng làm như vậy.
- **Đăng nhập Muse:** bấm **Mở cửa sổ Muse**, tự đăng nhập, rồi bấm **Kiểm tra**. Tool nhớ lần kiểm tra thành công (và mỗi lần gửi Muse thành công), không tự mở Chrome mỗi lần mở tool. Sau khi cập nhật, Bảng sẽ nhắc bước này một lần: bấm Kiểm tra là xong.
- **Thư mục Drive lưu video:** dán link thư mục ngay trong các bước bắt đầu; tool báo nếu chưa có thư mục con "Video".
- Chữ gợi ý ngắn ngay chỗ cần: cạnh nút Tạo video, ô Lưu video vào, số video còn lại hôm nay, ô tích của dòng không chọn được.
- Hướng dẫn mới, ngắn: **⚙ Nâng cao → Hướng dẫn** (gồm cách xử lý khi tool tạm dừng). Các bước bắt đầu mở lại được ở **⚙ Nâng cao → Các bước bắt đầu**.

## v1.3.0

**Mới: sửa ngay trên Bảng, không cần mở Google Sheet.**

- Bấm **✎** cạnh prompt, ảnh người mẫu hoặc ảnh áo (ô trống thì bấm **+**), sửa rồi bấm **Lưu lên sheet**. Tool ghi thẳng vào Google Sheet.
- Dán link ảnh: tool kiểm tra link Drive mở được và đúng là ảnh rồi mới ghi; sai thì báo ngay tại ô.
- Nếu đúng lúc đó có người khác vừa sửa ô ấy trên sheet, tool **không ghi đè** mà báo *"Ô này vừa được người khác sửa"* và hiện nội dung mới. Muốn giữ nội dung của mình thì bấm Lưu lần nữa.
- **+ Thêm dòng:** điền ảnh người mẫu, ảnh áo, prompt; tool ghi vào dòng trống đầu tiên sau dòng cuối của sheet.
- **Dải prompt ▾:** chép prompt của một dòng sang các dòng đã chọn (ví dụ *3-6, 9*) hoặc xuống tới dòng cuối. Tool báo *"Sẽ thay prompt của N dòng"* để bạn xác nhận trước khi ghi; dòng đang tạo video và dòng đã có video được bỏ qua (trừ khi tích *Thay cả dòng đã có video*).
- Dòng đang tạo video thì khoá sửa cho tới khi xong.
- Đang chạy lô vẫn sửa được các dòng khác trên Bảng mà lô không bị dừng nhầm vì *"Muse sửa ô khác"*.
- Mọi ô đã sửa (ô nào, nội dung cũ, nội dung mới, lúc nào) xem ở **⚙ Nâng cao → Nhật ký → Ô đã sửa từ Bảng**.
- Tool không bao giờ sửa ô Video, không xoá hay chèn dòng.

## v1.2.0

**Mới: màn hình Bảng, bấm một nút là tạo video.**

- Mở tool là thấy ngay **Bảng**: giống trang tính trong Google Sheet, có ảnh người mẫu, ảnh áo, prompt, video (bấm **▶ Xem**) và trạng thái từng dòng. Không cần mở sheet hay Drive nữa.
- Tích chọn dòng (hoặc **☑ Chọn mọi dòng chưa có video**) rồi bấm **▶ Tạo video**. Tool tạo lô và chạy luôn, không còn các bước Chuẩn bị lô, Xem trước, Bắt đầu.
- Đang chạy: dòng nào đang gửi, đang chờ Muse, xong hay lỗi hiện ngay trên bảng; video xong hiện luôn. Có nút **Tạm dừng**, **Tiếp tục**, **Huỷ**. Cần đăng nhập Muse thì bảng nói rõ phải làm gì.
- **Lưu video vào:** chọn thư mục Drive ngay cạnh nút Tạo video (các thư mục con trong thư mục gốc, hoặc dán link thư mục khác). Mặc định là thư mục con "Video"; tool nhớ thư mục bạn dùng lần trước.
- **+ Thêm sheet:** kết nối thêm file sheet hoặc trang tính, lưu xong tự quay về Bảng. Đổi giữa các sheet ở ô chọn trên cùng.
- Muốn xem câu gửi Muse của một dòng: bấm **Xem yêu cầu gửi Muse**.
- Các trang cũ (Kết nối sheet, Lịch sử lô, Nhật ký, Bot Muse, Cài đặt…) gom vào nút **⚙ Nâng cao** ở góc trên.
- Sửa lỗi ảnh thu nhỏ đôi khi hiện ô xám khi nhiều dòng dùng chung một ảnh, và chữ trong tool hiện sai phông.

## v1.1.2

**Tool có logo MASYS.**

- Tab Chrome của tool hiện biểu tượng MASYS, dễ tìm giữa nhiều tab.
- Thanh trên cùng có logo và chữ **MASYS Video**, bấm vào là về Trang chủ.
- Trang chủ có logo đầy đủ.

## v1.1.1

Sửa lỗi cập nhật trong tool báo *"EPERM: operation not permitted"* ở bước cuối.

- Lỗi này xảy ra khi phần mềm diệt virus (như Windows Defender) đang quét bản mới vừa tải về. Giờ tool chờ quét xong rồi mới chuyển bản mới vào chỗ. Nếu chờ lâu, tool chép bản mới sang thay vì chuyển.
- Trang cập nhật báo *"Phần mềm diệt virus đang quét file mới nên phải chờ một chút"* trong lúc chờ.
- Nếu vẫn không được, tool báo lỗi bằng tiếng Việt, bản đang dùng giữ nguyên.

## v1.1.0

**Mới: ghép ảnh áo vào ảnh người mẫu rồi tạo video.**

- Sheet có cột **Ảnh áo** (link Drive ảnh thiết kế áo) thì Muse ghép áo vào ảnh người mẫu trước, rồi làm video theo prompt từ ảnh vừa ghép, trong cùng một lượt. Ảnh ghép không lưu, chỉ lưu video như cũ.
- **Kết nối sheet** có thêm ô chọn cột **Ảnh áo** (tuỳ chọn, tool tự nhận tiêu đề "Ảnh áo"). Sheet đã kết nối từ trước: bấm **Sửa** ở tab đó rồi **Lưu ánh xạ** một lần.
- **Quét và chọn dòng** hiện cả ảnh người mẫu và ảnh áo. Link ảnh áo hỏng thì dòng báo *Thiếu dữ liệu*. Ô Ảnh áo để trống thì dòng chạy như cũ.
- **Cài đặt** có khung **Đoạn ghép áo** để sửa câu dặn Muse.
- Nếu bạn đã tự sửa *Mẫu yêu cầu gửi Muse* trước bản này, tool sẽ nhắc thêm chỗ `{doan_ghep_ao}` (hoặc bấm *Khôi phục mẫu gốc*).

## v1.0.2

Sửa lỗi cập nhật trong tool chậm và bị đứng khi mạng chập chờn.

- Tải bản mới **nhanh hơn nhiều**. Tool tải nhiều phần cùng lúc, vì GitHub giới hạn tốc độ của từng kết nối.
- Tải bị đứng 30 giây thì tool tự thử lại, tải tiếp từ chỗ dừng, không tải lại từ đầu. Mạng chậm nhưng vẫn chạy thì tool cứ tải tới xong.
- Nếu vẫn không được, phần đã tải được giữ lại. Bấm **Cập nhật** lần nữa để tải tiếp.
- Trang cập nhật hiện tốc độ tải và báo *"Mạng chập chờn, đang thử lại"* khi bị đứng.
- Mọi câu báo lỗi khi cập nhật đều bằng tiếng Việt.

## v1.0.1

Bản thử cơ chế cập nhật trong tool. Không thay đổi tính năng.

- Dùng để kiểm tra nút **Cập nhật** và **Quay về** trong **Cài đặt → Phiên bản**.

## v1.0.0

Bản đầu tiên cho người trong đội.

- Tải zip, giải nén, bấm đúp `Mo-MASYS.bat` là dùng. Máy chỉ cần Google Chrome.
- Lần đầu mở, chọn file khoá Google `.json`. Tool mã hoá khoá và cất trong máy.
- Quét sheet, chọn dòng, tạo lô. Bot gửi lần lượt từng dòng cho Meta Muse, theo dõi ô Video và kiểm tra lại link.
- **Mới:** tự kiểm tra phiên bản mới. Cập nhật hoặc quay về bản trước bằng một nút trong **Cài đặt → Phiên bản**.
