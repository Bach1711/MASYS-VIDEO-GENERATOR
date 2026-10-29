import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BangFiles, sniffVideo } from "../src/bang/files.js";
import { addRow, getRow, labelOf, setRowVideo } from "../src/bang/rows.js";
import { estimateText, insertBangBatch, planBangBatch } from "../src/bang/run.js";
import { BotError, type WatchResult } from "../src/bot/museBot.js";
import { getBatch } from "../src/batch/create.js";
import { loadConfig } from "../src/config.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { getSettings } from "../src/db/settings.js";
import { BatchRunner, type MuseDriver } from "../src/queue/runner.js";
import { createApp } from "../src/web/app.js";
import { downloadName } from "../src/web/bangMoi.js";

// Tải video về máy, xem / tải / xoá / dọn trên Bảng (CON-72, spec v6.0 mục 17.5 bước 6–8, 17.8, 17.9, D23, D26).

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MP4 = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, 1, 2, 3, 4]);
const H = { "X-Masys": "1", "Content-Type": "application/json" };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup(o: { download?: "ok" | "fail" | "notvideo"; videoCount?: number; key?: boolean; lateUrl?: boolean } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-bangvideo-"));
  dirs.push(dataDir);
  const files = new BangFiles(dataDir);
  const db = openDatabase(":memory:");
  const img = (id: number) => files.saveImage(`${id}-mau-truoc`, PNG);
  for (const id of [1, 2, 3]) addRow(db, { prompt: `dòng ${id}`, modelFront: img(id) });
  const sent: string[] = [];
  const opened: string[] = [];
  const downloads = { n: 0 };
  let polls = 0;
  const bot: MuseDriver = {
    isOpen: true,
    async open() {},
    async send(text: string) {
      sent.push(text);
      polls = 0;
      // lateUrl: Muse chưa đổi /thread/new sang link riêng lúc bot gửi xong (ghi nhận 29/10/2026).
      return { chatUrl: o.lateUrl ? "" : `https://muse.ai/thread/t${sent.length}abcd` };
    },
    async watch(): Promise<WatchResult> {
      polls++;
      if (o.lateUrl) {
        const url = polls >= 2 ? `https://muse.ai/thread/late${sent.length}xyz` : "https://muse.ai/thread/new";
        return { closed: false, login: false, approval: false, videos: polls >= 3 ? 1 : 0, url };
      }
      return { closed: false, login: false, approval: false, videos: polls >= 1 ? 1 : 0 };
    },
    async openChat(url: string) {
      opened.push(url);
    },
    async bringToFront() {},
    async downloadVideo() {
      downloads.n++;
      if (o.download === "fail") throw new BotError("ui_changed", "Chưa tải được video: video chưa có nguồn", true);
      return { data: o.download === "notvideo" ? PNG : MP4, count: o.videoCount ?? 1 };
    },
  };
  const runner = new BatchRunner(db, undefined, undefined, bot, { pollMs: 2, minuteMs: 40, secondMs: 1, random: () => 0, bangFiles: files });
  const config = loadConfig({ MASYS_DATA_DIR: dataDir, ...(o.key === false ? {} : {}) });
  const app = createApp(config, db, { runner });
  const run = async (ids: number[]) => {
    const batchId = insertBangBatch(db, "", planBangBatch(db, ids, getSettings(db), "").runs);
    runner.start(batchId);
    await runner.idle();
    return batchId;
  };
  return { db, files, dataDir, runner, app, sent, opened, downloads, run };
}

const lastRun = (db: DB, row: number) =>
  db.prepare("SELECT id, state, error, museChatUrl FROM runs WHERE bangRowId = ? ORDER BY id DESC").get(row) as Record<string, string | number | null>;
const events = (db: DB, runId: number) => (db.prepare("SELECT message FROM run_events WHERE runId = ? ORDER BY id").all(runId) as { message: string }[]).map((e) => e.message);
const post = (app: ReturnType<typeof createApp>, url: string, body: unknown) => app.request(url, { method: "POST", headers: H, body: JSON.stringify(body) });

