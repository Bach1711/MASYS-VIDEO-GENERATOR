import { BotError, type WatchResult } from "../bot/museBot.js";
import type { DB } from "../db/index.js";
import { getDailyQuota } from "../db/quota.js";
import { logRunEvent, moveRun } from "../db/runs.js";
import { getSettings } from "../db/settings.js";
import { getSheetConfig, type SheetConfig } from "../db/sheetConfigs.js";
import { columnIndex } from "../google/a1.js";
import { parseDriveLink, type DriveClient } from "../google/drive.js";
import { GoogleApiError } from "../google/http.js";
import type { Grid, SheetsClient } from "../google/sheets.js";
import { diffSnapshots, unexpectedChanges } from "../google/snapshot.js";
import { logger } from "../logger.js";
import { isRunningStatus, STATUS_RUNNING } from "../scan/labels.js";

// Hàng đợi chạy lô (spec F5, §7, D7, D9, D11, D12, D13). Mỗi lúc chỉ một lô chạy, các dòng chạy tuần tự.

/** Phần của bot mà hàng đợi dùng (MuseBot thật hoặc bản giả trong test). */
export interface MuseDriver {
  readonly isOpen: boolean;
  open(): Promise<void>;
  send(text: string): Promise<{ chatUrl: string }>;
  watch(): Promise<WatchResult>;
  bringToFront(): Promise<void>;
}

export type PauseReason = "user" | "login" | "ui" | "quota" | "limit" | "row_shift" | "other_cells" | "google" | "restart";

export const PAUSE_TEXT: Record<PauseReason, string> = {
  user: "Bạn đã bấm Tạm dừng.",
  login: "Cần đăng nhập lại Muse. Đăng nhập (hoặc vượt bước kiểm tra bảo mật) trong cửa sổ bot rồi bấm Tiếp tục.",
  ui: "Giao diện Muse thay đổi: bot không tìm thấy ô chat hoặc nút Gửi (hoặc trình duyệt bot bị tắt). Xem ảnh chụp trong Nhật ký.",
  quota: "Muse hết lượt / hết token. Khi Muse có lượt trở lại, bấm Tiếp tục.",
  limit: "Đã đủ video trong ngày (giới hạn ở Cài đặt, D13). Ngày mai bấm Tiếp tục.",
  row_shift: "Một dòng trong sheet đã bị đổi so với lúc tạo lô (lệch dòng). Kiểm tra sheet rồi bấm Tiếp tục.",
  other_cells: "Muse sửa nhầm ô: có ô khác trong sheet bị đổi trong lúc chạy. Kiểm tra sheet rồi bấm Tiếp tục.",
  google: "Không đọc hoặc ghi được Google Sheet. Kiểm tra mạng / quyền chia sẻ rồi bấm Tiếp tục.",
  restart: "Tool vừa mở lại sau khi bị tắt giữa chừng. Bấm Tiếp tục để chạy các dòng còn lại.",
};

/** Câu ngắn cho dải báo trên đầu trang và trang Lịch sử lô. */
export const PAUSE_SHORT: Record<PauseReason, string> = {
  user: "Bạn đã bấm Tạm dừng",
  login: "Cần đăng nhập lại Muse",
  ui: "Giao diện Muse thay đổi",
  quota: "Muse hết lượt / hết token",
  limit: "Đã đủ video trong ngày",
  row_shift: "Lệch dòng trong sheet",
  other_cells: "Muse sửa nhầm ô",
  google: "Lỗi Google Sheet",
  restart: "Tool vừa mở lại",
};

/** Ghi vào ô Trạng thái (D11). */
export const STATUS = {
  running: STATUS_RUNNING,
  done: "Xong",
  timeout: "Cần xem: quá thời gian",
  badLink: "Cần xem: link không hợp lệ",
  otherCells: (cells: string[]) => `Cần xem: Muse sửa ô khác (${cells.join(", ")})`,
  failed: (why: string) => `Lỗi: ${why}`,
};

export interface RunnerOptions {
  /** Chu kỳ đọc ô Video (mặc định 20 giây). */
  pollMs?: number;
  /** Độ dài một phút / một giây: test thu nhỏ để chạy nhanh. */
  minuteMs?: number;
  secondMs?: number;
  random?: () => number;
}

