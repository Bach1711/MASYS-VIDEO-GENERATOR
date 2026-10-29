import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BangFiles } from "../src/bang/files.js";
import { buildBangRequest, DEFAULT_BANG_SHIRT_TEMPLATE, validateBangTemplate } from "../src/bang/request.js";
import { addRow, countByFilter, getRow, labelOf } from "../src/bang/rows.js";
import { insertBangBatch, planBangBatch } from "../src/bang/run.js";
import { BotError, type WatchResult } from "../src/bot/museBot.js";
import { getBatch } from "../src/batch/create.js";
import { loadConfig } from "../src/config.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { getSettings } from "../src/db/settings.js";
import { BatchRunner, type MuseDriver } from "../src/queue/runner.js";
import { createApp } from "../src/web/app.js";
import { FAKE_KEY_ENV } from "./fakeKey.js";

// Bảng mới tạo video (CON-52, spec v6.0 mục 17.4, 17.5, D22, D24).

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Dòng 1: một ảnh; dòng 2: ghép áo; dòng 3: hai mặt; dòng 4: thiếu áo sau. */
function setup(o: { videoAfter?: number; sendError?: BotError; limit?: number; videoMissing?: boolean } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-bangrun-"));
  dirs.push(dataDir);
  const files = new BangFiles(dataDir);
  const db = openDatabase(":memory:");
  if (o.limit) db.prepare("UPDATE settings SET dailyVideoLimit = ?").run(o.limit);
  const img = (id: number, tag: string) => files.saveImage(`${id}-${tag}`, PNG);
  addRow(db, { prompt: "vẫy tay", modelFront: img(1, "mau-truoc") });
  addRow(db, { prompt: "xoay người", modelFront: img(2, "mau-truoc"), shirtFront: img(2, "ao-truoc") });
  addRow(db, { prompt: "bước tới", modelFront: img(3, "mau-truoc"), shirtFront: img(3, "ao-truoc"), modelBack: img(3, "mau-sau"), shirtBack: img(3, "ao-sau") });
  addRow(db, { prompt: "x", modelFront: img(4, "mau-truoc"), modelBack: img(4, "mau-sau") });

  const sent: { text: string; files: string[] }[] = [];
  const opened: string[] = [];
  let videos = 0;
  let polls = 0;
  const bot: MuseDriver = {
    isOpen: true,
    async open() {},
    async send(text: string, f: string[] = []) {
      if (o.sendError) throw o.sendError;
      sent.push({ text, files: f });
      videos = 0;
      polls = 0;
      return { chatUrl: `https://muse.ai/thread/t${sent.length}abcd` };
    },
    async watch(): Promise<WatchResult> {
      polls++;
      if (o.videoAfter !== undefined && polls >= o.videoAfter) videos = 1;
      return { closed: false, login: false, approval: false, videos, ...(o.videoMissing && polls >= 2 ? { notice: "videoMissing" as const } : {}) };
    },
    async openChat(url: string) {
      opened.push(url);
    },
    async bringToFront() {},
  };
  const runner = new BatchRunner(db, undefined, undefined, bot, { pollMs: 2, minuteMs: 40, secondMs: 1, random: () => 0, bangFiles: files });
  return { db, files, dataDir, bot, runner, sent, opened };
}

const state = (db: DB, row: number) => db.prepare("SELECT state, error, museChatUrl FROM runs WHERE bangRowId = ? ORDER BY id DESC").get(row) as Record<string, string | null>;

