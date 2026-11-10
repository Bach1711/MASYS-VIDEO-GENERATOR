import { IMAGE_FIRST_LINE, NO_ASK_LINE } from "../src/bang/request.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BangFiles } from "../src/bang/files.js";
import { addRow, getRow } from "../src/bang/rows.js";
import { estimateText, insertBangBatch, planBangBatch } from "../src/bang/run.js";
import { BotError, type WatchResult } from "../src/bot/museBot.js";
import { getBatch } from "../src/batch/create.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { getDailyQuota } from "../src/db/quota.js";
import { getSettings } from "../src/db/settings.js";
import { BatchRunner, type MuseDriver } from "../src/queue/runner.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/web/app.js";

// Chạy song song (CON-73, D28): gửi lần lượt, mỗi dòng một cuộc trò chuyện trong tab riêng, chờ tối đa N video cùng lúc.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MP4 = [0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, 1, 2, 3, 4];
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const chatOf = (row: number) => `https://muse.ai/thread/row${row}abcd`;

interface Opts {
  rows?: number;
  parallel?: number;
  /** Số lần xem tab trước khi video của dòng hiện ra (mặc định 30, đủ lâu để các dòng chờ chồng lên nhau). */
  slow?: Record<number, number>;
  /** Lần gửi thứ mấy thì Muse đòi đăng nhập (chưa gửi). */
  loginAt?: number;
  onSend?: (count: number) => void;
  /** Lần gửi thứ mấy của dòng nào thì lỗi. */
  sendFail?: (row: number, nth: number) => BotError | undefined;
  /** Muse hiện thông báo gì ở dòng này, lần gửi thứ mấy. */
  notice?: (row: number, nth: number) => WatchResult["notice"];
  /** Bot treo khi đang gửi; đóng cửa sổ thì báo lỗi này. */
  hangSend?: BotError;
}

function setup(o: Opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-parallel-"));
  dirs.push(dataDir);
  const files = new BangFiles(dataDir);
  const db = openDatabase(":memory:");
  for (let id = 1; id <= (o.rows ?? 5); id++) addRow(db, { prompt: `dòng ${id} nhìn máy quay`, modelFront: files.saveImage(`${id}-mau-truoc`, PNG) });
  db.prepare("UPDATE settings SET parallelVideos = ? WHERE id = 1").run(o.parallel ?? 3);

  const tabs = new Map<string, { row: number; polls: number }>();
  const sends: { row: number; tab: string }[] = [];
  const opened: { url: string; tab?: string }[] = [];
  const closed: string[] = [];
  let maxOpen = 0;
  let tries = 0;
  let closes = 0;
  let closeBot = () => {};
  const perRow = new Map<number, number>();
  const bot: MuseDriver = {
    isOpen: true,
    async open() {},
    async bringToFront() {},
    async close() {
      closes++;
      tabs.clear();
      closeBot();
    },
    async send(text: string, _files?: string[], tab?: string) {
      tries++;
      if (o.loginAt === tries) throw new BotError("login", "Cần đăng nhập Muse", false);
      // Treo ở bước gửi cho tới khi cửa sổ bot bị đóng.
      if (o.hangSend) await new Promise<void>((resolve) => { closeBot = resolve; });
      if (o.hangSend) throw o.hangSend;
      const row = Number(/dòng (\d+)/.exec(text)![1]);
      const nth = (perRow.get(row) ?? 0) + 1;
      perRow.set(row, nth);
      sends.push({ row, tab: tab! });
      const bad = o.sendFail?.(row, nth);
      if (bad) throw bad;
      tabs.set(tab!, { row, polls: 0 });
      maxOpen = Math.max(maxOpen, tabs.size);
      o.onSend?.(sends.length);
      return { chatUrl: chatOf(row) };
    },
    async watch(tab?: string): Promise<WatchResult> {
      const t = tabs.get(tab!);
      if (!t) return { closed: true, login: false, approval: false };
      t.polls++;
      const notice = o.notice?.(t.row, perRow.get(t.row) ?? 0);
      return { closed: false, login: false, approval: false, notice, videos: !notice && t.polls >= (o.slow?.[t.row] ?? 30) ? 1 : 0, url: chatOf(t.row) };
    },
    async openChat(url: string, tab?: string) {
      opened.push({ url, tab });
      tabs.set(tab!, { row: Number(/row(\d+)/.exec(url)![1]), polls: 0 });
      maxOpen = Math.max(maxOpen, tabs.size);
    },
    async downloadVideo(tab?: string) {
      // Mỗi video mang số dòng của tab ở byte cuối, để kiểm tra video gắn đúng dòng.
      return { data: new Uint8Array([...MP4, tabs.get(tab!)!.row]), count: 1 };
    },
    async closeTab(tab: string) {
      tabs.delete(tab);
      closed.push(tab);
    },
  };
  const runner = new BatchRunner(db, undefined, undefined, bot, { pollMs: 2, minuteMs: 400, secondMs: 1, random: () => 0, bangFiles: files });
  const batchOf = (ids: number[]) => insertBangBatch(db, "", planBangBatch(db, ids, getSettings(db), "").runs);
  const run = async (ids: number[]) => {
    const batchId = batchOf(ids);
    expect(runner.start(batchId)).toEqual({ ok: true });
    await runner.idle();
    return batchId;
  };
  const videoRow = (row: number) => {
    const name = getRow(db, row)!.videoFile;
    return name ? fs.readFileSync(path.join(dataDir, "tep", "video", name)).at(-1) : undefined;
  };
  return { db, runner, run, batchOf, sends, opened, closed, videoRow, maxOpen: () => maxOpen, tabs, closes: () => closes };
}

