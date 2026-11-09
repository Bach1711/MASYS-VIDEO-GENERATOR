# Ghi chú thay đổi

Mỗi bản phát hành có một mục `## vX.Y.Z`. Nội dung mục được đăng nguyên văn làm ghi chú trên GitHub Releases và hiện trong tool, ở **Cài đặt → Phiên bản**. Viết bằng tiếng Việt, cho người dùng đọc: nói về thay đổi họ thấy được, không nói về code.

## v2.13.0

**Bảng video: chọn và tải tiện hơn, video tự đặt tên theo người mẫu.**

- **Bỏ chọn:** nút mới, bấm một lần là bỏ tích mọi dòng đã chọn, kể cả dòng ở trang khác.
- **Đổi trang không mất dòng đã chọn:** tích ở trang 3, về trang 2 tích tiếp, quay lại trang 3 vẫn còn tích. Đổi bộ lọc hay tìm kiếm cũng vậy. Dưới thanh nút ghi rõ "Đã chọn N dòng (gồm M dòng ở trang khác)". Tạo video, Xoá dòng đã chọn và Tải các dòng đã chọn áp dụng cho mọi dòng đã chọn ở mọi trang. Đóng tab thì danh sách chọn được xoá.
- **⬇ Tải các dòng đã chọn** giờ gom các video vào **một file zip** tên `Video nguoi mau <ngày> <giờ>.zip`: chỉ bấm Save một lần, rồi giải nén ra thư mục. Dòng có hook thì lấy bản có hook. Dòng chưa có video được bỏ qua và báo rõ.
- **Cột Người mẫu:** dòng xuất từ Bảng ảnh tự có tên và ảnh mặt của nhân vật (chưa có ảnh mặt thì hiện ảnh 4 góc), kể cả các dòng đã xuất từ trước. Dòng tạo lẻ (chọn ảnh từ máy, nhập từ sheet) để trống.
- **Video tự đặt tên theo người mẫu:** ví dụ `Illya Osipov 01`, `Illya Osipov 02`…, mỗi người mẫu đánh số riêng; dòng không có người mẫu là `Video 01`, `Video 02`… Tên hiện ngay dưới video và dùng khi tải một video hay tải cả file zip. Số đã dùng thì không dùng lại, nên không có hai video trùng tên. Video đã có trên máy cũng được đặt tên theo cách này.
- Ô Tìm trên Bảng video tìm được cả theo tên người mẫu.

## v2.12.0

**Bảng video: chọn nhanh và tải nhiều video một lần.**

- **Chọn tất cả:** tích mọi dòng trên trang, bất kể trạng thái. Dòng đang tạo video không tích được. Bấm lần nữa để bỏ chọn hết.
- **Chọn dòng xong:** tích các dòng đã có video.
- **⬇ Tải các dòng đã chọn:** tải lần lượt video của các dòng đang tích vào thư mục Tải xuống, mỗi dòng một file. Dòng có hook thì tải bản có hook. Dòng chưa có video được bỏ qua và báo rõ.
- Lần đầu tải, Chrome có thể hỏi cho phép trang tải nhiều file: bấm **Cho phép** một lần.

## v2.11.0

**Tạo nhiều ảnh, video cùng lúc ổn định hơn (Bảng video, Bảng ảnh, Tạo nhân vật).**

