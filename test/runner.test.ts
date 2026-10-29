import { describe, expect, it } from "vitest";
import { FAKE_KEY_ENV } from "./fakeKey.js";
import { BotError, type WatchResult } from "../src/bot/museBot.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { saveSheetConfig, type SheetConfig } from "../src/db/sheetConfigs.js";
import { recordSheetEdits } from "../src/db/sheetEdits.js";
import { getSettings } from "../src/db/settings.js";
import { columnIndex } from "../src/google/a1.js";
import type { DriveClient, DriveFile } from "../src/google/drive.js";
import { GoogleApiError } from "../src/google/http.js";
import type { Grid, SheetsClient } from "../src/google/sheets.js";
import { BatchRunner, STATUS, type MuseDriver } from "../src/queue/runner.js";

const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const TAB = "Trang tính1";
const FOLDER = "1ktAlBSjKy-C_uZfgBnTe_yWcmIShHLSI";
const OTHER_FOLDER = "1OTHERfolderxxxxxxxxxxxxxxxx";
const CFG: SheetConfig = { spreadsheetId: ID, tab: TAB, headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" };
const img = (n: number) => `https://drive.google.com/file/d/image000${n}xx/view`;
const vid = (n: number) => `https://drive.google.com/file/d/video000${n}xx/view?usp=drivesdk`;

/** Sheet 10 dòng: A ảnh, B prompt, C video, D trạng thái, E ghi chú (để phát hiện sửa nhầm ô). */
function makeGrid(): Grid {
  const g: Grid = [["Ảnh", "Prompt", "Video", "Trạng Thái", "Ghi chú"]];
  for (let r = 2; r <= 10; r++) g.push([img(r), `prompt ${r}`, "", "", `ghi chú ${r}`]);
  return g;
}

type MuseBehavior = (row: number, text: string) => void | Promise<void>;

function setup(opts: { muse?: MuseBehavior; timeoutMinutes?: number; sentToday?: number } = {}) {
  const grid = makeGrid();
  const writes: string[] = [];
  const set = (cell: string, value: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(cell)!;
    const r = Number(m[2]) - 1;
    const c = columnIndex(m[1]!);
    while (grid.length <= r) grid.push([]);
    const row = grid[r]!;
    while (row.length <= c) row.push("");
    row[c] = value;
  };
  const sheets = {
    readRow: async (_i: string, _t: string, row: number) => [...(grid[row - 1] ?? [])],
    readTab: async () => grid.map((r) => [...r]),
    writeStatus: async (cfg: SheetConfig, row: number, text: string) => {
      writes.push(`${cfg.colStatus}${row}=${text}`);
      set(`${cfg.colStatus}${row}`, text);
    },
  } as unknown as SheetsClient;

  const files = new Map<string, DriveFile>();
  for (let n = 2; n <= 10; n++) files.set(`video000${n}xx`, { id: `video000${n}xx`, name: `v${n}.mp4`, mimeType: "video/mp4", trashed: false, parents: [FOLDER] });
  const drive = {
    getFile: async (id: string) => {
      const f = files.get(id);
      if (!f) throw new GoogleApiError(404, "File not found");
      return f;
    },
  } as unknown as DriveClient;

  const sent: { row: number; text: string }[] = [];
  let sending = 0;
  let maxConcurrent = 0;
  const watchState: WatchResult = { closed: false, login: false, approval: false };
  const sendErrors: (BotError | undefined)[] = [];
  let fronts = 0;
  // Muse giả: sau khi nhận yêu cầu thì "làm video" rồi dán link vào ô Video của dòng.
  const muse: MuseBehavior =
    opts.muse ??
    ((row) => {
      setTimeout(() => set(`C${row}`, vid(row)), 15);
    });
  const bot: MuseDriver & { opened: number } = {
    isOpen: false,
    opened: 0,
    async open() {
      this.opened++;
      (this as { isOpen: boolean }).isOpen = true;
    },
    async send(text: string) {
      sending++;
      maxConcurrent = Math.max(maxConcurrent, sending);
      try {
        const err = sendErrors.shift();
        if (err) throw err;
        const row = Number(/ô C(\d+)/.exec(text)![1]);
        sent.push({ row, text });
        await muse(row, text);
        return { chatUrl: `https://muse.ai/thread/t${row}abc` };
      } finally {
        sending--;
      }
    },
    async watch() {
      return { ...watchState };
    },
    async bringToFront() {
      fronts++;
    },
  };

  const db = openDatabase(":memory:");


  db.prepare("UPDATE settings SET dailyVideoLimit = 5").run(); // các ca giới hạn ngày viết theo mức 5 cũ (D13)
  saveSheetConfig(db, CFG);
  db.prepare("UPDATE settings SET timeoutMinutes = ? WHERE id = 1").run(opts.timeoutMinutes ?? 20);
  if (opts.sentToday) {
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (900, 'X', 'Y', 'F', 'done')").run();
    for (let i = 0; i < opts.sentToday; i++) {
      db.prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, state, sentAt) VALUES (900, 2, '{}', 'done', ?)").run(new Date().toISOString());
    }
  }
  // 1 phút = 50 ms, 1 giây = 1 ms (nghỉ 20–60 "giây" = 20–60 ms), đọc ô Video mỗi 5 ms.
  const newRunner = () => new BatchRunner(db, sheets, drive, bot, { pollMs: 5, minuteMs: 50, secondMs: 1, random: () => 0 });
  return {
    db,
    grid,
    set,
    writes,
    files,
    sent,
    sendErrors,
    watchState,
    bot,
    runner: newRunner(),
    newRunner,
    get maxConcurrent() {
      return maxConcurrent;
    },
    get fronts() {
      return fronts;
    },
  };
}