describe("yêu cầu gửi Muse (17.4)", () => {
  it("một ảnh / ghép áo / hai mặt; ảnh đính kèm đúng thứ tự; thiếu áo sau thì không tạo", () => {
    const { db } = setup();
    const s = getSettings(db);
    const one = buildBangRequest(getRow(db, 1)!, s, "");
    expect(one).toMatchObject({ kind: "single", attachments: [{ slot: "modelFront" }] });
    expect("text" in one && one.text).toContain("Tôi gửi kèm 1 ảnh: ảnh 1 là người mẫu.");
    expect("text" in one && one.text).not.toContain("ảnh 2");
    expect("text" in one && one.text).toContain("Yêu cầu thêm: (không có)");

    const shirt = buildBangRequest(getRow(db, 2)!, s, "chậm");
    expect(shirt).toMatchObject({ kind: "shirt", attachments: [{ slot: "modelFront" }, { slot: "shirtFront" }] });
    expect("text" in shirt && shirt.text).toContain("ảnh 1 là người mẫu, ảnh 2 là thiết kế áo");
    expect("text" in shirt && shirt.text).toContain(DEFAULT_BANG_SHIRT_TEMPLATE);
    expect("text" in shirt && shirt.text).toContain("Yêu cầu thêm: chậm");

    const two = buildBangRequest(getRow(db, 3)!, s, "");
    expect(two).toMatchObject({ kind: "two_sided" });
    expect("attachments" in two && two.attachments.map((a) => a.slot)).toEqual(["modelFront", "shirtFront", "modelBack", "shirtBack"]);
    expect("text" in two && two.text).toContain("Prompt: bước tới");
    expect("text" in two && two.text).toContain("không sửa Google Sheet");

    expect(buildBangRequest(getRow(db, 4)!, s, "")).toEqual({ problems: ["Có mặt sau nên cần đủ 4 ảnh, còn thiếu: Áo trước, Áo sau"] });
  });

  it("mẫu sửa trong Cài đặt phải có {prompt} và chỉ dùng chỗ trống đã biết", () => {
    expect(validateBangTemplate("bangTemplate", "Prompt: {prompt} {so_anh}")).toEqual([]);
    expect(validateBangTemplate("bangTemplate", "{so_anh}")).toEqual(["Mẫu phải có: {prompt}"]);
    expect(validateBangTemplate("twoSidedTemplate", "{prompt} {so_anh}")).toEqual(["Không có chỗ trống tên: {so_anh}"]);
    expect(validateBangTemplate("bangShirtTemplate", "ghép áo")).toEqual([]);
  });
});