interface RunRow {
  id: number;
  batchId: number;
  rowNumber: number;
  state: string;
  inputSnapshot: string;
  requestText: string;
  overwrite: number;
  sentAt: string | null;
  tabSnapshot: string | null;
}

interface BatchRow {
  id: number;
  spreadsheetId: string;
  tab: string;
  driveFolderId: string;
  status: string;
  pauseReason: string | null;
}

interface InputSnapshot {
  image: string;
  prompt: string;
  video: string;
  status: string;
}

interface Outcome {
  pause?: PauseReason;
  /** Lượt này đã gửi Muse (để nghỉ trước lượt sau). */
  sent?: boolean;
}

export class BatchRunner {
  private active?: { batchId: number; pauseRequested: boolean; cancelRequested: boolean; wake?: () => void; promise: Promise<void> };
  /** Thông báo đang diễn ra của lô (ví dụ Muse đang chờ duyệt), hiện trên trang lô. */
  readonly notices = new Map<number, string>();

  constructor(
    private readonly db: DB,
    private readonly sheets: SheetsClient,
    private readonly drive: DriveClient,
    private readonly bot: MuseDriver,
    private readonly o: RunnerOptions = {},
  ) {}

  get runningBatchId(): number | undefined {
    return this.active?.batchId;
  }

  /** Chờ lô đang chạy dừng hẳn (dùng trong test và khi tắt tool). */
  async idle(): Promise<void> {
    await this.active?.promise;
  }

  /** Bắt đầu hoặc Tiếp tục một lô. Lượt đã gửi Muse không bao giờ được gửi lại (D9). */
  start(batchId: number): { ok: true } | { ok: false; message: string } {
    if (this.active) return { ok: false, message: `Đang chạy lô #${this.active.batchId}. Mỗi lúc chỉ chạy một lô.` };
    const b = this.batch(batchId);
    if (!b) return { ok: false, message: "Không có lô này." };
    if (b.status !== "queued" && b.status !== "paused") return { ok: false, message: "Lô này không ở trạng thái chờ chạy hoặc tạm dừng." };
    this.db.transaction(() => {
      for (const r of this.runs(batchId, ["paused_login", "paused_ui", "paused_limit"])) {
        moveRun(this.db, r.id, r.state, "queued", "Tiếp tục: xếp lại hàng đợi (lượt này chưa gửi Muse)", { sentAt: null });
      }
      for (const r of this.runs(batchId, ["paused_quota"])) {
        moveRun(this.db, r.id, r.state, "failed", "Đã gửi Muse nhưng Muse báo hết lượt; không gửi lại (D9)", { doneAt: new Date().toISOString() });
      }
      this.setBatch(batchId, "running", null);
    })();
    this.launch(batchId, "full");
    return { ok: true };
  }

  /** Tạm dừng: lượt đang chờ Muse vẫn được theo dõi cho xong, chỉ không sang dòng sau. */
  pause(batchId: number): boolean {
    if (this.active?.batchId !== batchId) return false;
    this.active.pauseRequested = true;
    this.active.wake?.();
    return true;
  }

  /**
   * Huỷ lô (F6): dừng trước dòng kế tiếp; dòng đang chờ Muse vẫn được theo dõi cho xong (không can thiệp Muse).
   * Các dòng chưa gửi chuyển Đã huỷ.
   */
  cancel(batchId: number): { ok: true; immediate: boolean } | { ok: false; message: string } {
    if (this.active?.batchId === batchId) {
      this.active.cancelRequested = true;
      this.active.wake?.();
      return { ok: true, immediate: false };
    }
    const b = this.batch(batchId);
    if (!b || (b.status !== "queued" && b.status !== "paused")) return { ok: false, message: "Lô này không ở trạng thái huỷ được." };
    this.finishCancel(batchId);
    return { ok: true, immediate: true };
  }

  private finishCancel(batchId: number): void {
    this.db.transaction(() => {
      for (const r of this.runs(batchId, ["queued", "paused_login", "paused_ui", "paused_limit"])) {
        moveRun(this.db, r.id, r.state, "canceled", "Huỷ lô: dòng này chưa gửi Muse", { sentAt: null, doneAt: now() });
      }
      for (const r of this.runs(batchId, ["paused_quota"])) {
        moveRun(this.db, r.id, r.state, "failed", "Huỷ lô: đã gửi Muse nhưng Muse báo hết lượt", { doneAt: now() });
      }
      this.setBatch(batchId, "canceled", null);
    })();
  }