- Sửa tận gốc lỗi mất ảnh và trang trắng: Muse tự làm mới ô chat ngay sau khi mở cuộc trò chuyện mới, xoá mất chữ và ảnh bot vừa điền. Bot giờ chờ ô chat ổn định rồi mới điền, nên mỗi lần gửi lâu hơn khoảng 3 giây.
- Muse xoá chữ hoặc ảnh trước khi gửi: bot tự điền lại, vẫn không được thì đóng tab, mở tab mới làm lại, tối đa 3 tab. Các lần này chưa gửi Muse nên không tốn lượt.
- Tin đến Muse thiếu ảnh: bot nhận ra ngay và tự gửi lại trong cuộc trò chuyện mới, tổng tối đa 3 lần, không còn ngồi chờ đến khi bạn hủy lô. Mỗi lần đã gửi đều tính một lượt.
- Muse báo lỗi 502: dòng video thất bại ngay và tự chạy lại.
- Hỏng cả 3 tab: Bảng video chuyển dòng sang **Cần xem**, các dòng khác chạy tiếp. Bảng ảnh và Tạo nhân vật tạm dừng lô, nêu rõ lý do trong Nhật ký.
- 3 dòng khác nhau lỗi liên tiếp thì lô tạm dừng để không tốn lượt khi Muse đang hỏng.

**Trang Nhân vật gọn dạng bảng, lọc được theo khu vực.**

- Mỗi nhân vật là một dòng với ảnh thu nhỏ, có nhiều nhân vật vẫn dễ tìm.
- Bấm ảnh gốc, ảnh 4 góc hoặc ảnh mặt là xem toàn màn hình. Bấm bất kỳ đâu hoặc nhấn Esc để đóng, trang vẫn ở đúng chỗ cũ.
- Lọc theo Tất cả hoặc từng khu vực, luôn theo thứ tự thêm vào bảng.
- Đổi tên, xem prompt, xoá nằm trong nút **Sửa** ở cuối dòng. Dấu + trên ảnh vẫn dùng để thêm hoặc đổi ảnh.
- Nhân vật tạo trong app tự có khu vực. Thêm tay thì phải chọn khu vực.
- Nhân vật thêm tay từ trước hiện **Chưa có khu vực**: bấm ô Khu vực ngay trên dòng để chọn, chọn xong là lưu.

## v2.10.0

**Bảng video tự xử lý khi Muse lỗi, Hủy lô dừng ngay.**

- **Tự chạy lại dòng lỗi (Bảng video):** Muse load lỗi, bot không điền được prompt, trang đơ sau khi gửi, Muse báo lỗi hoặc hỏi lại thì tool đóng tab đó, ghi **Thất bại lần 1/3** và để các video khác chạy tiếp. Sau đó tool tự chạy lại dòng lỗi trong cuộc trò chuyện mới, tổng tối đa 3 lần. Vẫn lỗi thì chuyển **Cần xem** kèm ghi chú.
- Nếu 3 dòng khác nhau lỗi liên tiếp, lô tạm dừng để bạn kiểm tra Muse.
- Mỗi lần đã gửi Muse vẫn tính một lượt, kể cả lần thất bại. Trang đơ sau khi gửi có thể làm ra 2 video.
- **Hủy lô** giờ dừng ngay, kể cả khi bot đang gửi: bot đóng cửa sổ Muse. Dòng chưa gửi thành **Đã hủy**, dòng đã gửi thành **Cần xem**. Muốn chờ tải nốt video đã gửi thì bấm **Tạm dừng**.
- Yêu cầu tạo video có thêm câu dặn Muse không hỏi lại, không đưa lựa chọn, kể cả khi bạn đã sửa mẫu prompt.

## v2.9.0

**Tải ảnh nhân vật chỉ cần một lần bấm.**

- Thẻ nhân vật bỏ 3 dòng chọn file, mỗi ô ảnh có dấu **+**. Bấm **+**, chọn ảnh trong thư mục rồi xác nhận là ảnh tự tải lên đúng ô.
- Bấm vào ảnh vẫn mở ảnh lớn. Ở ô đã có ảnh, chọn file là ảnh cũ được thay ngay, nên chọn đúng file giúp nhé.
- Ảnh face tạo trong app đổi sang khung dọc 9:16, giống ảnh master. Ảnh turnaround vẫn ngang 16:9. Ảnh đã tạo giữ nguyên.

## v2.8.0

**Trang Nhân vật xem được đủ ảnh và prompt.**