function createBatch(db: DB, grid: Grid, rows: number[], overwrite: number[] = []): number {
  const { lastInsertRowid } = db.prepare("INSERT INTO batches (spreadsheetId, tab, driveFolderId, status) VALUES (?, ?, ?, 'queued')").run(ID, TAB, FOLDER);
  const batchId = Number(lastInsertRowid);
  for (const r of rows) {
    const cells = grid[r - 1]!;
    const snap = { image: cells[0], prompt: cells[1], video: cells[2] ?? "", status: cells[3] ?? "" };
    db.prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, promptSent, requestText, overwrite, state) VALUES (?, ?, ?, ?, ?, ?, 'queued')").run(
      batchId,
      r,
      JSON.stringify(snap),
      cells[1],
      `Ảnh: ${cells[0]}\nPrompt: ${cells[1]}\nDán link vào ô C${r}. Chỉ sửa đúng ô C${r}.`,
      overwrite.includes(r) ? 1 : 0,
    );
  }
  return batchId;
}

const runsOf = (db: DB, batchId: number) =>
  db.prepare("SELECT rowNumber, state, error, sentAt, videoLink, driveFileId, museChatUrl FROM runs WHERE batchId = ? ORDER BY rowNumber").all(batchId) as {
    rowNumber: number;
    state: string;
    error: string | null;
    sentAt: string | null;
    videoLink: string | null;
    driveFileId: string | null;
    museChatUrl: string | null;
  }[];
const batchOf = (db: DB, id: number) => db.prepare("SELECT status, pauseReason FROM batches WHERE id = ?").get(id) as { status: string; pauseReason: string | null };
const statesOf = (db: DB, id: number) => runsOf(db, id).map((r) => [r.rowNumber, r.state]);