  /**
   * Khi tool mở lại: lô đang chạy chuyển Tạm dừng; lượt đã gửi được theo dõi tiếp thêm một chu kỳ chờ,
   * không gửi lại (§7, §12.10). Các dòng sau chờ người dùng bấm Tiếp tục.
   */
  recover(): void {
    const batches = this.db.prepare("SELECT id FROM batches WHERE status = 'running' ORDER BY id").all() as { id: number }[];
    for (const { id } of batches) {
      for (const r of this.runs(id, ["checking_row"])) {
        moveRun(this.db, r.id, r.state, "queued", "Tool mở lại: lượt chưa gửi Muse, xếp lại hàng đợi");
      }
      this.setBatch(id, "paused", "restart");
      const sent = this.runs(id, ["sending", "waiting", "verifying"]);
      if (sent.length && !this.active) this.launch(id, "watch");
      logger.info({ batchId: id, inflight: sent.map((r) => r.rowNumber) }, "Khôi phục lô sau khi tool mở lại");
    }
  }

  private launch(batchId: number, mode: "full" | "watch") {
    const active = { batchId, pauseRequested: false, cancelRequested: false, wake: undefined as (() => void) | undefined, promise: Promise.resolve() };
    this.active = active;
    active.promise = this.loop(batchId, mode)
      .catch((e) => {
        logger.error({ err: e, batchId }, "Hàng đợi dừng vì lỗi không lường trước");
        this.setBatch(batchId, "paused", "google");
      })
      .finally(() => {
        if (active.cancelRequested) this.finishCancel(batchId);
        this.active = undefined;
        this.notices.delete(batchId);
      });
  }

  /** Tạm dừng hoặc Huỷ đã được bấm (huỷ được hoàn tất khi vòng lặp dừng). */
  private stopRequested(): boolean {
    return !!(this.active?.pauseRequested || this.active?.cancelRequested);
  }

  private async loop(batchId: number, mode: "full" | "watch"): Promise<void> {
    const batch = this.batch(batchId)!;
    const cfg = getSheetConfig(this.db, batch.spreadsheetId, batch.tab);
    if (!cfg) return this.setBatch(batchId, "paused", "google");

    // Lượt đã gửi trước khi tool tắt: chỉ theo dõi tiếp, một chu kỳ chờ tính từ bây giờ.
    for (const r of this.runs(batchId, ["sending", "waiting", "verifying"])) {
      if (r.state !== "waiting") moveRun(this.db, r.id, r.state, "waiting", "Tool mở lại: theo dõi tiếp ô Video, không gửi lại (D9)");
      else logRunEvent(this.db, r.id, "waiting", "Tool mở lại: theo dõi tiếp ô Video, không gửi lại (D9)");
      const out = await this.watchAndVerify(r, cfg, batch, Date.now() + this.timeoutMs());
      if (out.pause) return this.setBatch(batchId, "paused", out.pause);
    }
    if (mode === "watch") return;

    if (!this.bot.isOpen) await this.bot.open();
    let previousSent = false;
    for (;;) {
      if (this.stopRequested()) return this.setBatch(batchId, "paused", "user");
      const next = this.runs(batchId, ["queued"])[0];
      if (!next) return this.setBatch(batchId, "done", null);
      if (previousSent) {
        // Nghỉ ngẫu nhiên giữa hai lượt (D7).
        await this.sleep(this.pauseMs());
        if (this.stopRequested()) return this.setBatch(batchId, "paused", "user");
      }
      const out = await this.processRun(next, cfg, batch);
      if (out.pause) return this.setBatch(batchId, "paused", out.pause);
      previousSent = !!out.sent;
    }
  }