describe("chạy lô Bảng mới (17.5)", () => {
  it("đính kèm ảnh theo thứ tự, chờ video trong cuộc trò chuyện → Xong, có link Mở trong Muse; dòng thiếu dữ liệu bị loại", async () => {
    const { db, runner, sent, files } = setup({ videoAfter: 2 });
    const plan = planBangBatch(db, [3, 1, 4, 99], getSettings(db), "");
    expect(plan.rejected).toEqual([
      { id: 4, why: "Có mặt sau nên cần đủ 4 ảnh, còn thiếu: Áo trước, Áo sau" },
      { id: 99, why: "không có dòng này" },
    ]);
    const batchId = insertBangBatch(db, "", plan.runs);
    expect(getBatch(db, batchId)).toMatchObject({ source: "bang", tab: "Bảng mới", driveFolderId: "" });
    expect(labelOf(getRow(db, 1)!).label).toBe("running");
    expect(runner.start(batchId)).toEqual({ ok: true });
    await runner.idle();

    expect(sent.map((x) => x.files.length)).toEqual([1, 4]);
    const row3 = getRow(db, 3)!;
    expect(sent[1]!.files).toEqual([row3.modelFront, row3.shirtFront, row3.modelBack, row3.shirtBack].map((n) => files.imagePath(n!)));
    expect(sent[1]!.text).toContain("ảnh 4 là thiết kế áo mặt sau");
    expect(state(db, 1)).toMatchObject({ state: "done", museChatUrl: "https://muse.ai/thread/t1abcd" });
    expect(getBatch(db, batchId)!.status).toBe("done");
    expect(labelOf(getRow(db, 3)!).label).toBe("done");
    expect(countByFilter(db)).toMatchObject({ done: 2, todo: 1, missing: 1, running: 0 });
    // Lượt của Bảng mới tính vào giới hạn ngày chung.
    expect((db.prepare("SELECT count(*) n FROM runs WHERE sentAt IS NOT NULL").get() as { n: number }).n).toBe(2);
  });

  it("file ảnh không còn trên máy → Cần xem, không gửi", async () => {
    const { db, runner, sent, files } = setup({ videoAfter: 1 });
    const batchId = insertBangBatch(db, "", planBangBatch(db, [2], getSettings(db), "").runs);
    files.removeImage(getRow(db, 2)!.shirtFront);
    runner.start(batchId);
    await runner.idle();
    expect(sent).toEqual([]);
    expect(state(db, 2)).toMatchObject({ state: "needs_review", error: "thiếu file ảnh" });
    expect(labelOf(getRow(db, 2)!).label).toBe("review");
  });

  it("Muse không hiện đủ ảnh (chưa gửi) → tạm dừng, chưa tính lượt; quá giờ không có video → Cần xem, không gửi lại", async () => {
    const ui = setup({ sendError: new BotError("ui_changed", "Muse chỉ hiện 1/2 ảnh đính kèm; chưa gửi", false) });
    const b1 = insertBangBatch(ui.db, "", planBangBatch(ui.db, [2], getSettings(ui.db), "").runs);
    ui.runner.start(b1);
    await ui.runner.idle();
    expect(state(ui.db, 2).state).toBe("paused_ui");
    expect(getBatch(ui.db, b1)).toMatchObject({ status: "paused", pauseReason: "ui" });
    expect((ui.db.prepare("SELECT count(*) n FROM runs WHERE sentAt IS NOT NULL").get() as { n: number }).n).toBe(0);

    const slow = setup();
    const b2 = insertBangBatch(slow.db, "", planBangBatch(slow.db, [1], getSettings(slow.db), "").runs);
    slow.runner.start(b2);
    await slow.runner.idle();
    expect(slow.sent).toHaveLength(1);
    expect(state(slow.db, 1)).toMatchObject({ state: "needs_review", error: "quá thời gian" });
  });

  it("Muse báo xong nhưng ô video hiện Video not found → Cần xem ngay, không chờ hết giờ, không gửi lại", async () => {
    const { db, runner, sent } = setup({ videoMissing: true });
    const batchId = insertBangBatch(db, "", planBangBatch(db, [1, 2], getSettings(db), "").runs);
    runner.start(batchId);
    await runner.idle();
    expect(sent).toHaveLength(2);
    expect(state(db, 1)).toMatchObject({ state: "needs_review", error: "video không mở được", museChatUrl: "https://muse.ai/thread/t1abcd" });
    expect(getBatch(db, batchId)!.status).toBe("done");
  });

  it("đủ giới hạn ngày → tạm dừng trước khi gửi", async () => {
    const { db, runner, sent } = setup({ videoAfter: 1, limit: 1 });
    const batchId = insertBangBatch(db, "", planBangBatch(db, [1, 2], getSettings(db), "").runs);
    runner.start(batchId);
    await runner.idle();
    expect(sent).toHaveLength(1);
    expect(state(db, 2).state).toBe("paused_limit");
    expect(getBatch(db, batchId)).toMatchObject({ status: "paused", pauseReason: "limit" });
  });

  it("tool mở lại giữa chừng: mở lại đúng cuộc trò chuyện và chờ tiếp, không gửi lại; không biết cuộc trò chuyện → Cần xem", async () => {
    const { db, sent, opened, bot, files } = setup({ videoAfter: 1 });
    const batchId = insertBangBatch(db, "", planBangBatch(db, [1, 2], getSettings(db), "").runs);
    db.prepare("UPDATE batches SET status = 'running' WHERE id = ?").run(batchId);
    db.prepare("UPDATE runs SET state = 'waiting', sentAt = ?, museChatUrl = 'https://muse.ai/thread/old1' WHERE bangRowId = 1").run(new Date().toISOString());
    db.prepare("UPDATE runs SET state = 'sending', sentAt = ? WHERE bangRowId = 2").run(new Date().toISOString());
    const runner = new BatchRunner(db, undefined, undefined, bot, { pollMs: 2, minuteMs: 40, bangFiles: files });
    runner.recover();
    await runner.idle();
    expect(opened).toEqual(["https://muse.ai/thread/old1"]);
    expect(sent).toEqual([]);
    expect(state(db, 1).state).toBe("done");
    expect(state(db, 2)).toMatchObject({ state: "needs_review", error: "không rõ đã gửi chưa" });
    expect(getBatch(db, batchId)).toMatchObject({ status: "paused", pauseReason: "restart" });
  });
});