- Mỗi thẻ hiện đủ 3 ảnh: **Ảnh gốc**, **Ảnh 4 góc**, **Ảnh mặt**. Ô ảnh 4 góc đổi sang khung ngang để thấy đúng ảnh turnaround.
- Nhân vật chưa có ảnh gốc thì bấm **Thêm ảnh gốc** ngay trên thẻ. Ảnh gốc chỉ để lưu giữ, không gửi Muse khi tạo ảnh.
- Nhân vật tạo trong app có nút **Xem prompt**: xem mô tả nhân vật và các prompt đã gửi Muse, bấm **Sao chép** để dùng lại.
- Prompt tạo nhân vật có quy định khung ảnh rõ ràng: ảnh master dọc 9:16, ảnh turnaround ngang 16:9, ảnh face vuông 1:1. Ảnh đã tạo giữ nguyên.

## v2.7.0

**Tạo nhân vật giờ chỉ cần bấm một nút.**

- Điền thông tin rồi bấm **▶ Tạo nhân vật**: bot tự tạo ảnh master, ảnh turnaround và ảnh face, không phải bấm thêm gì. Mỗi nhân vật tốn 3 lượt ảnh.
- Trang **Nhân vật** có mục **Đang tạo** để xem tiến độ. Có ảnh turnaround là nhân vật tự vào thư viện.
- Ảnh face lỗi thì nhân vật vẫn được lưu, tool báo thiếu để bạn tạo lại sau. Ảnh lỗi không được tự gửi lại.
- Tạo lại một ảnh sau khi đã lưu thì nhân vật dùng ngay ảnh mới. Tạo lại ảnh master sẽ tạo lại cả 3 ảnh.

## v2.6.0

**Mới: tạo nhân vật ngay trong app.**

- Vào **Nhân vật**, bấm **✨ Tạo nhân vật** và điền 12 tiêu chí: tuổi, khu vực, giới tính, vóc dáng, da, khuôn mặt, mắt, tóc, phụ kiện, áo, quần, giày.
- Chưa nghĩ ra áo, quần, giày? Bấm **📋 Sao chép prompt nhờ AI điền**, dán sang ChatGPT, Claude hoặc Gemini, rồi dán câu trả lời lại app. App chỉ điền các ô còn trống.
- Bot nhờ Muse tạo **ảnh master** để bạn chọn, rồi tạo tiếp **ảnh turnaround** và **ảnh face**. Ảnh nào chưa đẹp thì chỉ cần tạo lại ảnh đó.
- Bấm **💾 Lưu nhân vật** là dùng được ngay trên **Bảng ảnh**.
- Mỗi lần tạo tính 1 lượt ảnh trong giới hạn ảnh mỗi ngày, không trừ giới hạn video.

## v2.5.0

**Nhân vật có 2 ảnh: ảnh 4 góc và ảnh mặt.**

- Trang **Nhân vật** có hai ô riêng: **Ảnh 4 góc** (toàn thân nhiều góc) và **Ảnh mặt** (cận mặt). Thêm, đổi, xoá ảnh mặt ngay trên trang này. Ảnh mặt không bắt buộc nhưng giúp Muse giữ mặt giống hơn.
- Khi tạo ảnh, bot gửi Muse ảnh 4 góc trước, ảnh mặt sau. Trang xem trước hiện rõ cả hai ảnh.
- Mẫu tạo ảnh mới dặn Muse không chép trang phục trong ảnh nhân vật: trang phục lấy theo prompt. Nếu bạn đã tự sửa Mẫu tạo ảnh trong Cài đặt thì mẫu của bạn giữ nguyên (bấm Khôi phục bản gốc để dùng mẫu mới).
- Nhân vật đã thêm trước đây vẫn dùng được với 1 ảnh, file cũ được xem là ảnh 4 góc.

## v2.4.0

**Mới: xuất ảnh từ Bảng ảnh sang Bảng video, khỏi phải tải về rồi chọn lại.**

