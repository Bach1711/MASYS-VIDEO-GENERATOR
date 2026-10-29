// Mọi chỗ bot "nhìn" trên trang Muse (spec §8.3). Giao diện Muse đổi thì chỉ sửa file này.
// Ưu tiên role + tên hiển thị (cây trợ năng), không dùng class CSS.
// Tên thật ghi nhận ngày 26/10/2026 trên https://muse.ai/ (giao diện tiếng Anh):
//   - chưa đăng nhập: heading "Log in or create an account", textbox "Mobile number or email"
//   - đã đăng nhập: textbox "Message"; nút "Send" chỉ hiện khi ô chat có chữ
//   - cuộc trò chuyện mới = side chat: nút "Chats Open chat and side chats" → nút "New side chat"
//     → URL /thread/new; trò chuyện chính ở "/"

import type { Locator, Page } from "playwright-core";

export const DEFAULT_MUSE_URL = "https://muse.ai/";

/** Trang đăng nhập / tạo tài khoản Meta. */
export const login = {
  heading: (p: Page) => p.getByRole("heading", { name: /log in or create an account|đăng nhập/i }),
  identifier: (p: Page) => p.getByRole("textbox", { name: /mobile number or email|số di động hoặc email/i }),
  /** Các trang đăng nhập Meta mà muse.ai chuyển sang (auth.muse.ai, facebook.com/aymh, accountscenter). */
  url: /(^https:\/\/auth\.muse\.ai\/)|(facebook\.com\/(aymh|login))|(accountscenter\.)|(meta\.com\/login)/i,
};

/** Captcha / kiểm tra bảo mật / xác minh hai bước: bot dừng, người dùng tự xử lý (D6). */
export const challenge = {
  text: /captcha|security check|confirm (it'?s|that it'?s) you|verify (it'?s|that it'?s) you|two-factor|enter (the|your) (security )?code|kiểm tra bảo mật|xác (nhận|minh) (đó là )?bạn|mã xác (nhận|minh)/i,
  frame: (p: Page) => p.locator('iframe[title*="captcha" i], iframe[src*="captcha" i]'),
};

/** Màn hình chat. */
export const chat = {
  composer: (p: Page): Locator => p.getByRole("textbox", { name: /^(message|tin nhắn)$/i }).first(),
  send: (p: Page): Locator => p.getByRole("button", { name: /^(send|gửi)$/i }).first(),
  /** Mở danh sách trò chuyện (chính + side chat). */
  chatsPanel: (p: Page): Locator => p.getByRole("button", { name: /^chats\b/i }).first(),
  newSideChat: (p: Page): Locator => p.getByRole("button", { name: /^(new side chat|cuộc trò chuyện phụ mới)$/i }).first(),
  /** URL side chat mới, chưa gửi gì. */
  newThreadUrl: /\/thread\/new\b/,
  /** URL một side chat đã có (sau khi gửi) để lưu lại. */
  threadUrl: /\/thread\/(?!new\b)[A-Za-z0-9_-]{4,}/,
  /**
   * Đính kèm ảnh (ghi nhận 29/10/2026, spec 8.3): ô chat có `input[type=file]` (multiple) cạnh nút "Attach file";
   * mỗi ảnh đã nhận hiện một nút "Remove attachment" — đếm nút này để biết Muse đã nhận đủ ảnh.
   */
  fileInput: (p: Page): Locator => p.locator("input[type=file]").first(),
  removeAttachment: (p: Page): Locator => p.getByRole("button", { name: /^(remove attachment|xoá tệp đính kèm|xóa tệp đính kèm)$/i }),
  /**
   * Số video kết quả trong khung chat (ghi nhận 29/10/2026): thẻ <video> nguồn blob, 720×1280, rộng 280 px.
   * Ảnh đại diện động của trợ lý cũng là <video> nhưng chỉ rộng 48–128 px: bỏ mọi <video> nhỏ hơn 150 px.
   */
  resultVideoCount: (p: Page): Promise<number> =>
    p.locator("video").evaluateAll(
      (els) =>
        els.filter((el) => {
          const r = (el as unknown as { getBoundingClientRect(): { width: number; height: number } }).getBoundingClientRect();
          return r.width > 150 || r.height > 150;
        }).length,
    ),
};

/**
 * Muse xin duyệt trước một thao tác (lưu Drive, sửa Sheet). Bot không bao giờ tự bấm, chỉ báo người dùng.
 * Ghi nhận 27/10/2026: thẻ "Allow Như to create or upload files … in Google Drive?" với các nút
 * "Create" / "Always allow" / "Don't create", kèm nhãn "Needs approval" ở đầu cuộc trò chuyện và dưới tên trợ lý.
 * Khớp đúng tên nút để không nhầm với nút "Approvals" ở thanh bên.
 */
export const approval = {
  button: (p: Page): Locator =>
    p.getByRole("button", { name: /^(always allow|don'?t create|don'?t allow|allow once|approve|deny|luôn cho phép|không tạo)$/i }),
  text: /\bneeds approval\b|cần (bạn )?duyệt/i,
};

/** Thông báo của Muse trên trang: hết lượt, từ chối, lỗi (theo chữ hiển thị; câu thật ghi thêm khi gặp). */
export const notices = {
  quota: /out of (free )?(credits|tokens|messages)|usage limit|reached (your|the) (weekly |daily )?limit|limit reached|upgrade to continue|hết lượt|hết (token|hạn mức)/i,
  rejected: /can'?t help with (that|this)|i'?m (not able|unable) to help|violates? (our|the) (policies|policy|community standards)|không thể giúp/i,
  error: /something went wrong|an error occurred|try again later|network error|đã xảy ra lỗi|có lỗi xảy ra/i,
  /** Muse báo đã làm xong nhưng ô video trong chat không mở được (ghi nhận 29/10/2026; tải lại trang cũng không có). */
  videoMissing: /video not found|không tìm thấy video/i,
};