const states = (db: DB) => (db.prepare("SELECT bangRowId AS row, state FROM runs ORDER BY bangRowId").all() as { row: number; state: string }[]).map((r) => `${r.row}:${r.state}`);
const sentCount = (db: DB, row: number) => (db.prepare("SELECT COUNT(*) AS n FROM runs WHERE bangRowId = ? AND sentAt IS NOT NULL").get(row) as { n: number }).n;

describe("chạy song song (D28)", () => {
  it("5 dòng, 3 cùng lúc: không quá 3 tab chờ, mỗi dòng gửi đúng một lần trong tab riêng, xong hết, đóng tab", async () => {
    const t = setup();
    const batchId = await t.run([1, 2, 3, 4, 5]);
    expect(t.sends.map((s) => s.row)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(t.sends.map((s) => s.tab)).size).toBe(5);
    expect(t.maxOpen()).toBe(3);
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:done", "4:done", "5:done"]);
    expect(t.closed).toHaveLength(5);
    expect(getBatch(t.db, batchId)!.status).toBe("done");
    for (const r of [1, 2, 3, 4, 5]) expect(sentCount(t.db, r)).toBe(1);
  });

  it("video xong không theo thứ tự gửi → mỗi video vẫn gắn đúng dòng của nó", async () => {
    const t = setup({ rows: 3, slow: { 1: 90, 2: 2, 3: 30 } });
    await t.run([1, 2, 3]);
    expect([t.videoRow(1), t.videoRow(2), t.videoRow(3)]).toEqual([1, 2, 3]);
    const doneOrder = (t.db.prepare("SELECT r.bangRowId AS row FROM run_events e JOIN runs r ON r.id = e.runId WHERE e.toState = 'done' ORDER BY e.id").all() as { row: number }[]).map((x) => x.row);
    expect(doneOrder).toEqual([2, 3, 1]);
  });

  it("đặt 1 → lần lượt như trước: xong dòng này mới gửi dòng sau", async () => {
    const t = setup({ rows: 3, parallel: 1 });
    await t.run([1, 2, 3]);
    expect(t.maxOpen()).toBe(1);
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:done"]);
  });

  it("Tạm dừng: không gửi dòng mới, vẫn tải nốt video đã gửi; Tiếp tục thì gửi các dòng còn lại", async () => {
    let batchId = 0;
    const t = setup({ slow: { 1: 8, 2: 8 }, onSend: (n) => n === 2 && t.runner.pause(batchId) });
    batchId = t.batchOf([1, 2, 3, 4, 5]);
    t.runner.start(batchId);
    await t.runner.idle();
    expect(t.sends.map((s) => s.row)).toEqual([1, 2]);
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:queued", "4:queued", "5:queued"]);
    expect(getBatch(t.db, batchId)).toMatchObject({ status: "paused", pauseReason: "user" });

    expect(t.runner.start(batchId)).toEqual({ ok: true });
    await t.runner.idle();
    expect(t.sends.map((s) => s.row)).toEqual([1, 2, 3, 4, 5]);
    expect(getBatch(t.db, batchId)!.status).toBe("done");
  });

  it("Muse đòi đăng nhập ở dòng 3: ngừng gửi, vẫn tải video dòng 1–2, lô Tạm dừng; dòng 3 chưa gửi", async () => {
    const t = setup({ loginAt: 3 });
    const batchId = await t.run([1, 2, 3, 4]);
    expect(t.sends.map((s) => s.row)).toEqual([1, 2]);
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:paused_login", "4:queued"]);
    expect(sentCount(t.db, 3)).toBe(0);
    expect(getBatch(t.db, batchId)).toMatchObject({ status: "paused", pauseReason: "login" });
  });

  it("đủ giới hạn ngày giữa chừng: chỉ gửi đủ số còn lại, tải nốt rồi Tạm dừng", async () => {
    const t = setup();
    t.db.prepare("UPDATE settings SET dailyVideoLimit = 2 WHERE id = 1").run();
    const batchId = await t.run([1, 2, 3, 4]);
    expect(t.sends).toHaveLength(2);
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:paused_limit", "4:queued"]);
    expect(getBatch(t.db, batchId)).toMatchObject({ status: "paused", pauseReason: "limit" });
  });
});