describe("hàng đợi chạy lô (F5, §7)", () => {
  it("§12.2 + §12.3: lô 2, 4, 7-9 chạy tuần tự, mỗi dòng một lần gửi, link đúng ô, Trạng thái Xong, không ô nào khác bị đổi", async () => {
    const t = setup();
    const before = t.grid.map((r) => [...r]);
    const id = createBatch(t.db, t.grid, [2, 4, 7, 8, 9]);
    expect(t.runner.start(id)).toEqual({ ok: true });
    expect(t.runner.start(id)).toMatchObject({ ok: false });
    await t.runner.idle();

    expect(batchOf(t.db, id)).toEqual({ status: "done", pauseReason: null });
    expect(t.sent.map((s) => s.row)).toEqual([2, 4, 7, 8, 9]);
    expect(t.maxConcurrent).toBe(1);
    expect(t.bot.opened).toBe(1);
    for (const r of runsOf(t.db, id)) {
      expect(r).toMatchObject({ state: "done", videoLink: vid(r.rowNumber), driveFileId: `video000${r.rowNumber}xx`, museChatUrl: `https://muse.ai/thread/t${r.rowNumber}abc` });
      expect(r.sentAt).toBeTruthy();
    }
    // Tool chỉ ghi ô Trạng thái của đúng dòng: Đang chạy rồi Xong.
    expect(t.writes).toEqual([2, 4, 7, 8, 9].flatMap((r) => [`D${r}=Đang chạy`, `D${r}=Xong`]));
    for (let r = 0; r < before.length; r++) {
      expect(t.grid[r]!.slice(0, 2), `dòng ${r + 1}`).toEqual(before[r]!.slice(0, 2));
      expect(t.grid[r]![4]).toBe(before[r]![4]);
    }
    // Mỗi lần đổi trạng thái đều có nhật ký, theo đúng vòng đời §7.
    const path = t.db
      .prepare("SELECT toState FROM run_events e JOIN runs r ON r.id = e.runId WHERE r.batchId = ? AND r.rowNumber = 2 ORDER BY e.id")
      .all(id)
      .map((e) => (e as { toState: string }).toState);
    expect(path).toEqual(["checking_row", "sending", "waiting", "verifying", "done"]);
  });

  it("gửi Muse thành công thì nhớ Muse đã đăng nhập (bước 3 bắt đầu nhanh, CON-51)", async () => {
    const t = setup();
    expect(getSettings(t.db).museReadyAt).toBeNull();
    const id = createBatch(t.db, t.grid, [2]);
    t.runner.start(id);
    await t.runner.idle();
    expect(getSettings(t.db).museReadyAt).toBeTruthy();
  });

  it("§12.5: có người dán link vào dòng 8 trước khi tới lượt → bỏ qua, không gửi Muse", async () => {
    const t = setup();
    const id = createBatch(t.db, t.grid, [7, 8, 9]);
    t.set("C8", "https://drive.google.com/file/d/tay0000000xx/view");
    t.runner.start(id);
    await t.runner.idle();
    expect(t.sent.map((s) => s.row)).toEqual([7, 9]);
    expect(statesOf(t.db, id)).toEqual([
      [7, "done"],
      [8, "skipped_has_video"],
      [9, "done"],
    ]);
    expect(t.writes.filter((w) => w.startsWith("D8"))).toEqual([]);
  });

  it("dòng Ghi đè: chờ ô Video đổi sang link mới, không coi link cũ là xong", async () => {
    const t = setup();
    t.set("C3", vid(9));
    const id = createBatch(t.db, t.grid, [3], [3]);
    t.runner.start(id);
    await t.runner.idle();
    expect(t.sent.map((s) => s.row)).toEqual([3]);
    expect(runsOf(t.db, id)[0]).toMatchObject({ state: "done", videoLink: vid(3) });
  });

  it("§12.6: hết phiên Muse giữa lô → tạm dừng, trả ô Trạng thái; đăng nhập lại + Tiếp tục → chạy tiếp, không gửi lại dòng đã gửi", async () => {
    const t = setup();
    const id = createBatch(t.db, t.grid, [2, 3, 4]);
    t.sendErrors.push(undefined, new BotError("login", "Cần đăng nhập Muse", false));
    t.runner.start(id);
    await t.runner.idle();
    expect(batchOf(t.db, id)).toEqual({ status: "paused", pauseReason: "login" });
    expect(statesOf(t.db, id)).toEqual([
      [2, "done"],
      [3, "paused_login"],
      [4, "queued"],
    ]);
    expect(runsOf(t.db, id)[1]!.sentAt).toBeNull();
    expect(t.grid[2]![3]).toBe(""); // D3 trả lại như cũ
    expect(t.fronts).toBeGreaterThan(0);

    expect(t.runner.start(id)).toEqual({ ok: true });
    await t.runner.idle();
    expect(batchOf(t.db, id).status).toBe("done");
    expect(t.sent.map((s) => s.row)).toEqual([2, 3, 4]);
  });

  it("§12.7: quá thời gian → Cần xem, không gửi lại, lô chạy tiếp dòng sau", async () => {
    const t = setup({ timeoutMinutes: 1, muse: (row) => void (row === 5 ? undefined : setTimeout(() => t.set(`C${row}`, vid(row)), 5)) });
    const id = createBatch(t.db, t.grid, [5, 6]);
    t.runner.start(id);
    await t.runner.idle();
    expect(statesOf(t.db, id)).toEqual([
      [5, "needs_review"],
      [6, "done"],
    ]);
    expect(runsOf(t.db, id)[0]!.error).toBe("quá thời gian");
    expect(t.grid[4]![3]).toBe(STATUS.timeout);
    expect(t.sent.map((s) => s.row)).toEqual([5, 6]);
  });

  it("§12.8: video nằm ở thư mục khác → Cần xem: link không hợp lệ (giữ nguyên link)", async () => {
    const t = setup();
    t.files.set("video0006xx", { id: "video0006xx", name: "v6.mp4", mimeType: "video/mp4", trashed: false, parents: [OTHER_FOLDER] });
    const id = createBatch(t.db, t.grid, [6, 7]);
    t.runner.start(id);
    await t.runner.idle();
    expect(runsOf(t.db, id)[0]).toMatchObject({ state: "needs_review", videoLink: vid(6), error: "link không hợp lệ: file không nằm trong thư mục đã chọn" });
    expect(t.grid[5]![2]).toBe(vid(6));
    expect(t.grid[5]![3]).toBe(STATUS.badLink);
    expect(runsOf(t.db, id)[1]!.state).toBe("done");
  });

  it("link không phải Drive / không tồn tại / không phải video → Cần xem", async () => {
    const t = setup({
      muse: (row) => {
        const links: Record<number, string> = { 2: "https://example.com/video.mp4", 3: "https://drive.google.com/file/d/khongcofile00/view", 4: vid(4) };
        setTimeout(() => t.set(`C${row}`, links[row]!), 5);
      },
    });
    t.files.set("video0004xx", { id: "video0004xx", name: "a.png", mimeType: "image/png", trashed: false, parents: [FOLDER] });
    const id = createBatch(t.db, t.grid, [2, 3, 4]);
    t.runner.start(id);
    await t.runner.idle();
    expect(runsOf(t.db, id).map((r) => r.error)).toEqual([
      "link không hợp lệ: không phải link file Google Drive",
      "link không hợp lệ: file không tồn tại hoặc service account không xem được",
      "link không hợp lệ: file không phải video (image/png)",
    ]);
  });

  it("người dùng sửa ô dòng khác trên Bảng trong lúc chờ Muse (D18): không coi là Muse sửa nhầm", async () => {
    const t = setup({
      muse: (row) => {
        setTimeout(() => {
          // Tool ghi B7 theo yêu cầu người dùng (có trong nhật ký sửa), rồi Muse dán link video.
          recordSheetEdits(t.db, ID, TAB, "edit", [{ cell: "B7", row: 7, field: "prompt", oldValue: "prompt 7", newValue: "prompt 7 mới" }]);
          t.set("B7", "prompt 7 mới");
          t.set(`C${row}`, vid(row));
        }, 5);
      },
    });
    const id = createBatch(t.db, t.grid, [3]);
    t.runner.start(id);
    await t.runner.idle();
    expect(statesOf(t.db, id)).toEqual([[3, "done"]]);
  });

  it("ô tool đã ghi nhưng sau đó bị đổi sang giá trị khác: vẫn báo Muse sửa ô khác", async () => {
    const t = setup({
      muse: (row) => {
        setTimeout(() => {
          recordSheetEdits(t.db, ID, TAB, "edit", [{ cell: "B7", row: 7, field: "prompt", oldValue: "prompt 7", newValue: "prompt 7 mới" }]);
          t.set("B7", "Muse ghi đè");
          t.set(`C${row}`, vid(row));
        }, 5);
      },
    });
    const id = createBatch(t.db, t.grid, [3]);
    t.runner.start(id);
    await t.runner.idle();
    expect(runsOf(t.db, id)[0]!.error).toBe("Muse sửa ô khác (B7)");
  });

  it("§12.9: Muse sửa nhầm ô khác trong lúc chờ → Cần xem, tạm dừng lô, dòng sau chưa chạy", async () => {
    const t = setup({
      muse: (row) => {
        setTimeout(() => {
          t.set("E7", "Muse ghi nhầm");
          t.set(`C${row}`, vid(row));
        }, 5);
      },
    });
    const id = createBatch(t.db, t.grid, [3, 4]);
    t.runner.start(id);
    await t.runner.idle();
    expect(batchOf(t.db, id)).toEqual({ status: "paused", pauseReason: "other_cells" });
    expect(statesOf(t.db, id)).toEqual([
      [3, "needs_review"],
      [4, "queued"],
    ]);
    expect(runsOf(t.db, id)[0]!.error).toBe("Muse sửa ô khác (E7)");
    expect(t.grid[2]![3]).toBe("Cần xem: Muse sửa ô khác (E7)");
  });

  it("lệch dòng: ảnh/prompt dòng đổi so với lúc tạo lô → Cần xem, tạm dừng, không ghi gì vào dòng đó", async () => {
    const t = setup();
    const id = createBatch(t.db, t.grid, [2, 3]);
    t.set("B3", "prompt của sản phẩm khác");
    t.runner.start(id);
    await t.runner.idle();
    expect(batchOf(t.db, id)).toEqual({ status: "paused", pauseReason: "row_shift" });
    expect(statesOf(t.db, id)).toEqual([
      [2, "done"],
      [3, "needs_review"],
    ]);
    expect(t.writes.filter((w) => w.startsWith("D3"))).toEqual([]);
  });

  it("ghép áo (CON-46): ảnh áo đổi so với lúc tạo lô → Cần xem; lượt tạo trước v1.1.0 (không lưu ảnh áo) thì không so", async () => {
    const t = setup();
    saveSheetConfig(t.db, { ...CFG, colShirt: "E" });
    t.set("E2", img(8));
    t.set("E3", img(9));
    const id = createBatch(t.db, t.grid, [2, 3]);
    // Dòng 2 giả làm lượt tạo trước v1.1.0: inputSnapshot không có shirt.
    // Dòng 3 lưu ảnh áo lúc tạo lô, rồi ảnh áo bị đổi.
    t.db.prepare("UPDATE runs SET inputSnapshot = json_set(inputSnapshot, '$.shirt', ?) WHERE batchId = ? AND rowNumber = 3").run(img(9), id);
    t.set("E2", img(7));
    t.set("E3", img(6));
    t.runner.start(id);
    await t.runner.idle();
    expect(statesOf(t.db, id)).toEqual([
      [2, "done"],
      [3, "needs_review"],
    ]);
    expect(t.sent.map((s) => s.row)).toEqual([2]);
  });

  it("§12.10: tool tắt giữa lượt → mở lại không gửi lại, theo dõi tiếp; Muse dán link thì Xong; dòng sau chờ Tiếp tục", async () => {
    const t = setup();
    const id = createBatch(t.db, t.grid, [2, 3]);
    // Trạng thái lúc tool bị tắt: dòng 2 đã gửi, đang chờ Muse; lô đang chạy.
    t.db.prepare("UPDATE runs SET state = 'waiting', sentAt = ?, tabSnapshot = ? WHERE batchId = ? AND rowNumber = 2").run(
      new Date().toISOString(),
      JSON.stringify(t.grid),
      id,
    );
    t.db.prepare("UPDATE batches SET status = 'running' WHERE id = ?").run(id);
    t.set("D2", "Đang chạy");
    setTimeout(() => t.set("C2", vid(2)), 20);

    const restarted = t.newRunner();
    restarted.recover();
    expect(restarted.runningBatchId).toBe(id);
    await restarted.idle();
    expect(t.sent).toEqual([]);
    expect(statesOf(t.db, id)).toEqual([
      [2, "done"],
      [3, "queued"],
    ]);
    expect(batchOf(t.db, id)).toEqual({ status: "paused", pauseReason: "restart" });

    restarted.start(id);
    await restarted.idle();
    expect(t.sent.map((s) => s.row)).toEqual([3]);
    expect(batchOf(t.db, id).status).toBe("done");
  });

  it("§12.10: mở lại mà Muse không bao giờ dán link → hết một chu kỳ chờ thì Cần xem, vẫn không gửi lại", async () => {
    const t = setup({ timeoutMinutes: 1 });
    const id = createBatch(t.db, t.grid, [2]);
    t.db.prepare("UPDATE runs SET state = 'sending', sentAt = ? WHERE batchId = ?").run(new Date().toISOString(), id);
    t.db.prepare("UPDATE batches SET status = 'running' WHERE id = ?").run(id);
    const restarted = t.newRunner();
    restarted.recover();
    await restarted.idle();
    expect(t.sent).toEqual([]);
    expect(runsOf(t.db, id)[0]).toMatchObject({ state: "needs_review", error: "quá thời gian" });
  });

  it("§12.12: đã 4 video hôm nay, lô 2 dòng → chạy 1 dòng rồi tạm dừng vì đủ giới hạn", async () => {
    const t = setup({ sentToday: 4 });
    const id = createBatch(t.db, t.grid, [2, 3]);
    t.runner.start(id);
    await t.runner.idle();
    expect(statesOf(t.db, id)).toEqual([
      [2, "done"],
      [3, "paused_limit"],
    ]);
    expect(batchOf(t.db, id)).toEqual({ status: "paused", pauseReason: "limit" });
    expect(t.sent.map((s) => s.row)).toEqual([2]);
  });

  it("Muse báo hết lượt khi đang chờ → tạm dừng; Tiếp tục thì lượt đó thành Lỗi, không gửi lại", async () => {
    const t = setup({ muse: (row) => void (row === 2 ? (t.watchState.notice = "quota") : setTimeout(() => t.set(`C${row}`, vid(row)), 5)) });
    const id = createBatch(t.db, t.grid, [2, 3]);
    t.runner.start(id);
    await t.runner.idle();
    expect(batchOf(t.db, id)).toEqual({ status: "paused", pauseReason: "quota" });
    expect(statesOf(t.db, id)).toEqual([
      [2, "paused_quota"],
      [3, "queued"],
    ]);
    expect(t.grid[1]![3]).toBe("Lỗi: Muse hết lượt");
    t.watchState.notice = undefined;
    t.runner.start(id);
    await t.runner.idle();
    expect(statesOf(t.db, id)).toEqual([
      [2, "failed"],
      [3, "done"],
    ]);
    expect(t.sent.map((s) => s.row)).toEqual([2, 3]);
  });

  it("Muse từ chối khi gửi → Lỗi, ghi ô Trạng thái, chạy tiếp dòng sau", async () => {
    const t = setup();
    const id = createBatch(t.db, t.grid, [2, 3]);
    t.sendErrors.push(new BotError("rejected", "Muse từ chối yêu cầu", true));
    t.runner.start(id);
    await t.runner.idle();
    expect(statesOf(t.db, id)).toEqual([
      [2, "failed"],
      [3, "done"],
    ]);
    expect(t.grid[1]![3]).toBe("Lỗi: Muse từ chối yêu cầu");
  });

  it("không chắc Muse đã nhận → không gửi lại, vẫn theo dõi ô Video", async () => {
    const t = setup();
    const id = createBatch(t.db, t.grid, [2]);
    t.sendErrors.push(new BotError("send_unconfirmed", "Đã bấm Gửi nhưng không chắc Muse đã nhận yêu cầu", true));
    setTimeout(() => t.set("C2", vid(2)), 20);
    t.runner.start(id);
    await t.runner.idle();
    expect(runsOf(t.db, id)[0]!.state).toBe("done");
  });

  it("Muse chờ duyệt → hiện thông báo, đưa cửa sổ bot lên, bot không tự duyệt; duyệt xong chạy tiếp", async () => {
    let seen: string | undefined;
    const t = setup({
      muse: (row) => {
        t.watchState.approval = true;
        setTimeout(() => {
          seen = t.runner.notices.get(1);
          t.watchState.approval = false;
          setTimeout(() => t.set(`C${row}`, vid(row)), 10);
        }, 30);
      },
    });
    const id = createBatch(t.db, t.grid, [2]);
    t.runner.start(id);
    await t.runner.idle();
    expect(seen).toContain("Muse đang chờ bạn duyệt");
    expect(t.fronts).toBeGreaterThan(0);
    expect(runsOf(t.db, id)[0]!.state).toBe("done");
    expect(t.runner.notices.size).toBe(0);
  });

  it("Tạm dừng: dòng đang chờ Muse được theo dõi cho xong, lô dừng trước dòng sau", async () => {
    const t = setup({ muse: (row) => void setTimeout(() => t.set(`C${row}`, vid(row)), 30) });
    const id = createBatch(t.db, t.grid, [2, 3]);
    t.runner.start(id);
    await new Promise((r) => setTimeout(r, 10));
    expect(t.runner.pause(id)).toBe(true);
    await t.runner.idle();
    expect(statesOf(t.db, id)).toEqual([
      [2, "done"],
      [3, "queued"],
    ]);
    expect(batchOf(t.db, id)).toEqual({ status: "paused", pauseReason: "user" });
  });
});

