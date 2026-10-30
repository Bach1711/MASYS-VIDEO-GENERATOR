import { formatBytes, type BangFiles } from "../bang/files.js";
import { getRow, setRowVideo } from "../bang/rows.js";
import { BotError, type WatchResult } from "../bot/museBot.js";
import { chat as chatSel } from "../bot/museSelectors.js";
import type { DB } from "../db/index.js";
import { getDailyQuota } from "../db/quota.js";
import { logRunEvent, moveRun } from "../db/runs.js";
import { getSettings, setMuseReady } from "../db/settings.js";
import { getSheetConfig, type SheetConfig } from "../db/sheetConfigs.js";
import { toolWrittenCells } from "../db/sheetEdits.js";
import { columnIndex } from "../google/a1.js";
import { parseDriveLink, type DriveClient } from "../google/drive.js";
import { GoogleApiError } from "../google/http.js";
import type { Grid, SheetsClient } from "../google/sheets.js";
import { diffSnapshots, unexpectedChanges } from "../google/snapshot.js";
import { logger } from "../logger.js";
import { isRunningStatus, STATUS_RUNNING } from "../scan/labels.js";

// Hàng đợi chạy lô (spec F5, §7, D7, D9, D11, D12, D13, D28). Mỗi lúc chỉ một lô chạy. Lô theo sheet chạy tuần tự;
// lô của Bảng gửi lần lượt từng dòng và chờ tối đa N video cùng lúc, mỗi dòng một tab riêng (D28).

/** Phần của bot mà hàng đợi dùng (MuseBot thật hoặc bản giả trong test). */
export interface MuseDriver {
  readonly isOpen: boolean;
  open(): Promise<void>;
  /**
   * `files`: ảnh đính kèm theo đúng thứ tự (Bảng mới); bot chỉ bấm Gửi khi Muse hiện đủ ảnh.
   * `tab`: tab riêng của lượt (Bảng, D28); không có = trang làm việc chung (lô theo sheet).
   */
  send(text: string, files?: string[], tab?: string): Promise<{ chatUrl: string }>;
  watch(tab?: string): Promise<WatchResult>;
  /** Mở lại cuộc trò chuyện đã gửi để theo dõi tiếp (không gửi gì). */
  openChat(url: string, tab?: string): Promise<void>;
  /** Tải video mới nhất trong cuộc trò chuyện đang mở (Bảng mới, spec 17.5 bước 6). */
  downloadVideo(tab?: string): Promise<{ data: Uint8Array; count: number }>;
  /** Đóng tab riêng của một lượt đã xong. */
  closeTab?(tab: string): Promise<void>;
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
  /** Ảnh của Bảng mới trên máy (CON-52). */
  bangFiles?: Pick<BangFiles, "imagePath" | "saveVideo" | "removeVideo">;
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
  museChatUrl: string | null;
}

interface BatchRow {
  id: number;
  spreadsheetId: string;
  tab: string;
  driveFolderId: string;
  status: string;
  pauseReason: string | null;
  /** 'sheet' (Bảng theo sheet) hoặc 'bang' (Bảng mới, CON-52). */
  source: string;
}

/** Lượt của Bảng mới (spec 17.5): ảnh đính kèm (tên file, đúng thứ tự) và prompt lúc bấm Tạo video. */
export interface BangSnapshot {
  attachments: string[];
  prompt: string;
}

/** Cách chạy một lượt của lô theo sheet (F5). */
interface Flow {
  process(run: RunRow): Promise<Outcome>;
  /** Lượt đã gửi trước khi tool tắt: chỉ theo dõi tiếp, không gửi lại (D9). */
  resume(run: RunRow): Promise<Outcome>;
}

/** Một dòng của Bảng đã gửi Muse và đang chờ video trong tab riêng (D28). */
interface Inflight {
  run: RunRow;
  tab: string;
  deadline: number;
  approval: boolean;
  loginNoted: boolean;
}