describe("trang Bảng mới: Tạo video", () => {
  function app() {
    const t = setup({ videoAfter: 1 });
    const config = loadConfig({ ...FAKE_KEY_ENV, MASYS_DATA_DIR: t.dataDir });
    return { ...t, app: createApp(config, t.db, { runner: t.runner }) };
  }

  it("xem trước từng dòng: loại mẫu, ảnh đính kèm theo thứ tự, yêu cầu gửi Muse; dòng không tạo được có lý do", async () => {
    const { app: a } = app();
    const html = await (await a.request("/bang-moi/chuan-bi?ids=3,4&extra=chậm")).text();
    expect(html).toContain("Tạo video · 1 dòng");
    expect(html).toContain("Dòng 3 · Áo hai mặt");
    expect(html.indexOf("ảnh 1 · Mẫu trước")).toBeLessThan(html.indexOf("ảnh 4 · Áo sau"));
    expect(html).toContain("Yêu cầu thêm: chậm");
    expect(html).toContain("Dòng 4: Có mặt sau nên cần đủ 4 ảnh");
    expect(html).toContain("▶ Bắt đầu tạo 1 video");
  });

  it("bấm Bắt đầu → tạo lô Bảng mới và chạy; trang web khác không gửi được", async () => {
    const { app: a, db, runner, sent } = app();
    const post = (headers: Record<string, string> = {}) =>
      a.request("/bang-moi/chay", { method: "POST", headers, body: new URLSearchParams({ ids: "1,2", extra: "" }) });
    expect((await post({ "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    const res = await post({ "Sec-Fetch-Site": "same-origin" });
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!, "http://x").searchParams.get("ok")).toContain("Đang tạo video cho 2 dòng");
    await runner.idle();
    expect(sent).toHaveLength(2);
    const page = await (await a.request("/bang-moi")).text();
    expect(page).toContain("Mở trong Muse ↗");
    expect(page).toContain("Xong (2)");
    expect((db.prepare("SELECT source FROM batches").get() as { source: string }).source).toBe("bang");
  });

  it("Cài đặt: sửa và khôi phục mẫu hai mặt; thiếu {prompt} thì không lưu", async () => {
    const { app: a, db } = app();
    const post = (body: Record<string, string>) => a.request("/settings/bang-moi", { method: "POST", body: new URLSearchParams(body) });
    const bad = await post({ kind: "twoSidedTemplate", action: "save", template: "không có chỗ trống" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Mẫu phải có: {prompt}");
    expect((await post({ kind: "twoSidedTemplate", action: "save", template: "Xoay người. Prompt: {prompt}" })).status).toBe(303);
    expect(getSettings(db).twoSidedTemplate).toBe("Xoay người. Prompt: {prompt}");
    expect((await post({ kind: "twoSidedTemplate", action: "reset" })).status).toBe(303);
    expect(getSettings(db).twoSidedTemplate).toBeNull();
    expect(await (await a.request("/settings")).text()).toContain("Mẫu hai mặt");
  });
});