describe("trang Lô #N", () => {
  it("Bắt đầu chạy → chạy xong hiện kết quả; tạm dừng hiện lý do và nút Tiếp tục", async () => {
    const { createApp } = await import("../src/web/app.js");
    const { loadConfig } = await import("../src/config.js");
    const t = setup();
    const id = createBatch(t.db, t.grid, [2, 3]);
    const app = createApp(loadConfig(FAKE_KEY_ENV), t.db, { runner: t.runner });

    const first = await (await app.request(`/batch/${id}`)).text();
    expect(first).toContain("Bắt đầu chạy");
    expect(first).toContain("Chưa chạy");

    const start = await app.request(`/batch/${id}/start`, { method: "POST" });
    expect(start.status).toBe(303);
    const live = await (await app.request(`/batch/${id}`)).text();
    expect(live).toContain('http-equiv="refresh"');
    expect(live).toContain("Tạm dừng");
    await t.runner.idle();

    const done = await (await app.request(`/batch/${id}`)).text();
    expect(done).toContain("Đã chạy xong");
    expect(done).toContain("2/2 dòng đã xong");
    expect(done).toContain(`href="${vid(2).replace(/&/g, "&amp;")}"`);
    expect(done).toContain("cuộc trò chuyện Muse ↗");
    expect(done).not.toContain('http-equiv="refresh"');

    const id2 = createBatch(t.db, t.grid, [4]);
    t.sendErrors.push(new BotError("login", "Cần đăng nhập Muse", false));
    await app.request(`/batch/${id2}/start`, { method: "POST" });
    await t.runner.idle();
    const paused = await (await app.request(`/batch/${id2}`)).text();
    expect(paused).toContain("Lô đang tạm dừng.");
    expect(paused).toContain("Cần đăng nhập lại Muse");
    expect(paused).toContain(">Tiếp tục</button>");
  });
});

