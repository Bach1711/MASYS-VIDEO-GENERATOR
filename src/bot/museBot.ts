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
  /** Nghỉ ngắn trước khi bấm Gửi, như người (ms). */
  pauseBeforeSendMs?: [number, number];
}

export const stripQuery = (url: string) => url.split(/[?#]/)[0]!;

/**
 * Điều khiển Chrome bằng hồ sơ bot riêng (ngoài repo). Không gõ mật khẩu, không vượt captcha (D6),
 * không đọc cookie: phiên đăng nhập chỉ nằm trong hồ sơ bot.
 */
export class MuseBot {
  private ctx?: BrowserContext;
  private opening?: Promise<BrowserContext>;
  private busy = false;

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
        logger.info("Trình duyệt bot đã đóng");
      });
      this.ctx = ctx;
      logger.info({ profileDir: this.o.profileDir }, "Đã mở trình duyệt bot");
      return ctx;
    })().finally(() => (this.opening = undefined));
    return this.opening;
  }

  /** Trang đang làm việc: tab cuối cùng còn mở, hoặc tab mới. */
  private async page(): Promise<Page> {
    const ctx = await this.context();
    const pages = ctx.pages().filter((p) => !p.isClosed());
    return pages[pages.length - 1] ?? (await ctx.newPage());
  }

  /** Mở cửa sổ bot (để người dùng đăng nhập hoặc xem), đưa lên trước. */
  async open(): Promise<void> {
    const page = await this.page();
    if (page.url() === "about:blank") await page.goto(this.o.museUrl(), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
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
   * Mở cuộc trò chuyện mới, dán yêu cầu, nghỉ ngắn, bấm Gửi (D7).
   * Trả về URL cuộc trò chuyện. Lỗi sau khi đã bấm Gửi luôn có `sent: true` để không ai gửi lại (D9).
   */
  async send(text: string): Promise<{ chatUrl: string }> {
    if (this.busy) throw new BotError("busy", "Bot đang gửi một yêu cầu khác", false);
    if (!this.ctx) throw new BotError("closed", STATE_TEXT.closed, false);
    this.busy = true;
    try {
      const page = await this.page();
      const before = await this.classify(page);
      if (before !== "ready") {
        if (before === "ui_changed") return await this.fail(page, before, STATE_TEXT.ui_changed, false);
        await page.bringToFront().catch(() => {});
        throw new BotError(before, STATE_TEXT[before], false);
      }

      // Mỗi lượt một cuộc trò chuyện mới (D7): Chats → New side chat → /thread/new.
      const newSideChat = sel.chat.newSideChat(page);
      if (!(await visible(newSideChat))) {
        const panel = sel.chat.chatsPanel(page);
        if (await visible(panel)) await panel.click();
      }
      try {
        await newSideChat.click({ timeout: 5000 });
        await page.waitForURL(sel.chat.newThreadUrl, { timeout: 10_000 });
      } catch {
        return await this.fail(page, "ui_changed", "Không mở được cuộc trò chuyện mới (không thấy nút New side chat)", false);
      }
      const fresh = await this.classify(page);
      if (fresh !== "ready") return await this.fail(page, fresh, `Không mở được cuộc trò chuyện mới: ${STATE_TEXT[fresh]}`, false);
      const startUrl = page.url();
      const noticesBefore = noticeKinds(await bodyText(page));

      const composer = sel.chat.composer(page);
      await composer.click();
      await composer.fill(text);
      const typed = normalize(await composerText(composer));
      if (!typed.includes(normalize(text).slice(0, 40))) {
        return await this.fail(page, "ui_changed", "Không dán được yêu cầu vào ô chat Muse", false);
      }

      const [min, max] = this.o.pauseBeforeSendMs ?? [1500, 3000];
      await page.waitForTimeout(min + Math.random() * (max - min));

      const send = sel.chat.send(page);
      if (!(await visible(send)) || !(await send.isEnabled())) {
        return await this.fail(page, "ui_changed", "Không thấy nút Gửi của Muse", false);
      }
      await send.click();
      logger.info({ url: stripQuery(startUrl) }, "Đã bấm Gửi trên Muse");

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
          // Muse đổi /thread/new → /thread/<id> chậm hơn một chút; chờ để lưu đúng link cuộc trò chuyện.
          await page.waitForURL(sel.chat.threadUrl, { timeout: 15_000 }).catch(() => {});
          return { chatUrl: page.url() };
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

function noticeKinds(body: string): ("quota" | "rejected" | "error")[] {
  return (["quota", "rejected", "error"] as const).filter((k) => sel.notices[k].test(body));
}