  /** F5 bước 1–4 rồi theo dõi + kiểm tra. */
  private async processRun(run: RunRow, cfg: SheetConfig, batch: BatchRow): Promise<Outcome> {
    const snap = JSON.parse(run.inputSnapshot) as InputSnapshot;

    if (getDailyQuota(this.db).remaining <= 0) {
      moveRun(this.db, run.id, "queued", "paused_limit", "Đủ giới hạn video hôm nay (D13)");
      return { pause: "limit" };
    }

    // Bước 1: đọc lại dòng N.
    moveRun(this.db, run.id, "queued", "checking_row", "Đọc lại dòng trong sheet");
    let current: InputSnapshot;
    try {
      current = pick(await this.sheets.readRow(cfg.spreadsheetId, cfg.tab, run.rowNumber), cfg);
    } catch (e) {
      moveRun(this.db, run.id, "checking_row", "queued", `Không đọc được sheet: ${errText(e)}`);
      return { pause: "google" };
    }
    if (current.image !== snap.image || current.prompt !== snap.prompt) {
      // Không ghi sheet: dòng N giờ có thể là của sản phẩm khác.
      moveRun(this.db, run.id, "checking_row", "needs_review", "Ảnh hoặc prompt dòng này khác lúc tạo lô (lệch dòng)", {
        error: "lệch dòng",
        doneAt: now(),
      });
      return { pause: "row_shift" };
    }
    if (current.video && (!run.overwrite || current.video !== snap.video)) {
      moveRun(this.db, run.id, "checking_row", "skipped_has_video", "Ô Video đã có link nên bỏ qua, không gửi Muse", { doneAt: now() });
      return {};
    }
    if (isRunningStatus(current.status)) {
      moveRun(this.db, run.id, "checking_row", "needs_review", "Ô Trạng thái đang là Đang chạy (có thể chạy ở nơi khác); bỏ qua", {
        error: "dòng đang chạy ở nơi khác",
        doneAt: now(),
      });
      return {};
    }

    // Bước 2: chụp toàn tab. Bước 3: ghi Đang chạy.
    let before: Grid;
    try {
      before = await this.sheets.readTab(cfg.spreadsheetId, cfg.tab, "FORMULA");
      await this.sheets.writeStatus(cfg, run.rowNumber, STATUS.running);
    } catch (e) {
      moveRun(this.db, run.id, "checking_row", "queued", `Không chụp / ghi được sheet: ${errText(e)}`);
      return { pause: "google" };
    }

    // Bước 4: sentAt ghi trước khi bấm Gửi.
    moveRun(this.db, run.id, "checking_row", "sending", "Gửi yêu cầu cho Muse (cuộc trò chuyện mới)", {
      sentAt: now(),
      tabSnapshot: JSON.stringify(before),
    });
    const sentRun = { ...run, tabSnapshot: JSON.stringify(before) };
    try {
      const { chatUrl } = await this.bot.send(run.requestText);
      moveRun(this.db, run.id, "sending", "waiting", "Đã gửi Muse, theo dõi ô Video", { museChatUrl: chatUrl });
    } catch (e) {
      const err = e instanceof BotError ? e : new BotError("send_unconfirmed", `Lỗi khi gửi: ${errText(e)}`, true);
      if (!err.sent) {
        // Chưa gửi: trả ô Trạng thái như cũ, không tính vào giới hạn ngày.
        await this.writeStatusSafe(cfg, run, snap.status);
        const to = err.code === "login" || err.code === "challenge" ? "paused_login" : "paused_ui";
        moveRun(this.db, run.id, "sending", to, `Chưa gửi: ${err.message}`, { sentAt: null }, err.screenshot);
        await this.bot.bringToFront();
        return { pause: to === "paused_login" ? "login" : "ui" };
      }
      if (err.code === "quota") {
        moveRun(this.db, run.id, "sending", "paused_quota", err.message, { error: "Muse hết lượt" }, err.screenshot);
        await this.writeStatusSafe(cfg, run, STATUS.failed("Muse hết lượt"));
        return { pause: "quota", sent: true };
      }
      if (err.code === "rejected" || err.code === "muse_error") {
        moveRun(this.db, run.id, "sending", "failed", err.message, { error: err.message, doneAt: now() }, err.screenshot);
        await this.writeStatusSafe(cfg, run, STATUS.failed(err.message));
        return { sent: true };
      }
      // Không chắc Muse đã nhận: không gửi lại, vẫn theo dõi ô Video đến hết giờ.
      moveRun(this.db, run.id, "sending", "waiting", `${err.message}. Không gửi lại; vẫn theo dõi ô Video`, {}, err.screenshot);
    }
    const deadline = Date.now() + this.timeoutMs();
    return { ...(await this.watchAndVerify(sentRun, cfg, batch, deadline)), sent: true };
  }