describe("tải video về máy (17.5 bước 6–8)", () => {
  it("video hiện trong chat → Đang tải → Xong, file MP4 nằm trong tep\\video và gắn vào dòng", async () => {
    const { db, files, dataDir, run, downloads } = setup();
    const batchId = await run([1]);
    const row = getRow(db, 1)!;
    expect(row.videoFile).toMatch(/^1-video-[a-z0-9]+\.mp4$/);
    expect(row.videoBytes).toBe(MP4.length);
    expect(fs.readFileSync(path.join(dataDir, "tep", "video", row.videoFile!))).toEqual(Buffer.from(MP4));
    expect(files.videoPath(row.videoFile!)).toBeTruthy();
    expect(labelOf(row).label).toBe("done");
    const r = lastRun(db, 1);
    expect(r.state).toBe("done");
    expect(events(db, r.id as number)).toEqual(expect.arrayContaining(["Muse đã gửi video trong cuộc trò chuyện; đang tải về máy", "Đã tải video về máy (1 KB)"]));
    expect(downloads.n).toBe(1);
    expect(getBatch(db, batchId)!.status).toBe("done");
  });

  it("cuộc trò chuyện có nhiều video → lấy video mới nhất, ghi chú trong nhật ký", async () => {
    const { db, run } = setup({ videoCount: 2 });
    await run([1]);
    expect(events(db, lastRun(db, 1).id as number).at(-1)).toBe("Đã tải video về máy (1 KB); cuộc trò chuyện có 2 video, lấy video mới nhất");
  });

  it("tải lỗi 3 lần / file không phải video → Cần xem, giữ link cuộc trò chuyện, không gửi lại", async () => {
    const fail = setup({ download: "fail" });
    await fail.run([1, 2]);
    expect(fail.downloads.n).toBe(6);
    expect(fail.sent).toHaveLength(2);
    expect(lastRun(fail.db, 1)).toMatchObject({ state: "needs_review", error: "không tải được video", museChatUrl: "https://muse.ai/thread/t1abcd" });
    expect(getRow(fail.db, 1)!.videoFile).toBeNull();
    expect(labelOf(getRow(fail.db, 1)!).label).toBe("review");

    const bad = setup({ download: "notvideo" });
    await bad.run([1]);
    expect(lastRun(bad.db, 1)).toMatchObject({ state: "needs_review", error: "không tải được video" });
    expect(fs.existsSync(path.join(bad.dataDir, "tep", "video")) ? fs.readdirSync(path.join(bad.dataDir, "tep", "video")) : []).toEqual([]);
  });

  it("tool tắt lúc đang tải: mở lại đúng cuộc trò chuyện và tải tiếp, không gửi lại", async () => {
    const t = setup();
    const batchId = insertBangBatch(t.db, "", planBangBatch(t.db, [1], getSettings(t.db), "").runs);
    t.db.prepare("UPDATE batches SET status = 'running' WHERE id = ?").run(batchId);
    t.db.prepare("UPDATE runs SET state = 'downloading', sentAt = ?, museChatUrl = 'https://muse.ai/thread/old1'").run(new Date().toISOString());
    t.runner.recover();
    await t.runner.idle();
    expect(t.opened).toEqual(["https://muse.ai/thread/old1"]);
    expect(t.sent).toEqual([]);
    expect(lastRun(t.db, 1).state).toBe("done");
    expect(getRow(t.db, 1)!.videoFile).toBeTruthy();
  });

  it("Muse đổi sang link riêng chậm: không lưu /thread/new, lấy link thật trong lúc chờ video", async () => {
    const { db, run } = setup({ lateUrl: true });
    await run([1]);
    const r = lastRun(db, 1);
    expect(r).toMatchObject({ state: "done", museChatUrl: "https://muse.ai/thread/late1xyz" });
    expect(events(db, r.id as number)).toEqual(
      expect.arrayContaining(["Đã gửi Muse, chờ video; Muse chưa đổi sang link riêng của cuộc trò chuyện", "Đã có link cuộc trò chuyện Muse"]),
    );
  });

  it("tool mở lại mà chỉ có link /thread/new (bản cũ lưu nhầm) → Cần xem, không mở trang trống, không gửi lại", async () => {
    const t = setup();
    const batchId = insertBangBatch(t.db, "", planBangBatch(t.db, [1], getSettings(t.db), "").runs);
    t.db.prepare("UPDATE batches SET status = 'running' WHERE id = ?").run(batchId);
    t.db.prepare("UPDATE runs SET state = 'waiting', sentAt = ?, museChatUrl = 'https://muse.ai/thread/new'").run(new Date().toISOString());
    t.runner.recover();
    await t.runner.idle();
    expect(t.opened).toEqual([]);
    expect(t.sent).toEqual([]);
    expect(lastRun(t.db, 1)).toMatchObject({ state: "needs_review", error: "không rõ đã gửi chưa" });
  });

  it("nhận ra MP4 theo hộp ftyp; tạo lại video thì file cũ bị xoá", async () => {
    expect(sniffVideo(MP4)).toBe(true);
    expect(sniffVideo(PNG)).toBe(false);
    const { db, files, run } = setup();
    await run([1]);
    const first = getRow(db, 1)!.videoFile!;
    await run([1]);
    const second = getRow(db, 1)!.videoFile!;
    expect(second).not.toBe(first);
    expect(files.videoPath(first)).toBeUndefined();
    expect(files.videoPath(second)).toBeTruthy();
  });
});

