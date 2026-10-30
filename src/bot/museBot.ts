import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import { logger } from "../logger.js";
import * as sel from "./museSelectors.js";

/** Trạng thái trang Muse mà hàng đợi cần biết (spec §7, §8.3). */
export type MuseState = "closed" | "ready" | "login" | "challenge" | "ui_changed";

export type BotErrorCode = Exclude<MuseState, "ready"> | "busy" | "quota" | "rejected" | "muse_error" | "send_unconfirmed";

export class BotError extends Error {
  constructor(
    readonly code: BotErrorCode,
    message: string,
    /** Đã bấm Gửi chưa. true thì tuyệt đối không tự gửi lại (D9). */
    readonly sent: boolean,
    readonly screenshot?: string,
  ) {
    super(message);
    this.name = "BotError";
  }
}

export const STATE_TEXT: Record<MuseState, string> = {
  closed: "Trình duyệt bot đang tắt",
  ready: "Sẵn sàng (thấy ô chat Muse)",
  login: "Cần đăng nhập Muse",
  challenge: "Muse/Meta đang hỏi kiểm tra bảo mật (captcha, mã xác nhận)",
  ui_changed: "Giao diện Muse thay đổi: không thấy ô chat",
};

export interface CheckResult {
  state: MuseState;
  /** URL trang hiện tại, đã bỏ phần sau dấu ? (có thể chứa mã phiên). */
  url?: string;
  screenshot?: string;
}

export interface MuseBotOptions {
  profileDir: string;
  screenshotDir: string;
  museUrl: () => string;
  /** Chỉ test mới dùng headless; bot thật luôn có cửa sổ (D8). */
  headless?: boolean;
  /** Thời gian chờ trang hiện ô chat / trang đăng nhập (ms). */
  loadTimeoutMs?: number;
  /** Thời gian chờ Muse nhận tin sau khi bấm Gửi (ms). */
  confirmTimeoutMs?: number;
  /** Thời gian chờ Muse nhận đủ ảnh đính kèm và cho bấm Gửi (ms). */
  attachTimeoutMs?: number;
  /** Nghỉ ngắn trước khi bấm Gửi, như người (ms). */
  pauseBeforeSendMs?: [number, number];
}