describe("Huỷ lô dừng ngay (CON-90)", () => {
  it("đang chờ video: dừng ngay không đợi hết giờ, đóng cửa sổ bot, dòng đã gửi Cần xem, dòng chưa gửi Đã huỷ", async () => {
    const t = setup({ rows: 4, parallel: 2, slow: { 1: 1e6, 2: 1e6 } });
    const id = t.batchOf([1, 2, 3, 4]);
    t.runner.start(id);
    while (t.sends.length < 2) await new Promise((r) => setTimeout(r, 2));
    expect(t.runner.cancel(id)).toEqual({ ok: true, immediate: false });
    const at = Date.now();
    await t.runner.idle();
    expect(Date.now() - at).toBeLessThan(300);
    expect(states(t.db)).toEqual(["1:needs_review", "2:needs_review", "3:canceled", "4:canceled"]);
    expect(getBatch(t.db, id)!.status).toBe("canceled");
    expect(t.closes()).toBeGreaterThan(0);
    expect(t.sends).toHaveLength(2);
  });

  it("đang gửi, chưa bấm Gửi của Muse: đóng cửa sổ là dừng, dòng thành Đã huỷ", async () => {
    const t = setup({ rows: 2, hangSend: new BotError("ui_changed", "trang đã đóng", false) });
    const id = t.batchOf([1, 2]);
    t.runner.start(id);
    await new Promise((r) => setTimeout(r, 10));
    t.runner.cancel(id);
    await t.runner.idle();
    expect(states(t.db)).toEqual(["1:canceled", "2:canceled"]);
    expect(sentCount(t.db, 1)).toBe(0);
  });

  it("đang gửi, đã bấm Gửi của Muse: Cần xem, không gửi lại (D9)", async () => {
    const t = setup({ rows: 2, hangSend: new BotError("send_unconfirmed", "trang đã đóng", true) });
    const id = t.batchOf([1, 2]);
    t.runner.start(id);
    await new Promise((r) => setTimeout(r, 10));
    t.runner.cancel(id);
    await t.runner.idle();
    expect(states(t.db)).toEqual(["1:needs_review", "2:canceled"]);
  });

  it("Tạm dừng vẫn tải nốt video đã gửi, không đóng cửa sổ bot", async () => {
    const t = setup({ rows: 2, parallel: 1, slow: { 1: 3 } });
    const id = t.batchOf([1, 2]);
    t.runner.start(id);
    while (t.sends.length < 1) await new Promise((r) => setTimeout(r, 2));
    t.runner.pause(id);
    await t.runner.idle();
    expect(states(t.db)).toEqual(["1:done", "2:queued"]);
    expect(t.closes()).toBe(0);
  });
});