describe("Huỷ lô (F6)", () => {
  it("lô đang chạy: dòng đang chờ Muse được theo dõi cho xong, các dòng sau thành Đã huỷ, không gửi Muse", async () => {
    const t = setup({ muse: (row) => void setTimeout(() => t.set(`C${row}`, vid(row)), 30) });
    const id = createBatch(t.db, t.grid, [2, 3, 4]);
    t.runner.start(id);
    await new Promise((r) => setTimeout(r, 10));
    expect(t.runner.cancel(id)).toEqual({ ok: true, immediate: false });
    await t.runner.idle();
    expect(statesOf(t.db, id)).toEqual([
      [2, "done"],
      [3, "canceled"],
      [4, "canceled"],
    ]);
    expect(batchOf(t.db, id)).toEqual({ status: "canceled", pauseReason: null });
    expect(t.sent.map((s) => s.row)).toEqual([2]);
    expect(t.writes).toEqual(["D2=Đang chạy", "D2=Xong"]);
    expect(t.runner.start(id)).toMatchObject({ ok: false });
  });

  it("lô đang tạm dừng: huỷ ngay, dòng chưa gửi thành Đã huỷ", async () => {
    const t = setup();
    const id = createBatch(t.db, t.grid, [2, 3]);
    t.sendErrors.push(new BotError("login", "Cần đăng nhập Muse", false));
    t.runner.start(id);
    await t.runner.idle();
    expect(batchOf(t.db, id)).toEqual({ status: "paused", pauseReason: "login" });
    expect(t.runner.cancel(id)).toEqual({ ok: true, immediate: true });
    expect(statesOf(t.db, id)).toEqual([
      [2, "canceled"],
      [3, "canceled"],
    ]);
    expect(batchOf(t.db, id).status).toBe("canceled");
    expect(t.sent).toEqual([]);
    expect(t.runner.cancel(id)).toMatchObject({ ok: false });
  });
});