  /** F5 bước 5–7: theo dõi ô Video mỗi chu kỳ, rồi kiểm tra D12 và so bản chụp. */
  private async watchAndVerify(run: RunRow, cfg: SheetConfig, batch: BatchRow, deadline: number): Promise<Outcome> {
    const snap = JSON.parse(run.inputSnapshot) as InputSnapshot;
    let video = "";
    let waitingApproval = false;
    let loginNoted = false;
    try {
      for (;;) {
        try {
          const cur = pick(await this.sheets.readRow(cfg.spreadsheetId, cfg.tab, run.rowNumber), cfg);
          if (cur.video && (!run.overwrite || cur.video !== snap.video)) {
            video = cur.video;
            break;
          }
        } catch (e) {
          logger.warn({ err: e, runId: run.id }, "Không đọc được ô Video, thử lại chu kỳ sau");
        }
        if (Date.now() >= deadline) {
          moveRun(this.db, run.id, "waiting", "needs_review", "Quá thời gian chờ mà ô Video chưa có link; không gửi lại (D9)", {
            error: "quá thời gian",
            doneAt: now(),
          });
          await this.writeStatusSafe(cfg, run, STATUS.timeout);
          return {};
        }
        const w = await this.bot.watch().catch(() => ({ closed: true, login: false, approval: false }) as WatchResult);
        if (w.approval !== waitingApproval) {
          waitingApproval = w.approval;
          if (w.approval) {
            this.notices.set(batch.id, `Muse đang chờ bạn duyệt (dòng ${run.rowNumber}). Mở cửa sổ bot và bấm duyệt trong Muse; bot không tự bấm.`);
            logRunEvent(this.db, run.id, "waiting", "Muse đang chờ người dùng duyệt một thao tác");
            await this.bot.bringToFront();
          } else this.notices.delete(batch.id);
        }
        if (w.login && !loginNoted) {
          loginNoted = true;
          logRunEvent(this.db, run.id, "waiting", "Trang Muse đang hiện đăng nhập / kiểm tra bảo mật; vẫn theo dõi ô Video");
        }
        if (w.notice === "quota") {
          moveRun(this.db, run.id, "waiting", "paused_quota", "Muse báo hết lượt", { error: "Muse hết lượt" });
          await this.writeStatusSafe(cfg, run, STATUS.failed("Muse hết lượt"));
          return { pause: "quota" };
        }
        if (w.notice === "rejected" || w.notice === "error") {
          const why = w.notice === "rejected" ? "Muse từ chối yêu cầu" : "Muse báo lỗi";
          moveRun(this.db, run.id, "waiting", "failed", why, { error: why, doneAt: now() });
          await this.writeStatusSafe(cfg, run, STATUS.failed(why));
          return {};
        }
        await this.sleep(this.o.pollMs ?? 20_000, false);
      }
    } finally {
      this.notices.delete(batch.id);
    }

    // Bước 6: kiểm tra link (D12) và so bản chụp toàn tab.
    moveRun(this.db, run.id, "waiting", "verifying", "Ô Video đã có link, đang kiểm tra");
    const videoCell = `${cfg.colVideo}${run.rowNumber}`;
    const statusCell = `${cfg.colStatus}${run.rowNumber}`;
    let changed: string[] = [];
    if (run.tabSnapshot) {
      try {
        const after = await this.sheets.readTab(cfg.spreadsheetId, cfg.tab, "FORMULA");
        changed = unexpectedChanges(diffSnapshots(JSON.parse(run.tabSnapshot) as Grid, after), [videoCell, statusCell]).map((c) => c.cell);
      } catch (e) {
        logger.warn({ err: e, runId: run.id }, "Không chụp lại được tab để so");
      }
    }
    const link = await this.checkVideoLink(video, batch.driveFolderId);
    const fields = { videoLink: video, driveFileId: link.fileId ?? null, doneAt: now() };
    if (changed.length) {
      const msg = `Muse sửa ô khác (${changed.join(", ")})`;
      moveRun(this.db, run.id, "verifying", "needs_review", msg, { ...fields, error: msg });
      await this.writeStatusSafe(cfg, run, STATUS.otherCells(changed));
      return { pause: "other_cells" };
    }
    if (!link.ok) {
      moveRun(this.db, run.id, "verifying", "needs_review", `Link không hợp lệ: ${link.reason}`, { ...fields, error: `link không hợp lệ: ${link.reason}` });
      await this.writeStatusSafe(cfg, run, STATUS.badLink);
      return {};
    }
    moveRun(this.db, run.id, "verifying", "done", "Video đúng thư mục, không ô nào khác bị sửa", fields);
    await this.writeStatusSafe(cfg, run, STATUS.done);
    return {};
  }