describe("Bảng video tự chạy lại dòng lỗi (CON-91)", () => {
  const ui = () => new BotError("ui_changed", "Không thấy ô chat", false);
  const info = (db: DB, row: number) => db.prepare("SELECT attempt, error, sentAt, extraSends FROM runs WHERE bangRowId = ?").get(row) as { attempt: number; error: string | null; sentAt: string | null; extraSends: number };

  it("giao diện lỗi lúc chưa gửi: mở tab mới làm lại ngay, không dừng lô, không tính lượt, không tính thất bại (CON-98)", async () => {
    const t = setup({ rows: 3, slow: { 1: 2, 2: 2, 3: 2 }, sendFail: (row, nth) => (row === 1 && nth === 1 ? ui() : undefined) });
    const id = await t.run([1, 2, 3]);
    expect(t.sends.map((s) => s.row)).toEqual([1, 1, 2, 3]);
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:done"]);
    expect(getBatch(t.db, id)!.status).toBe("done");
    expect(info(t.db, 1)).toMatchObject({ attempt: 1, error: null, extraSends: 0 });
    expect(getDailyQuota(t.db).used).toBe(3);
    expect(t.closes()).toBe(0);
  });

  it("đã bấm Gửi nhưng không chắc: chạy lại, tính lượt; đủ 3 lần thì Cần xem, ghi thất bại 3 lần", async () => {
    const t = setup({ rows: 1, sendFail: () => new BotError("send_unconfirmed", "Không chắc Muse đã nhận", true) });
    await t.run([1]);
    expect(t.sends).toHaveLength(3);
    expect(states(t.db)).toEqual(["1:needs_review"]);
    expect(info(t.db, 1).error).toBe("Thất bại 3 lần: Không chắc Muse đã nhận");
    expect(getDailyQuota(t.db).used).toBe(3);
  });

  it("chỉ còn đúng 1 video mà lỗi: đóng cả trình duyệt rồi chạy lại", async () => {
    const t = setup({ rows: 1, slow: { 1: 2 }, sendFail: (_r, nth) => (nth === 1 ? new BotError("send_unconfirmed", "Không chắc Muse đã nhận", true) : undefined) });
    await t.run([1]);
    expect(t.closes()).toBe(1);
    expect(states(t.db)).toEqual(["1:done"]);
  });

  it("Muse hỏi lại: chờ thêm rồi mới coi là thất bại, đóng tab, chạy lại trong cuộc trò chuyện mới", async () => {
    const t = setup({ rows: 1, slow: { 1: 2 }, notice: (_r, nth) => (nth === 1 ? "asking" : undefined) });
    await t.run([1]);
    expect(t.sends).toHaveLength(2);
    expect(t.closed).toHaveLength(2);
    expect(states(t.db)).toEqual(["1:done"]);
    expect(getDailyQuota(t.db).used).toBe(2);
  });

  it("Muse báo lỗi: chạy lại; Muse từ chối: không chạy lại", async () => {
    const t = setup({ rows: 2, parallel: 1, slow: { 1: 2, 2: 2 }, notice: (row, nth) => (row === 1 && nth === 1 ? "error" : row === 2 ? "rejected" : undefined) });
    await t.run([1, 2]);
    expect(states(t.db)).toEqual(["1:done", "2:failed"]);
    expect(t.sends.filter((s) => s.row === 2)).toHaveLength(1);
  });

  it("hết giờ chờ không có video: Cần xem, không chạy lại", async () => {
    const t = setup({ rows: 1, slow: { 1: 1e9 } });
    t.db.prepare("UPDATE settings SET timeoutMinutes = 1 WHERE id = 1").run();
    await t.run([1]);
    expect(t.sends).toHaveLength(1);
    expect(states(t.db)).toEqual(["1:needs_review"]);
  });

  it("cần đăng nhập: tạm dừng lô như trước, không tính thất bại", async () => {
    const t = setup({ rows: 2, loginAt: 1 });
    const id = await t.run([1, 2]);
    expect(getBatch(t.db, id)).toMatchObject({ status: "paused", pauseReason: "login" });
    expect(info(t.db, 1).attempt).toBe(1);
  });

  it("3 dòng khác nhau lỗi liên tiếp: tạm dừng lô, dòng sau chưa gửi; Tiếp tục thì chạy lại và nhớ số lần", async () => {
    const unsure = () => new BotError("send_unconfirmed", "Không chắc Muse đã nhận", true);
    let down = true;
    const t = setup({ rows: 4, slow: { 1: 2, 2: 2, 3: 2, 4: 2 }, sendFail: () => (down ? unsure() : undefined) });
    const id = await t.run([1, 2, 3, 4]);
    expect(getBatch(t.db, id)).toMatchObject({ status: "paused", pauseReason: "muse_down" });
    expect(t.sends.map((s) => s.row)).toEqual([1, 2, 3]);
    expect(info(t.db, 1)).toMatchObject({ attempt: 2, error: "Thất bại lần 1/3: Không chắc Muse đã nhận" });
    down = false;
    expect(t.runner.start(id)).toEqual({ ok: true });
    await t.runner.idle();
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:done", "4:done"]);
    expect(t.sends.map((s) => s.row).slice(3)).toEqual([4, 1, 2, 3]);
  });

  it("nhiều dòng cùng trắng trang nhưng tab mới cứu được: lô chạy đến hết, không dừng vì Muse lỗi (CON-98)", async () => {
    const t = setup({ rows: 4, slow: { 1: 2, 2: 2, 3: 2, 4: 2 }, sendFail: (_r, nth) => (nth < 3 ? ui() : undefined) });
    const id = await t.run([1, 2, 3, 4]);
    expect(getBatch(t.db, id)!.status).toBe("done");
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:done", "4:done"]);
    expect(t.sends).toHaveLength(12);
    expect(new Set(t.closed.slice(0, 2)).size).toBe(1);
    expect(getDailyQuota(t.db).used).toBe(4);
  });

  it("tin đến Muse thiếu ảnh: tự gửi lại trong cuộc trò chuyện mới, mỗi lần gửi đều tính lượt (CON-99)", async () => {
    const t = setup({ rows: 1, slow: { 1: 2 }, sendFail: (_r, nth) => (nth === 1 ? new BotError("missing_images", "Tin đến Muse thiếu ảnh (0/2 ảnh)", true) : undefined) });
    await t.run([1]);
    expect(t.sends).toHaveLength(2);
    expect(states(t.db)).toEqual(["1:done"]);
    expect(info(t.db, 1)).toMatchObject({ attempt: 2, extraSends: 1, error: null });
    expect(getDailyQuota(t.db).used).toBe(2);
  });

  it("hỏng đủ 3 tab: Cần xem ngay, không chạy lại thêm, không tính lượt, dòng khác vẫn chạy (CON-98)", async () => {
    const t = setup({ rows: 2, slow: { 1: 2, 2: 2 }, sendFail: (row) => (row === 1 ? ui() : undefined) });
    const id = await t.run([1, 2]);
    expect(t.sends.map((s) => s.row)).toEqual([1, 1, 1, 2]);
    expect(states(t.db)).toEqual(["1:needs_review", "2:done"]);
    expect(info(t.db, 1)).toMatchObject({ attempt: 1, error: "Thất bại 3 lần: Không thấy ô chat", sentAt: null });
    expect(t.closed.filter((x) => x === t.sends[0]!.tab)).toHaveLength(3);
    expect(getBatch(t.db, id)!.status).toBe("done");
    expect(getDailyQuota(t.db).used).toBe(1);
  });

  it("Muse hỏng thật, 3 dòng hỏng đủ 3 tab: vẫn tạm dừng lô, không đốt hết các dòng còn lại (CON-98)", async () => {
    const t = setup({ rows: 5, slow: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 }, sendFail: () => ui() });
    const id = await t.run([1, 2, 3, 4, 5]);
    expect(getBatch(t.db, id)).toMatchObject({ status: "paused", pauseReason: "muse_down" });
    expect(t.sends.map((s) => s.row)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(states(t.db)).toEqual(["1:needs_review", "2:needs_review", "3:needs_review", "4:queued", "5:queued"]);
  });

  it("Hủy lô lúc đang thay tab: dừng luôn, không gửi nữa", async () => {
    let cancel = () => {};
    const t = setup({ rows: 1, sendFail: () => (cancel(), ui()) });
    const id = t.batchOf([1]);
    cancel = () => t.runner.cancel(id);
    t.runner.start(id);
    await t.runner.idle();
    expect(states(t.db)).toEqual(["1:canceled"]);
    expect(t.sends).toHaveLength(1);
  });

  it("Tạm dừng lúc đang thay tab: dòng về hàng đợi, không mở tab mới, không tính lượt (CON-98)", async () => {
    let pause = () => {};
    const t = setup({ rows: 1, sendFail: () => (pause(), ui()) });
    const id = t.batchOf([1]);
    pause = () => t.runner.pause(id);
    t.runner.start(id);
    await t.runner.idle();
    expect(getBatch(t.db, id)).toMatchObject({ status: "paused", pauseReason: "user" });
    expect(states(t.db)).toEqual(["1:queued"]);
    expect(info(t.db, 1)).toMatchObject({ attempt: 1, sentAt: null });
    expect(t.sends).toHaveLength(1);
  });

  it("cần đăng nhập giữa lúc thay tab: dừng như cũ, không mở thêm tab (CON-98)", async () => {
    const t = setup({ rows: 1, sendFail: (_r, nth) => (nth === 1 ? ui() : new BotError("login", "Cần đăng nhập Muse", false)) });
    const id = await t.run([1]);
    expect(getBatch(t.db, id)).toMatchObject({ status: "paused", pauseReason: "login" });
    expect(t.sends).toHaveLength(2);
    expect(states(t.db)).toEqual(["1:paused_login"]);
  });
});