/** Kết quả một lần xem tab của một dòng đang chờ. */
interface PollOutcome {
  /** Dòng đã xong (tải xong, Cần xem, lỗi): bỏ khỏi danh sách đang chờ, đóng tab. */
  finished: boolean;
  /** Ngừng gửi dòng mới (Muse hết lượt). */
  pause?: PauseReason;
}

interface InputSnapshot {
  image: string;
  /** Không có ở lượt tạo trước v1.1.0 (CON-46): khi đó bỏ qua việc so ảnh áo. */
  shirt?: string;
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
  private active?: {
    batchId: number;
    /** "watch": tool vừa mở lại, chỉ chờ nốt các dòng đã gửi; "full": chạy cả các dòng còn lại. */
    mode: "full" | "watch";
    pauseRequested: boolean;
    cancelRequested: boolean;
    wake?: () => void;
    promise: Promise<void>;
  };
  /** Thông báo đang diễn ra của lô (ví dụ Muse đang chờ duyệt), hiện trên trang lô. */
  readonly notices = new Map<number, string>();

  constructor(
    private readonly db: DB,
    private readonly sheets: SheetsClient | undefined,
    private readonly drive: DriveClient | undefined,
    private readonly bot: MuseDriver,
    private readonly o: RunnerOptions = {},
  ) {}

  /** Google chỉ cần cho lô theo sheet; lô của Bảng mới chạy được khi chưa nạp khoá. */
  private get gs(): SheetsClient {
    if (!this.sheets) throw new Error("Chưa nạp khoá Google");
    return this.sheets;
  }

  private get gd(): DriveClient {
    if (!this.drive) throw new Error("Chưa nạp khoá Google");
    return this.drive;
  }

  get runningBatchId(): number | undefined {
    return this.active?.batchId;
  }

  /** Chờ lô đang chạy dừng hẳn (dùng trong test và khi tắt tool). */
  async idle(): Promise<void> {
    await this.active?.promise;
  }