  /** D12: link là file Drive, tồn tại, không trong thùng rác, là video, nằm trong thư mục của lô. */
  private async checkVideoLink(video: string, folderId: string): Promise<{ ok: true; fileId: string } | { ok: false; reason: string; fileId?: string }> {
    const link = parseDriveLink(video);
    if (link?.kind !== "file") return { ok: false, reason: "không phải link file Google Drive" };
    try {
      const f = await this.drive.getFile(link.id);
      if (f.trashed) return { ok: false, reason: "file nằm trong thùng rác", fileId: f.id };
      if (!f.mimeType.startsWith("video/")) return { ok: false, reason: `file không phải video (${f.mimeType})`, fileId: f.id };
      if (!(f.parents ?? []).includes(folderId)) return { ok: false, reason: "file không nằm trong thư mục đã chọn", fileId: f.id };
      return { ok: true, fileId: f.id };
    } catch (e) {
      if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
        return { ok: false, reason: "file không tồn tại hoặc service account không xem được", fileId: link.id };
      }
      return { ok: false, reason: `không kiểm tra được file (${errText(e)})`, fileId: link.id };
    }
  }

  private async writeStatusSafe(cfg: SheetConfig, run: RunRow, text: string): Promise<void> {
    try {
      await this.sheets.writeStatus(cfg, run.rowNumber, text);
    } catch (e) {
      logger.warn({ err: e, runId: run.id }, "Không ghi được ô Trạng thái");
      logRunEvent(this.db, run.id, this.state(run.id), `Không ghi được ô Trạng thái "${text}": ${errText(e)}`);
    }
  }

  private timeoutMs() {
    return getSettings(this.db).timeoutMinutes * (this.o.minuteMs ?? 60_000);
  }

  private pauseMs() {
    const s = getSettings(this.db);
    const sec = s.pauseMinSec + (this.o.random ?? Math.random)() * Math.max(0, s.pauseMaxSec - s.pauseMinSec);
    return sec * (this.o.secondMs ?? 1000);
  }

  /** Ngủ; `wakeOnPause` thì bấm Tạm dừng sẽ đánh thức ngay. */
  private sleep(ms: number, wakeOnPause = true): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      const active = this.active;
      function done() {
        clearTimeout(t);
        if (active && active.wake === done) active.wake = undefined;
        resolve();
      }
      if (wakeOnPause && active) active.wake = done;
    });
  }

  private batch(id: number): BatchRow | undefined {
    return this.db.prepare("SELECT id, spreadsheetId, tab, driveFolderId, status, pauseReason FROM batches WHERE id = ?").get(id) as BatchRow | undefined;
  }

  private runs(batchId: number, states: string[]): RunRow[] {
    return this.db
      .prepare(
        `SELECT id, batchId, rowNumber, state, inputSnapshot, requestText, overwrite, sentAt, tabSnapshot FROM runs
         WHERE batchId = ? AND state IN (${states.map(() => "?").join(", ")}) ORDER BY rowNumber`,
      )
      .all(batchId, ...states) as RunRow[];
  }

  private state(runId: number): string {
    return (this.db.prepare("SELECT state FROM runs WHERE id = ?").get(runId) as { state: string }).state;
  }

  private setBatch(id: number, status: string, pauseReason: PauseReason | null): void {
    this.db.prepare("UPDATE batches SET status = ?, pauseReason = ? WHERE id = ?").run(status, pauseReason, id);
    logger.info({ batchId: id, status, pauseReason }, "Trạng thái lô");
  }
}

function pick(row: string[], cfg: SheetConfig): InputSnapshot {
  const get = (col: string) => (row[columnIndex(col)] ?? "").trim();
  return { image: get(cfg.colImage), prompt: get(cfg.colPrompt), video: get(cfg.colVideo), status: get(cfg.colStatus) };
}

function now(): string {
  return new Date().toISOString();
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