describe("tool mở lại giữa chừng khi đang chờ nhiều video (D9, D28)", () => {
  function midway(t: ReturnType<typeof setup>, ids: number[], sent: number[]) {
    const batchId = t.batchOf(ids);
    t.db.prepare("UPDATE batches SET status = 'running' WHERE id = ?").run(batchId);
    for (const row of sent) {
      t.db.prepare("UPDATE runs SET state = 'waiting', sentAt = ?, museChatUrl = ? WHERE bangRowId = ?").run(new Date().toISOString(), chatOf(row), row);
    }
    return batchId;
  }

  it("mở lại mọi cuộc trò chuyện đang dở, mỗi cái một tab, tải hết, không gửi gì; lô vẫn Tạm dừng", async () => {
    const t = setup();
    const batchId = midway(t, [1, 2, 3, 4], [1, 2, 3]);
    t.runner.recover();
    await t.runner.idle();
    expect(t.sends).toEqual([]);
    expect(t.opened.map((x) => x.url)).toEqual([chatOf(1), chatOf(2), chatOf(3)]);
    expect(new Set(t.opened.map((x) => x.tab)).size).toBe(3);
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:done", "4:queued"]);
    expect([t.videoRow(1), t.videoRow(2), t.videoRow(3)]).toEqual([1, 2, 3]);
    expect(getBatch(t.db, batchId)).toMatchObject({ status: "paused", pauseReason: "restart" });
  });

  it("bấm Tiếp tục khi còn đang chờ video cũ → gửi luôn dòng còn lại, không gửi lại dòng đã gửi", async () => {
    const t = setup({ slow: { 1: 60, 2: 60 } });
    const batchId = midway(t, [1, 2, 3, 4], [1, 2]);
    t.runner.recover();
    expect(t.runner.start(batchId)).toEqual({ ok: true });
    await t.runner.idle();
    expect(t.sends.map((s) => s.row)).toEqual([3, 4]);
    expect(states(t.db)).toEqual(["1:done", "2:done", "3:done", "4:done"]);
    expect(getBatch(t.db, batchId)!.status).toBe("done");
  });
});