describe("ô Video, xoá, dọn (17.2, 17.9, D26)", () => {
  it("▶ xem / ⬇ tải với tên MASYS_<dòng>_<giờ>.mp4; tên lạ không phục vụ", async () => {
    const { app, db, run } = setup();
    await run([1]);
    const row = getRow(db, 1)!;
    const html = await (await app.request("/")).text();
    expect(html).toContain(`data-src="/bang-moi/video/${row.videoFile}"`);
    expect(html).toContain(`download="${downloadName(1, row.videoAt)}"`);
    const v = await app.request(`/bang-moi/video/${row.videoFile}`);
    expect(v.headers.get("content-type")).toBe("video/mp4");
    expect(new Uint8Array(await v.arrayBuffer())).toEqual(MP4);
    const dl = await app.request(`/bang-moi/video/${row.videoFile}?tai=1`);
    expect(dl.headers.get("content-disposition")).toBe(`attachment; filename="${downloadName(1, row.videoAt)}"`);
    expect((await app.request("/bang-moi/video/..%2Fdata.db")).status).toBe(404);
    expect((await app.request(`/bang-moi/video/${row.modelFront}`)).status).toBe(404);
    expect(downloadName(7, "2026-10-29T13:05:00")).toBe("MASYS_7_20261029-1305.mp4");
  });

  it("🗑 xoá video của dòng (giữ ảnh, prompt); xoá dòng cùng file; số dòng không dùng lại; thiếu header riêng bị chặn", async () => {
    const { app, db, files, run } = setup();
    await run([1, 2]);
    const v1 = getRow(db, 1)!.videoFile!;
    expect((await app.request("/bang-moi/xoa-video", { method: "POST", body: JSON.stringify({ row: 1 }) })).status).toBe(403);
    expect(await (await post(app, "/bang-moi/xoa-video", { row: 1 })).json()).toEqual({ ok: true });
    expect(getRow(db, 1)).toMatchObject({ videoFile: null, prompt: "dòng 1" });
    expect(files.videoPath(v1)).toBeUndefined();

    const r2 = getRow(db, 2)!;
    expect(await (await post(app, "/bang-moi/xoa", { rows: [2, 3] })).json()).toEqual({ ok: true, message: "Đã xoá 2 dòng." });
    expect(getRow(db, 2)).toBeUndefined();
    expect(files.videoPath(r2.videoFile!)).toBeUndefined();
    expect(files.imagePath(r2.modelFront!)).toBeUndefined();
    expect(addRow(db, {})).toBe(4);
  });

  it("dòng đang tạo video không xoá được", async () => {
    const { app, db } = setup();
    insertBangBatch(db, "", planBangBatch(db, [1], getSettings(db), "").runs);
    expect((await post(app, "/bang-moi/xoa-video", { row: 1 })).status).toBe(409);
    expect(await (await post(app, "/bang-moi/xoa", { rows: [1, 2] })).json()).toEqual({ ok: true, message: "Đã xoá 1 dòng. Bỏ qua 1 dòng đang tạo video." });
    expect(getRow(db, 1)).toBeTruthy();
  });

  it("Dọn tất cả: hỏi lại với số dòng và dung lượng; mặc định chỉ dòng Xong, tích thêm thì cả dòng chưa tạo; không đụng dòng đang chạy", async () => {
    const { app, db, run } = setup();
    await run([1]);
    insertBangBatch(db, "", planBangBatch(db, [3], getSettings(db), "").runs);
    const preview = await (await app.request("/bang-moi/don")).text();
    expect(preview).toContain("Sẽ xoá <strong>1 dòng</strong>, giải phóng <strong>1 KB</strong>");
    expect(preview).toContain("1 dòng đang tạo video: không bao giờ bị xoá.");
    expect(await (await app.request("/bang-moi/don?ca=1")).text()).toContain("Sẽ xoá <strong>2 dòng</strong>");
    expect((await app.request("/bang-moi/don", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" }, body: new URLSearchParams({}) })).status).toBe(403);
    const r = await app.request("/bang-moi/don", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" }, body: new URLSearchParams({ ca: "1" }) });
    expect(new URL(r.headers.get("location")!, "http://x").searchParams.get("ok")).toBe("Đã xoá 2 dòng, giải phóng 1 KB.");
    expect([1, 2, 3].map((id) => !!getRow(db, id))).toEqual([false, false, true]);
  });

  it("ước lượng thời gian lô theo thời gian gần đây + nghỉ", () => {
    const { db } = setup();
    const s = { pauseMinSec: 0, pauseMaxSec: 0 };
    expect(estimateText(db, 3, s)).toBe("khoảng 15 phút");
    expect(estimateText(db, 24, s)).toBe("khoảng 2 giờ");
    expect(estimateText(db, 20, { pauseMinSec: 20, pauseMaxSec: 60 })).toBe("khoảng 2 giờ");
    insertBangBatch(db, "", planBangBatch(db, [1], getSettings(db), "").runs);
    db.prepare("UPDATE runs SET state = 'done', sentAt = '2026-10-29T10:00:00Z', doneAt = '2026-10-29T10:10:00Z'").run();
    expect(estimateText(db, 3, s)).toBe("khoảng 30 phút");
  });
});

describe("màn hình chính và Bắt đầu nhanh 2 bước (17.8)", () => {
  it("chưa có khoá Google vẫn mở Bảng; Bảng hiện bước còn thiếu; /bat-dau có đủ 2 bước", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-bangvideo-"));
    dirs.push(dataDir);
    const db = openDatabase(":memory:");
    const app = createApp(loadConfig({ MASYS_DATA_DIR: dataDir }), db);
    const home = await (await app.request("/")).text();
    expect(home).toContain("Còn 2 bước nữa là tạo được video");
    expect(home).toContain('action="/bat-dau/mo-muse"');
    const start = await (await app.request("/bat-dau")).text();
    expect(start).toContain("Bắt đầu trong 2 bước (0/2 xong)");
    expect(start).toContain('href="/bat-dau/sheet"');
    addRow(db, {});
    db.prepare("UPDATE settings SET museReadyAt = ?").run(new Date().toISOString());
    expect(await (await app.request("/")).text()).not.toContain('aria-label="Bắt đầu nhanh"');
  });
});