- Trên **Bảng ảnh**, tích các dòng đã có ảnh rồi bấm **📤 Xuất sang Bảng video**.
- Trang xem trước cho thấy từng dòng sẽ thành gì trên Bảng video và ghi **"Sẽ thêm N dòng"**. Dòng chưa có ảnh mặt trước, hoặc đang tạo ảnh, được báo riêng và bỏ qua.
- Bấm **📤 Xuất**: mỗi dòng thành **một dòng mới** trên Bảng video:
  - **ảnh chính mặt trước** (★) làm **Mẫu trước**;
  - **ảnh chính quay lưng** (nếu có) làm **Mẫu sau**;
  - Prompt, Áo trước, Áo sau bạn tự thêm trên Bảng video như mọi dòng khác.
- Ảnh được **chép** sang, nên xoá dòng hoặc ảnh ở bảng này không làm mất ảnh ở bảng kia.
- Dòng đã xuất ghi **Đã xuất → dòng #N**, bấm vào là mở đúng dòng đó trên Bảng video. Có thêm bộ lọc **Đã xuất**.
- Xuất lại một dòng đã xuất: trang xem trước hỏi trước, phải tích **Xuất lại** mới thêm dòng mới (dòng cũ trên Bảng video vẫn giữ).

## v2.3.1

**Sửa lỗi: không bấm được Cập nhật, báo "Lô #… còn dòng đang gửi hoặc đang chờ Muse" dù lô đó đã huỷ.**

- Lỗi xảy ra khi bấm **Huỷ** một lô đang tạm dừng trong lúc có dòng đã gửi Muse và đang chờ video: dòng đó bị kẹt ở "đang chờ" mãi, và tool không cho cập nhật hay quay về phiên bản.
- Nay huỷ lô như vậy thì dòng đã gửi Muse chuyển sang **Cần xem** (bấm **Mở trong Muse** để xem video trong cuộc trò chuyện); tool không gửi lại dòng đó. Dòng chưa gửi vẫn chuyển **Đã huỷ** như trước.
- Dòng đã bị kẹt từ trước được tự gỡ (chuyển **Cần xem**) khi mở tool, và không chặn cập nhật nữa.
- Máy đang ở bản 2.1.0 hoặc 2.2.0 mà gặp lỗi này thì chưa bấm Cập nhật được: tải zip bản mới ở trang phát hành và giải nén đè lên thư mục cũ (dữ liệu giữ nguyên), hoặc nhờ người phụ trách gỡ giúp.

## v2.3.0

**Mới: Bảng ảnh: Muse tạo ảnh nhân vật AI của bạn, luôn đúng người nhờ character sheet.**

- Thanh trên cùng có thêm **Bảng ảnh** và **Nhân vật**. Bảng cũ nay tên là **Bảng video** và vẫn chạy như trước. Hai bảng độc lập với nhau.
- **Nhân vật:** bấm **+ Thêm nhân vật**, đặt tên và chọn file **character sheet** (ảnh nhân vật nhiều góc bạn đã tự tạo; JPG, PNG, WEBP, tối đa 20 MB). Thêm bao nhiêu nhân vật cũng được. Đổi tên, đổi file, xoá ngay trên trang. File chỉ nằm trên máy này.
- **Bảng ảnh:** mỗi dòng là một ảnh.
  - Thêm dòng: chọn nhân vật, bấm **+ Thêm dòng**, hoặc bấm **Dán nhiều prompt** (mỗi dòng chữ thành một dòng mới).
  - Mỗi dòng có prompt (dáng, trang phục, bối cảnh; bấm ✎ để sửa) và ô **Quay lưng**: tích ô này để có thêm một ảnh quay lưng của đúng người đó, cùng trang phục, cùng bối cảnh.