describe("mẫu hai mặt mới làm mẫu gốc (CON-73)", () => {
  it("máy chưa sửa mẫu dùng mẫu mới: ghép ảnh A, B trước, cắt cảnh sang quay lưng, không xoay người; máy đã sửa giữ bản của mình", () => {
    const db = openDatabase(":memory:");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-twoside-"));
    dirs.push(dir);
    const f = new BangFiles(dir);
    const img = (n: string) => f.saveImage(n, PNG);
    addRow(db, { prompt: "vuốt tóc", modelFront: img("a"), shirtFront: img("b"), modelBack: img("c"), shirtBack: img("d") });
    const text = () => planBangBatch(db, [1], getSettings(db), "").runs[0]!.request.text;
    for (const s of ["Ảnh A: người mẫu ở ảnh 1 mặc chiếc áo ở ảnh 2.", "Ảnh B: người mẫu ở ảnh 3 mặc chiếc áo ở ảnh 4.", "KHÔNG xoay người", "Không dùng ảnh 2 và ảnh 4 cho video.", "Prompt: vuốt tóc"]) {
      expect(text()).toContain(s);
    }
    db.prepare("UPDATE settings SET twoSidedTemplate = ? WHERE id = 1").run("Mẫu riêng của tôi: {prompt}");
    expect(text()).toBe(`Mẫu riêng của tôi: vuốt tóc
${IMAGE_FIRST_LINE}
${NO_ASK_LINE}`);
  });
});