describe("Lịch sử lô, Nhật ký, dải báo (F6)", () => {
  it("lịch sử đếm kết quả; nhật ký lọc lỗi, có link ảnh chụp; dải báo hiện trên mọi trang khi lô tạm dừng; nút Huỷ lô", async () => {
    const { createApp } = await import("../src/web/app.js");
    const { loadConfig } = await import("../src/config.js");
    const t = setup();
    const app = createApp(loadConfig(FAKE_KEY_ENV), t.db, { runner: t.runner });

    const id = createBatch(t.db, t.grid, [2, 3]);
    t.sendErrors.push(undefined, new BotError("rejected", "Muse từ chối yêu cầu", true, "C:/x/screenshots/20261027T020000Z-rejected.png"));
    t.runner.start(id);
    await t.runner.idle();
    const id2 = createBatch(t.db, t.grid, [4]);
    t.sendErrors.push(new BotError("ui_changed", "Không thấy ô chat", false, "C:/x/screenshots/20261027T020100Z-ui_changed.png"));
    t.runner.start(id2);
    await t.runner.idle();

    const hist = await (await app.request("/batches")).text();
    expect(hist).toContain(`href="/batch/${id}"`);
    expect(hist).toContain("✅ 1 xong");
    expect(hist).toContain("❌ 1 lỗi");
    expect(hist).toContain("Giao diện Muse thay đổi");

    const logs = await (await app.request("/logs")).text();
    expect(logs).toContain("Muse từ chối yêu cầu");
    expect(logs).toContain('href="/bot/screenshot/20261027T020000Z-rejected.png"');
    expect(logs).not.toContain("Đọc lại dòng trong sheet");
    const all = await (await app.request(`/logs?all=1&batch=${id}`)).text();
    expect(all).toContain("Đọc lại dòng trong sheet");
    expect(all).not.toContain("Không thấy ô chat");

    for (const p of ["/", "/batches", "/settings"]) {
      const html = await (await app.request(p)).text();
      expect(html).toContain(`Lô #${id2} đang tạm dừng: Giao diện Muse thay đổi`);
    }

    const page = await (await app.request(`/batch/${id2}`)).text();
    expect(page).toContain("Huỷ lô");
    const res = await app.request(`/batch/${id2}/cancel`, { method: "POST" });
    expect(res.status).toBe(303);
    expect(batchOf(t.db, id2).status).toBe("canceled");
    expect(await (await app.request("/")).text()).not.toContain("đang tạm dừng");
    expect(await (await app.request(`/batch/${id2}`)).text()).toContain("Lô đã huỷ.");
  });
});