  /** Bắt đầu hoặc Tiếp tục một lô. Lượt đã gửi Muse không bao giờ được gửi lại (D9). */
  start(batchId: number): { ok: true } | { ok: false; message: string } {
    const b = this.batch(batchId);
    // Tool vừa mở lại và đang chờ nốt video đã gửi của chính lô này (Bảng): Tiếp tục thì gửi luôn các dòng còn lại.
    const upgrade = this.active?.batchId === batchId && this.active.mode === "watch" && b?.source === "bang" && b.status === "paused";
    if (this.active && !upgrade) return { ok: false, message: `Đang chạy lô #${this.active.batchId}. Mỗi lúc chỉ chạy một lô.` };
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
    if (upgrade) {
      this.active!.mode = "full";
      this.active!.pauseRequested = false;
      this.active!.wake?.();
    } else this.launch(batchId, "full");
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
      const sent = this.runs(id, ["sending", "waiting", "verifying", "downloading"]);
      if (sent.length && !this.active) this.launch(id, "watch");
      logger.info({ batchId: id, inflight: sent.map((r) => r.rowNumber) }, "Khôi phục lô sau khi tool mở lại");
    }
  }

  private launch(batchId: number, mode: "full" | "watch") {
    const active = { batchId, mode, pauseRequested: false, cancelRequested: false, wake: undefined as (() => void) | undefined, promise: Promise.resolve() };
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

  private flowFor(batch: BatchRow): Flow | { pause: PauseReason } {
    const cfg = getSheetConfig(this.db, batch.spreadsheetId, batch.tab);
    if (!cfg || !this.sheets || !this.drive) return { pause: "google" };
    return {
      process: (r) => this.processRun(r, cfg, batch),
      resume: (r) => {
        if (r.state !== "waiting") moveRun(this.db, r.id, r.state, "waiting", "Tool mở lại: theo dõi tiếp ô Video, không gửi lại (D9)");
        else logRunEvent(this.db, r.id, "waiting", "Tool mở lại: theo dõi tiếp ô Video, không gửi lại (D9)");
        return this.watchAndVerify(r, cfg, batch, Date.now() + this.timeoutMs());
      },
    };
  }

  private async loop(batchId: number, mode: "full" | "watch"): Promise<void> {
    const batch = this.batch(batchId)!;
    if (batch.source === "bang") return this.loopBang(batch);
    const flow = this.flowFor(batch);
    if ("pause" in flow) return this.setBatch(batchId, "paused", flow.pause);

    // Lượt đã gửi trước khi tool tắt: chỉ theo dõi tiếp, một chu kỳ chờ tính từ bây giờ.
    for (const r of this.runs(batchId, ["sending", "waiting", "verifying", "downloading"])) {
      const out = await flow.resume(r);
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
      const out = await flow.process(next);
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
      current = pick(await this.gs.readRow(cfg.spreadsheetId, cfg.tab, run.rowNumber), cfg);
    } catch (e) {
      moveRun(this.db, run.id, "checking_row", "queued", `Không đọc được sheet: ${errText(e)}`);
      return { pause: "google" };
    }
    const shirtChanged = snap.shirt !== undefined && current.shirt !== snap.shirt;
    if (current.image !== snap.image || current.prompt !== snap.prompt || shirtChanged) {
      // Không ghi sheet: dòng N giờ có thể là của sản phẩm khác.
      moveRun(this.db, run.id, "checking_row", "needs_review", "Ảnh, ảnh áo hoặc prompt dòng này khác lúc tạo lô (lệch dòng)", {
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
      before = await this.gs.readTab(cfg.spreadsheetId, cfg.tab, "FORMULA");
      await this.gs.writeStatus(cfg, run.rowNumber, STATUS.running);
    } catch (e) {
      moveRun(this.db, run.id, "checking_row", "queued", `Không chụp / ghi được sheet: ${errText(e)}`);
      return { pause: "google" };
    }

    // Bước 4: sentAt ghi trước khi bấm Gửi.
    const sentAt = now();
    moveRun(this.db, run.id, "checking_row", "sending", "Gửi yêu cầu cho Muse (cuộc trò chuyện mới)", {
      sentAt,
      tabSnapshot: JSON.stringify(before),
    });
    const sentRun = { ...run, sentAt, tabSnapshot: JSON.stringify(before) };
    try {
      const { chatUrl } = await this.bot.send(run.requestText);
      moveRun(this.db, run.id, "sending", "waiting", "Đã gửi Muse, theo dõi ô Video", { museChatUrl: chatUrl });
      setMuseReady(this.db, now());
    } catch (e) {
      const err = e instanceof BotError ? e : new BotError("send_unconfirmed", `Lỗi khi gửi: ${errText(e)}`, true);
      if (!err.sent) {
        // Chưa gửi: trả ô Trạng thái như cũ, không tính vào giới hạn ngày.
        await this.writeStatusSafe(cfg, run, snap.status);
        const to = err.code === "login" || err.code === "challenge" ? "paused_login" : "paused_ui";
        moveRun(this.db, run.id, "sending", to, `Chưa gửi: ${err.message}`, { sentAt: null }, err.screenshot);
        if (to === "paused_login") setMuseReady(this.db, null);
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
          const cur = pick(await this.gs.readRow(cfg.spreadsheetId, cfg.tab, run.rowNumber), cfg);
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
        const after = await this.gs.readTab(cfg.spreadsheetId, cfg.tab, "FORMULA");
        // Ô người dùng sửa trên Bảng trong lúc chờ (D18) không phải Muse sửa: bỏ qua nếu ô còn đúng giá trị tool đã ghi.
        // Tính từ trước lúc gửi một khoảng để gồm cả lần sửa giữa lúc chụp tab và lúc gửi.
        const since = new Date(Date.parse(run.sentAt ?? now()) - TOOL_EDIT_MARGIN_MS).toISOString();
        const mine = toolWrittenCells(this.db, cfg.spreadsheetId, cfg.tab, since);
        changed = unexpectedChanges(diffSnapshots(JSON.parse(run.tabSnapshot) as Grid, after), [videoCell, statusCell])
          .filter((c) => mine.get(c.cell) !== c.after)
          .map((c) => c.cell);
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

  /**
   * Lô của Bảng (spec 17.5, D28): gửi lần lượt từng dòng, mỗi dòng một cuộc trò chuyện mới trong tab riêng, chờ tối đa
   * N video cùng lúc. Mỗi vòng: xem từng tab đang chờ (xong thì tải về, đóng tab), rồi gửi thêm dòng nếu còn chỗ và đã
   * nghỉ đủ giữa hai lần gửi. Tạm dừng / Huỷ / Muse cần đăng nhập, hết lượt…: ngừng gửi dòng mới, vẫn chờ nốt các dòng
   * đã gửi rồi mới dừng lô. Không bao giờ gửi lại một dòng đã gửi (D9).
   */
  private async loopBang(batch: BatchRow): Promise<void> {
    const inflight = new Map<number, Inflight>();
    const pollMs = this.o.pollMs ?? 20_000;

    // Dòng đã gửi trước khi tool tắt: mở lại đúng cuộc trò chuyện trong tab riêng, chờ tiếp, không gửi lại.
    for (const r of this.runs(batch.id, ["sending", "waiting", "verifying", "downloading"])) {
      const msg = "Tool mở lại: theo dõi tiếp cuộc trò chuyện Muse, không gửi lại (D9)";
      if (!chatSel.isThreadUrl(r.museChatUrl)) {
        moveRun(this.db, r.id, r.state, "needs_review", "Tool tắt lúc đang gửi nên không biết cuộc trò chuyện Muse; không gửi lại (D9)", {
          error: "không rõ đã gửi chưa",
          doneAt: now(),
        });
        continue;
      }
      if (r.state !== "waiting") moveRun(this.db, r.id, r.state, "waiting", msg);
      else logRunEvent(this.db, r.id, "waiting", msg);
      const f: Inflight = { run: { ...r, state: "waiting" }, tab: tabOf(r.id), deadline: Date.now() + this.timeoutMs(), approval: false, loginNoted: false };
      inflight.set(r.id, f);
      await this.reopenChat(r.museChatUrl!, f.tab);
    }

    let blocked: PauseReason | undefined;
    let nextSendAt = 0;
    try {
      for (;;) {
        for (const f of [...inflight.values()]) {
          const out = await this.pollBang(f);
          if (out.pause) blocked ??= out.pause;
          if (out.finished) {
            inflight.delete(f.run.id);
            await this.bot.closeTab?.(f.tab).catch(() => {});
          }
        }

        const sending = this.active?.mode === "full" && !this.stopRequested() && !blocked;
        const room = inflight.size < this.parallel();
        const next = sending && room ? this.runs(batch.id, ["queued"])[0] : undefined;
        if (next && Date.now() >= nextSendAt) {
          const out = await this.sendBang(next);
          if (out.pause) blocked = out.pause;
          if (out.inflight) inflight.set(next.id, out.inflight);
          // Nghỉ ngẫu nhiên giữa hai lần gửi (D7).
          if (out.sent) nextSendAt = Date.now() + this.pauseMs();
          continue;
        }

        if (inflight.size === 0) {
          if (blocked) return this.setBatch(batch.id, "paused", blocked);
          if (this.stopRequested()) return this.setBatch(batch.id, "paused", "user");
          if (this.active?.mode !== "full") return; // Tool vừa mở lại: lô vẫn Tạm dừng, chờ người dùng bấm Tiếp tục.
          if (!this.runs(batch.id, ["queued"]).length) return this.setBatch(batch.id, "done", null);
        }

        this.noticeBang(batch, inflight, blocked);
        const untilSend = next ? Math.max(0, nextSendAt - Date.now()) : Infinity;
        const wait = Math.min(inflight.size ? pollMs : Infinity, untilSend);
        await this.sleep(wait === Infinity ? pollMs : wait);
      }
    } finally {
      this.notices.delete(batch.id);
    }
  }

  /** Số video chờ cùng lúc (D28), đọc lại mỗi vòng để đổi ở Cài đặt có tác dụng ngay. */
  private parallel(): number {
    return Math.min(6, Math.max(1, getSettings(this.db).parallelVideos || 1));
  }

  /** Dải báo trên trang lô: Muse chờ duyệt, hoặc lý do ngừng gửi dòng mới trong lúc còn chờ video đã gửi. */
  private noticeBang(batch: BatchRow, inflight: Map<number, Inflight>, blocked: PauseReason | undefined): void {
    const asking = [...inflight.values()].filter((f) => f.approval).map((f) => f.run.rowNumber);
    if (asking.length) {
      this.notices.set(batch.id, `Muse đang chờ bạn duyệt (dòng ${asking.join(", ")} của Bảng). Mở cửa sổ bot và bấm duyệt trong Muse; bot không tự bấm.`);
    } else if (inflight.size && (blocked || this.stopRequested())) {
      const why = blocked ? PAUSE_SHORT[blocked] : this.active?.cancelRequested ? "Bạn đã bấm Huỷ" : PAUSE_SHORT.user;
      this.notices.set(batch.id, `Ngừng gửi dòng mới (${why}); vẫn chờ và tải nốt ${inflight.size} video đã gửi.`);
    } else this.notices.delete(batch.id);
  }

  /** Spec 17.5 bước 1–4 (Bảng): đọc lại dòng, mở cuộc trò chuyện mới trong tab riêng, đính kèm ảnh, gửi. */
  private async sendBang(run: RunRow): Promise<{ pause?: PauseReason; sent?: boolean; inflight?: Inflight }> {
    const snap = JSON.parse(run.inputSnapshot) as BangSnapshot;
    if (getDailyQuota(this.db).remaining <= 0) {
      moveRun(this.db, run.id, "queued", "paused_limit", "Đủ giới hạn video hôm nay (D25)");
      return { pause: "limit" };
    }

    // Bước 1: đọc lại dòng trên Bảng mới; còn đủ file ảnh trên máy.
    moveRun(this.db, run.id, "queued", "checking_row", "Đọc lại dòng trên Bảng mới");
    const review = (why: string, error: string) => {
      moveRun(this.db, run.id, "checking_row", "needs_review", `${why}; không gửi Muse`, { error, doneAt: now() });
      return {};
    };
    const row = getRow(this.db, run.rowNumber);
    if (!row) return review("Dòng đã bị xoá khỏi Bảng mới", "dòng đã bị xoá");
    const current = [row.modelFront, row.shirtFront, row.modelBack, row.shirtBack].filter((x): x is string => !!x);
    if (current.join("|") !== snap.attachments.join("|") || row.prompt.trim() !== snap.prompt) {
      return review("Ảnh hoặc prompt dòng này đã đổi sau lúc bấm Tạo video", "dữ liệu dòng đã đổi");
    }
    const files = snap.attachments.map((n) => this.o.bangFiles?.imagePath(n));
    if (files.some((f) => !f)) return review("Không còn file ảnh của dòng này trên máy", "thiếu file ảnh");

    // Bước 2–4: sentAt ghi trước khi bấm Gửi; bot mở cuộc trò chuyện mới trong tab riêng, đính kèm ảnh, chỉ gửi khi Muse hiện đủ ảnh.
    if (!this.bot.isOpen) await this.bot.open();
    const tab = tabOf(run.id);
    const waiting = (): Inflight => ({ run: { ...run, state: "waiting" }, tab, deadline: Date.now() + this.timeoutMs(), approval: false, loginNoted: false });
    moveRun(this.db, run.id, "checking_row", "sending", `Gửi yêu cầu cho Muse kèm ${files.length} ảnh (cuộc trò chuyện mới)`, { sentAt: now() });
    try {
      const { chatUrl } = await this.bot.send(run.requestText, files as string[], tab);
      const known = chatSel.isThreadUrl(chatUrl);
      moveRun(
        this.db,
        run.id,
        "sending",
        "waiting",
        known ? "Đã gửi Muse, chờ video trong cuộc trò chuyện" : "Đã gửi Muse, chờ video; Muse chưa đổi sang link riêng của cuộc trò chuyện",
        { museChatUrl: known ? chatUrl : null },
      );
      setMuseReady(this.db, now());
    } catch (e) {
      const err = e instanceof BotError ? e : new BotError("send_unconfirmed", `Lỗi khi gửi: ${errText(e)}`, true);
      if (!err.sent) {
        const to = err.code === "login" || err.code === "challenge" ? "paused_login" : "paused_ui";
        moveRun(this.db, run.id, "sending", to, `Chưa gửi: ${err.message}`, { sentAt: null }, err.screenshot);
        if (to === "paused_login") setMuseReady(this.db, null);
        await this.bot.bringToFront();
        return { pause: to === "paused_login" ? "login" : "ui" };
      }
      await this.bot.closeTab?.(tab).catch(() => {});
      if (err.code === "quota") {
        moveRun(this.db, run.id, "sending", "paused_quota", err.message, { error: "Muse hết lượt" }, err.screenshot);
        return { pause: "quota", sent: true };
      }
      if (err.code === "rejected" || err.code === "muse_error") {
        moveRun(this.db, run.id, "sending", "failed", err.message, { error: err.message, doneAt: now() }, err.screenshot);
        return { sent: true };
      }
      // Không chắc Muse đã nhận: không gửi lại, vẫn chờ video trên trang đến hết giờ.
      moveRun(this.db, run.id, "sending", "waiting", `${err.message}. Không gửi lại; vẫn chờ video trong cuộc trò chuyện`, {}, err.screenshot);
    }
    return { sent: true, inflight: waiting() };
  }

  private async reopenChat(url: string, tab?: string): Promise<boolean> {
    try {
      if (!this.bot.isOpen) await this.bot.open();
      await this.bot.openChat(url, tab);
      return true;
    } catch (e) {
      logger.warn({ err: e }, "Không mở lại được cuộc trò chuyện Muse");
      return false;
    }
  }

  /**
   * Spec 17.5 bước 6–8 (D23): tải video về máy, kiểm tra là MP4, gắn vào dòng. Thử 3 lần (video có thể đang nạp);
   * không được thì Cần xem, giữ link cuộc trò chuyện để người dùng tải tay, không gửi lại (D9).
   */
  private async downloadBang(run: RunRow, tab: string): Promise<void> {
    moveRun(this.db, run.id, "waiting", "downloading", "Muse đã gửi video trong cuộc trò chuyện; đang tải về máy");
    let why = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data, count } = await this.bot.downloadVideo(tab);
        const files = this.o.bangFiles;
        if (!files) throw new Error("thiếu thư mục dữ liệu");
        const name = files.saveVideo(run.rowNumber, data);
        const old = setRowVideo(this.db, run.rowNumber, name, data.length);
        if (old && old !== name) files.removeVideo(old);
        const note = count > 1 ? `; cuộc trò chuyện có ${count} video, lấy video mới nhất` : "";
        moveRun(this.db, run.id, "downloading", "done", `Đã tải video về máy (${formatBytes(data.length)})${note}`, { doneAt: now() });
        return;
      } catch (e) {
        why = errText(e);
        logger.warn({ err: e, runId: run.id, attempt }, "Chưa tải được video từ Muse");
        if (attempt < 3) await this.sleep(5 * (this.o.secondMs ?? 1000), false);
      }
    }
    moveRun(this.db, run.id, "downloading", "needs_review", `Không tải được video (${why}). Bấm "Mở trong Muse" để tải tay; không gửi lại (D9)`, {
      error: "không tải được video",
      doneAt: now(),
    });
  }

  /** Spec 17.5 bước 5 (Bảng): xem tab của một dòng đang chờ một lần; có video thì tải về (bước 6–8). */
  private async pollBang(f: Inflight): Promise<PollOutcome> {
    const run = f.run;
    const w = await this.bot.watch(f.tab).catch(() => ({ closed: true, login: false, approval: false }) as WatchResult);
    // Muse đổi /thread/new sang link riêng chậm: lấy link ngay khi thấy, để mở lại được khi tool tắt giữa chừng.
    if (chatSel.isThreadUrl(w.url) && !chatSel.isThreadUrl(this.chatUrl(run.id))) {
      this.db.prepare("UPDATE runs SET museChatUrl = ? WHERE id = ?").run(w.url, run.id);
      logRunEvent(this.db, run.id, "waiting", "Đã có link cuộc trò chuyện Muse");
    }
    if ((w.videos ?? 0) > 0) {
      await this.downloadBang(run, f.tab);
      return { finished: true };
    }
    if (Date.now() >= f.deadline) {
      moveRun(this.db, run.id, "waiting", "needs_review", "Quá thời gian chờ mà Muse chưa gửi video; không gửi lại (D9)", {
        error: "quá thời gian",
        doneAt: now(),
      });
      return { finished: true };
    }
    if (w.closed) {
      // Trình duyệt bot hoặc tab của dòng bị tắt: mở lại đúng cuộc trò chuyện để xem tiếp.
      const url = this.chatUrl(run.id);
      if (chatSel.isThreadUrl(url)) await this.reopenChat(url, f.tab);
      return { finished: false };
    }
    if (w.approval !== f.approval) {
      f.approval = w.approval;
      if (w.approval) {
        logRunEvent(this.db, run.id, "waiting", "Muse đang chờ người dùng duyệt một thao tác");
        await this.bot.bringToFront();
      }
    }
    if (w.login && !f.loginNoted) {
      f.loginNoted = true;
      logRunEvent(this.db, run.id, "waiting", "Trang Muse đang hiện đăng nhập / kiểm tra bảo mật; vẫn chờ video");
    }
    if (w.notice === "quota") {
      moveRun(this.db, run.id, "waiting", "paused_quota", "Muse báo hết lượt", { error: "Muse hết lượt" });
      return { finished: true, pause: "quota" };
    }
    if (w.notice === "rejected" || w.notice === "error") {
      const why = w.notice === "rejected" ? "Muse từ chối yêu cầu" : "Muse báo lỗi";
      moveRun(this.db, run.id, "waiting", "failed", why, { error: why, doneAt: now() });
      return { finished: true };
    }
    if (w.notice === "videoMissing") {
      // Muse nói xong nhưng ô video báo "Video not found": không chờ hết giờ, không gửi lại (D9).
      moveRun(this.db, run.id, "waiting", "needs_review", "Muse báo xong nhưng video trong cuộc trò chuyện không mở được", {
        error: "video không mở được",
        doneAt: now(),
      });
      return { finished: true };
    }
    return { finished: false };
  }

  private chatUrl(runId: number): string | null {
    return (this.db.prepare("SELECT museChatUrl FROM runs WHERE id = ?").get(runId) as { museChatUrl: string | null }).museChatUrl;
  }

  /** D12: link là file Drive, tồn tại, không trong thùng rác, là video, nằm trong thư mục của lô. */
  private async checkVideoLink(video: string, folderId: string): Promise<{ ok: true; fileId: string } | { ok: false; reason: string; fileId?: string }> {
    const link = parseDriveLink(video);
    if (link?.kind !== "file") return { ok: false, reason: "không phải link file Google Drive" };
    try {
      const f = await this.gd.getFile(link.id);
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
      await this.gs.writeStatus(cfg, run.rowNumber, text);
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
    return this.db.prepare("SELECT id, spreadsheetId, tab, driveFolderId, status, pauseReason, source FROM batches WHERE id = ?").get(id) as BatchRow | undefined;
  }

  private runs(batchId: number, states: string[]): RunRow[] {
    return this.db
      .prepare(
        `SELECT id, batchId, rowNumber, state, inputSnapshot, requestText, overwrite, sentAt, tabSnapshot, museChatUrl FROM runs
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
  return {
    image: get(cfg.colImage),
    shirt: cfg.colShirt ? get(cfg.colShirt) : "",
    prompt: get(cfg.colPrompt),
    video: get(cfg.colVideo),
    status: get(cfg.colStatus),
  };
}

/** Ô tool ghi theo yêu cầu người dùng trong khoảng này trước lúc gửi vẫn được tính (tab được chụp trước rồi mới gửi). */
const TOOL_EDIT_MARGIN_MS = 10 * 60_000;

/** Tab riêng của một lượt trong cửa sổ bot (D28). */
const tabOf = (runId: number) => `run-${runId}`;

function now(): string {
  return new Date().toISOString();
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