describe("tên app KOL Fashion MASYS Video (D29)", () => {
  it("hiện đủ tên ở đầu trang và tab trình duyệt", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-name-"));
    dirs.push(dataDir);
    const db = openDatabase(":memory:");
    const app = createApp(loadConfig({ MASYS_DATA_DIR: dataDir }), db);
    const html = await (await app.request("/")).text();
    expect(html).toMatch(/<title>[^<]*KOL Fashion MASYS Video<\/title>/);
    expect(html).toMatch(/class="brand"[^>]*>[\s\S]*KOL Fashion MASYS Video[\s\S]*<\/a>/);
    expect(html).not.toMatch(/>\s*MASYS Video\s*</);
  });
});

describe("ước lượng thời gian khi chạy song song", () => {
  it("chạy 3 cùng lúc ngắn hơn lần lượt, nhưng mỗi dòng vẫn mất ít nhất một lần nghỉ", () => {
    const db = openDatabase(":memory:");
    const s = { pauseMinSec: 20, pauseMaxSec: 60 };
    expect(estimateText(db, 20, { ...s, parallelVideos: 1 })).toBe("khoảng 2 giờ");
    expect(estimateText(db, 20, { ...s, parallelVideos: 3 })).toBe("khoảng 38 phút");
    expect(estimateText(db, 20, { pauseMinSec: 600, pauseMaxSec: 600, parallelVideos: 6 })).toBe("khoảng 3,5 giờ");
  });
});