export const stripQuery = (url: string) => url.split(/[?#]/)[0]!;

/** Video Muse thường vài MB; quá mức này coi là lạ, không tải (giữ bộ nhớ trang và tool). */
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

/**
 * Điều khiển Chrome bằng hồ sơ bot riêng (ngoài repo). Không gõ mật khẩu, không vượt captcha (D6),
 * không đọc cookie: phiên đăng nhập chỉ nằm trong hồ sơ bot.
 */
export class MuseBot {
  private ctx?: BrowserContext;
  private opening?: Promise<BrowserContext>;
  private busy = false;
  /** Yêu cầu vừa gửi ở mỗi tab và các thông báo đã có trên trang trước khi gửi (để `watch` không báo nhầm). */
  private sent = new Map<string, { text: string; noticesBefore: NoticeKind[] }>();
  /** Tab riêng của từng lượt đang chờ video (chạy song song, D28). Không có tên tab = trang làm việc chung. */
  private tabs = new Map<string, Page>();

  constructor(private readonly o: MuseBotOptions) {}

  get isOpen() {
    return !!this.ctx;
  }

  get isBusy() {
    return this.busy;
  }

  private async context(): Promise<BrowserContext> {
    if (this.ctx) return this.ctx;
    this.opening ??= (async () => {
      fs.mkdirSync(this.o.profileDir, { recursive: true });
      const ctx = await chromium.launchPersistentContext(this.o.profileDir, {
        channel: "chrome",
        headless: this.o.headless ?? false,
        viewport: null,
      });
      ctx.on("close", () => {
        this.ctx = undefined;
        this.tabs.clear();
        logger.info("Trình duyệt bot đã đóng");
      });
      // Tab trống Chrome mở sẵn cùng hồ sơ có lúc tải Muse mãi không xong (ghi nhận 29/10/2026), tab mở thêm thì
      // tải bình thường: làm việc trên một tab mới, đóng các tab trống ban đầu.
      const initial = ctx.pages();
      await ctx.newPage();
      for (const p of initial) if (p.url() === "about:blank") await p.close().catch(() => {});
      this.ctx = ctx;
      logger.info({ profileDir: this.o.profileDir }, "Đã mở trình duyệt bot");
      return ctx;
    })().finally(() => (this.opening = undefined));
    return this.opening;
  }

  /**
   * Trang làm việc. Có `tab`: tab riêng của một lượt (mở mới nếu chưa có hoặc đã bị đóng).
   * Không có: tab cuối cùng còn mở mà không phải tab riêng của lượt nào, hoặc tab mới.
   */
  private async page(tab?: string): Promise<Page> {
    const ctx = await this.context();
    if (tab !== undefined) {
      const own = this.tabs.get(tab);
      if (own && !own.isClosed()) return own;
      const fresh = await ctx.newPage();
      this.tabs.set(tab, fresh);
      return fresh;
    }
    const owned = new Set(this.tabs.values());
    const pages = ctx.pages().filter((p) => !p.isClosed() && !owned.has(p));
    return pages[pages.length - 1] ?? (await ctx.newPage());
  }

  /** Đóng tab riêng của một lượt khi đã xong (tải video xong, Cần xem…). Không đụng trang làm việc chung. */
  async closeTab(tab: string): Promise<void> {
    const p = this.tabs.get(tab);
    this.tabs.delete(tab);
    this.sent.delete(tab);
    if (p && !p.isClosed()) await p.close().catch(() => {});
  }

  /** Mở cửa sổ bot (để người dùng đăng nhập hoặc xem), đưa lên trước. */
  async open(): Promise<void> {
    const page = await this.page();
    if (page.url() === "about:blank") await page.goto(this.o.museUrl(), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
  }

  async bringToFront(): Promise<void> {
    if (this.ctx) await (await this.page()).bringToFront().catch(() => {});
  }

  /**
   * Nhìn trang Muse trong lúc chờ video, không tải lại, không bấm gì (F5 bước 5).
   * Trình duyệt tắt thì trả `closed`; tool vẫn theo dõi ô Video bình thường.
   */
  async watch(tab?: string): Promise<WatchResult> {
    if (!this.ctx || this.busy) return { closed: !this.ctx, login: false, approval: false };
    if (tab !== undefined && (!this.tabs.get(tab) || this.tabs.get(tab)!.isClosed())) return { closed: true, login: false, approval: false };
    const page = await this.page(tab);
    const body = normalize(await bodyText(page));
    const last = this.sent.get(tab ?? "");
    const own = last ? normalize(last.text) : "";
    const before = last?.noticesBefore ?? [];
    const notice = noticeKinds(own ? body.replace(own, " ") : body).find((k) => !before.includes(k));
    const login =
      sel.login.url.test(page.url()) || (await visible(sel.login.heading(page))) || sel.challenge.text.test(body) || (await sel.challenge.frame(page).count()) > 0;
    const approval = sel.approval.text.test(body) || (await visible(sel.approval.button(page).first()));
    const videos = await sel.chat.resultVideoCount(page).catch(() => 0);
    return { closed: false, login, approval, notice, videos, url: page.url() };
  }

  /**
   * Mở lại một cuộc trò chuyện đã gửi (tool mở lại giữa chừng, spec 17.5) để theo dõi tiếp, không gửi gì.
   */
  async openChat(url: string, tab?: string): Promise<void> {
    const page = await this.page(tab);
    if (stripQuery(page.url()) !== stripQuery(url)) await page.goto(url, { waitUntil: "domcontentloaded" });
    await this.classify(page);
  }

  /**
   * Tải video mới nhất trong cuộc trò chuyện đang mở (spec 17.5 bước 6, D23). Video của Muse là thẻ `<video>`
   * nguồn `blob:`, không có nút tải: đọc thẳng trong trang bằng phiên của hồ sơ bot. Không bấm gì, không gửi gì.
   * `count`: số video kết quả trong cuộc trò chuyện (nhiều hơn 1 thì ghi chú, vẫn lấy video cuối).
   */
  async downloadVideo(tab?: string): Promise<{ data: Uint8Array; count: number }> {
    if (!this.ctx) throw new BotError("ui_changed", "Trình duyệt bot đã đóng", true);
    const page = await this.page(tab);
    // Chạy trong trang Muse (tsconfig không có thư viện DOM nên đọc qua globalThis).
    const r = await page.evaluate(async (maxBytes: number) => {
      type Vid = { currentSrc: string; src: string; getBoundingClientRect(): { width: number; height: number }; querySelector(s: string): { src: string } | null };
      const g = globalThis as unknown as {
        document: { querySelectorAll(s: string): ArrayLike<Vid> };
        fetch(u: string): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
        btoa(s: string): string;
      };
      const vids = Array.from(g.document.querySelectorAll("video")).filter((v) => {
        const box = v.getBoundingClientRect();
        return box.width > 150 || box.height > 150;
      });
      const v = vids[vids.length - 1];
      if (!v) return { error: "không thấy video trong cuộc trò chuyện", count: 0 };
      const src = v.currentSrc || v.src || v.querySelector("source")?.src || "";
      if (!src) return { error: "video chưa có nguồn", count: vids.length };
      const res = await g.fetch(src);
      if (!res.ok) return { error: `tải video lỗi ${res.status}`, count: vids.length };
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > maxBytes) return { error: "video quá lớn", count: vids.length };
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { base64: g.btoa(bin), count: vids.length };
    }, MAX_VIDEO_BYTES);
    if (!("base64" in r) || r.base64 === undefined) throw new BotError("ui_changed", `Chưa tải được video: ${r.error}`, true);
    return { data: new Uint8Array(Buffer.from(r.base64, "base64")), count: r.count };
  }

  async close(): Promise<void> {
    await this.ctx?.close();
    this.ctx = undefined;
  }

  /**
   * Xem trang đang ở trạng thái nào. Không mở trình duyệt nếu đang tắt.
   * `reload`: mở lại trang Muse trước khi xem (không dùng khi người dùng đang đăng nhập dở).
   */
  async check(opts: { reload?: boolean } = {}): Promise<CheckResult> {
    if (!this.ctx) return { state: "closed" };
    const page = await this.page();
    if (opts.reload || page.url() === "about:blank") await page.goto(this.o.museUrl(), { waitUntil: "domcontentloaded" });
    const state = await this.classify(page);
    const result: CheckResult = { state, url: stripQuery(page.url()) };
    if (state === "ui_changed") result.screenshot = await this.screenshot(page, "ui_changed");
    if (state !== "ready") await page.bringToFront().catch(() => {});
    return result;
  }

  /** Chờ trang hiện một trong các dấu hiệu đã biết; quá giờ thì coi là giao diện đổi. */
  private async classify(page: Page): Promise<Exclude<MuseState, "closed">> {
    const deadline = Date.now() + (this.o.loadTimeoutMs ?? 15_000);
    for (;;) {
      if (await visible(sel.chat.composer(page))) return "ready";
      if (sel.login.url.test(page.url()) || (await visible(sel.login.heading(page))) || (await visible(sel.login.identifier(page)))) {
        return "login";
      }
      if ((await sel.challenge.frame(page).count()) > 0 || sel.challenge.text.test(await bodyText(page))) return "challenge";
      if (Date.now() > deadline) return "ui_changed";
      await page.waitForTimeout(500);
    }
  }

  private async screenshot(page: Page, code: string): Promise<string | undefined> {
    try {
      fs.mkdirSync(this.o.screenshotDir, { recursive: true });
      const file = path.join(this.o.screenshotDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${code}.png`);
      await page.screenshot({ path: file });
      return file;
    } catch (e) {
      logger.warn({ err: e }, "Không chụp được màn hình trang Muse");
      return undefined;
    }
  }

  private async fail(page: Page, code: BotErrorCode, message: string, sent: boolean): Promise<never> {
    const shot = await this.screenshot(page, code);
    await page.bringToFront().catch(() => {});
    throw new BotError(code, message, sent, shot);
  }

  /**
   * Mở cuộc trò chuyện mới, đính kèm ảnh (nếu có, theo đúng thứ tự), dán yêu cầu, nghỉ ngắn, bấm Gửi (D7).
   * Chỉ bấm Gửi khi Muse hiện đủ số ảnh (spec 17.5 bước 3).
   * Trả về URL cuộc trò chuyện. Lỗi sau khi đã bấm Gửi luôn có `sent: true` để không ai gửi lại (D9).
   */
  async send(text: string, files: string[] = [], tab?: string): Promise<{ chatUrl: string }> {
    if (this.busy) throw new BotError("busy", "Bot đang gửi một yêu cầu khác", false);
    if (!this.ctx) throw new BotError("closed", STATE_TEXT.closed, false);
    this.busy = true;
    try {
      const page = await this.page(tab);
      // Tab riêng vừa mở còn trống: vào trang Muse trước.
      if (page.url() === "about:blank") await page.goto(this.o.museUrl(), { waitUntil: "domcontentloaded" });
      const before = await this.classify(page);
      if (before !== "ready") {
        if (before === "ui_changed") return await this.fail(page, before, STATE_TEXT.ui_changed, false);
        await page.bringToFront().catch(() => {});
        throw new BotError(before, STATE_TEXT[before], false);
      }

      // Mỗi lượt một cuộc trò chuyện mới (D7): Chats → New side chat → /thread/new.
      // Ô chat hiện trước khi danh sách trò chuyện tải xong (ghi nhận 29/10/2026): chờ nút New side chat hoặc nút Chats hiện ra.
      const newSideChat = sel.chat.newSideChat(page);
      const panel = sel.chat.chatsPanel(page);
      const panelDeadline = Date.now() + (this.o.loadTimeoutMs ?? 15_000);
      while (!(await visible(newSideChat)) && !(await visible(panel)) && Date.now() < panelDeadline) await page.waitForTimeout(500);
      if (!(await visible(newSideChat)) && (await visible(panel))) await panel.click();
      try {
        await newSideChat.click({ timeout: 10_000 });
        await page.waitForURL(sel.chat.newThreadUrl, { timeout: 10_000 });
      } catch {
        return await this.fail(page, "ui_changed", "Không mở được cuộc trò chuyện mới (không thấy nút New side chat)", false);
      }
      const fresh = await this.classify(page);
      if (fresh !== "ready") return await this.fail(page, fresh, `Không mở được cuộc trò chuyện mới: ${STATE_TEXT[fresh]}`, false);
      const startUrl = page.url();
      const noticesBefore = noticeKinds(await bodyText(page));

      if (files.length) {
        if ((await sel.chat.removeAttachment(page).count()) > 0) {
          return await this.fail(page, "ui_changed", "Cuộc trò chuyện mới đã có sẵn ảnh đính kèm lạ; chưa gửi", false);
        }
        try {
          await sel.chat.fileInput(page).setInputFiles(files, { timeout: 5000 });
        } catch {
          return await this.fail(page, "ui_changed", "Không thấy chỗ đính kèm ảnh của Muse", false);
        }
        const deadline = Date.now() + (this.o.attachTimeoutMs ?? 60_000);
        for (;;) {
          const got = await sel.chat.removeAttachment(page).count();
          if (got === files.length) break;
          if (got > files.length || Date.now() > deadline) {
            return await this.fail(page, "ui_changed", `Muse chỉ hiện ${got}/${files.length} ảnh đính kèm; chưa gửi`, false);
          }
          await page.waitForTimeout(500);
        }
      }

      const composer = sel.chat.composer(page);
      await composer.click();
      await composer.fill(text);
      const typed = normalize(await composerText(composer));
      if (!typed.includes(normalize(text).slice(0, 40))) {
        return await this.fail(page, "ui_changed", "Không dán được yêu cầu vào ô chat Muse", false);
      }

      const [min, max] = this.o.pauseBeforeSendMs ?? [1500, 3000];
      await page.waitForTimeout(min + Math.random() * (max - min));

      // Ảnh còn đang tải lên thì nút Gửi có thể chưa bấm được: chờ thêm một lúc.
      const send = sel.chat.send(page);
      const sendDeadline = Date.now() + (files.length ? (this.o.attachTimeoutMs ?? 60_000) : 0);
      while (!((await visible(send)) && (await send.isEnabled().catch(() => false)))) {
        if (Date.now() >= sendDeadline) return await this.fail(page, "ui_changed", "Không thấy nút Gửi của Muse", false);
        await page.waitForTimeout(500);
      }
      await send.click();
      logger.info({ url: stripQuery(startUrl) }, "Đã bấm Gửi trên Muse");
      this.sent.set(tab ?? "", { text, noticesBefore });

      // Từ đây yêu cầu có thể đã tới Muse: mọi lỗi đều sent=true.
      const deadline = Date.now() + (this.o.confirmTimeoutMs ?? 30_000);
      for (;;) {
        const body = await bodyText(page);
        // Bỏ chính yêu cầu vừa gửi ra khỏi chữ trên trang trước khi dò thông báo.
        const fresh = noticeKinds(normalize(body).replace(normalize(text), " ")).filter((k) => !noticesBefore.includes(k));
        if (fresh.includes("quota")) return await this.fail(page, "quota", "Muse báo hết lượt", true);
        if (fresh.includes("rejected")) return await this.fail(page, "rejected", "Muse từ chối yêu cầu", true);
        if (fresh.includes("error")) return await this.fail(page, "muse_error", "Muse báo lỗi sau khi gửi", true);
        const url = page.url();
        const composerEmpty = normalize(await composerText(composer)) === "";
        if (url !== startUrl && sel.chat.threadUrl.test(url)) return { chatUrl: url };
        // Ô chat đã trống và yêu cầu hiện trong khung trò chuyện: Muse đã nhận.
        if (composerEmpty && normalize(body).includes(normalize(text).slice(0, 60))) {
          // Muse đổi /thread/new → /thread/<id> chậm hơn một chút (có lúc hơn 15 giây, ghi nhận 29/10/2026); chờ để lưu
          // đúng link. Vẫn chưa đổi thì trả rỗng: hàng đợi lấy link sau, trong lúc chờ video (không bao giờ lưu /thread/new).
          await page.waitForURL(sel.chat.threadUrl, { timeout: 45_000 }).catch(() => {});
          return { chatUrl: sel.chat.isThreadUrl(page.url()) ? page.url() : "" };
        }
        if (Date.now() > deadline) {
          return await this.fail(page, "send_unconfirmed", "Đã bấm Gửi nhưng không chắc Muse đã nhận yêu cầu", true);
        }
        await page.waitForTimeout(500);
      }
    } finally {
      this.busy = false;
    }
  }
}

async function visible(l: { isVisible(): Promise<boolean> }): Promise<boolean> {
  return l.isVisible().catch(() => false);
}

/** Chữ trong ô chat, dù là ô nhập (value) hay vùng soạn thảo (contenteditable). */
async function composerText(l: Locator): Promise<string> {
  return l
    .evaluate((el) => {
      const e = el as unknown as { value?: unknown; innerText: string };
      return typeof e.value === "string" ? e.value : e.innerText;
    })
    .catch(() => "");
}

async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export type NoticeKind = "quota" | "rejected" | "error" | "videoMissing";

export interface WatchResult {
  closed: boolean;
  /** Trang đăng nhập hoặc kiểm tra bảo mật. */
  login: boolean;
  /** Muse đang chờ người dùng duyệt một thao tác. */
  approval: boolean;
  notice?: NoticeKind;
  /** Số video kết quả trong khung chat của trang đang mở (Bảng mới, spec 17.5 bước 5). */
  videos?: number;
  /** Địa chỉ trang đang mở (để lấy link cuộc trò chuyện khi Muse đổi /thread/new chậm). */
  url?: string;
}

function noticeKinds(body: string): NoticeKind[] {
  return (["quota", "rejected", "error", "videoMissing"] as const).filter((k) => sel.notices[k].test(body));
}