- Tích dòng rồi bấm **▶ Tạo ảnh**. Trang xem trước cho thấy character sheet và đúng nội dung sẽ gửi Muse. Bấm **Bắt đầu**:
  - bot mở một cuộc trò chuyện mới cho mỗi dòng, gửi character sheet kèm yêu cầu, chờ ảnh rồi tải về máy;
  - dòng tích Quay lưng: tải xong ảnh mặt trước, bot xin thêm ảnh quay lưng trong cùng cuộc trò chuyện;
  - chạy nhiều dòng cùng lúc theo **Số video chạy cùng lúc** ở Cài đặt.
- **Ảnh trên dòng:** Muse trả nhiều ảnh thì bấm **◀ ▶** để xem từng ảnh, **☆** để chọn ảnh chính, **⬇** để tải về (tên `MASYS_ANH_<số dòng>_<truoc|sau>_<ngày-giờ>`), **🗑** để xoá ảnh xấu. Bấm vào ảnh để xem lớn. **Tạo lại** cho thêm ảnh mới, ảnh cũ vẫn giữ.
- **Giới hạn ảnh mỗi ngày** đếm riêng với video: mặc định 100, cao nhất 150, chỉnh ở **Cài đặt**. Mỗi tin xin ảnh tính một lượt; dòng có Quay lưng tính 2.
- **Cài đặt** có thêm **Mẫu tạo ảnh** và **Mẫu ảnh quay lưng** để sửa câu gửi Muse, có nút **Khôi phục bản gốc**.
- **Dọn tất cả** trên Bảng ảnh xoá các dòng xong cùng ảnh của chúng; nhân vật không bị xoá.
- Bản sau (2.4.0) sẽ có nút **xuất ảnh đã chọn sang Bảng video** làm ảnh người mẫu.

## v2.2.0

**Mới: thêm hook vào đầu video, đúng kiểu video mẫu (clip + câu chữ, rồi mờ dần sang video người mẫu).**

- Tích **Thêm hook** ở thanh nút dưới Bảng. Hiện ô **Câu hook chung hôm nay**, ví dụ *I want this shirt but I'm broke...*. Mọi video tạo trong hôm nay dùng câu này; sang ngày mới thì ô trống để điền câu mới.
- Bảng có thêm cột **Hook**:
  - bấm **+** (hoặc kéo clip vào ô) để chọn **clip hook** của dòng: clip bạn đã tải và cắt sẵn từ YouTube (MP4, MOV, WEBM, MKV, tối đa 300 MB). Mỗi video một clip riêng;
  - bấm **✎** để đặt **câu hook riêng** cho dòng đó. Để trống thì dùng câu chung hôm nay.
- Bấm **▶ Tạo video**: trang xem trước ghi rõ từng dòng dùng clip nào, câu nào. Dòng thiếu clip hoặc chưa có câu thì báo ngay, không chạy.
- Muse làm xong video là tool **tự ghép hook** trên máy: clip hook nằm giữa khung dọc nền đen, câu hook chữ đen trên nền trắng bo góc ngay phía trên, rồi **mờ dần 0,5 giây** sang video Muse. Video ra 1080×1920, không tiếng. Ghép mất vài giây mỗi video.
- Ở cột **Video** có thêm dòng **Có hook ▶ ⬇**: xem và tải bản có hook (tên `MASYS_<số dòng>_<ngày-giờ>_hook.mp4`). **Bản gốc vẫn giữ.**
- Dòng đã có video: bấm **Ghép hook** (hoặc **Ghép lại hook** sau khi đổi clip / đổi câu). Không tốn lượt Muse.
- Ghép lỗi (ví dụ clip hỏng) thì dòng ghi lý do; video gốc không bị ảnh hưởng.
- Bỏ tích **Thêm hook** thì Bảng và video như trước; clip và câu đã chọn vẫn được giữ.
- Clip hook bị xoá cùng dòng khi bấm **Xoá dòng đã chọn** / **Dọn tất cả**. Bản tải về nặng thêm khoảng 35 MB vì có kèm bộ ghép video.

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
