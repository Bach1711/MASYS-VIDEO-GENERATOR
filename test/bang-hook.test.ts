import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BangFiles, clipProblem, dirOf, sniffClip } from "../src/bang/files.js";
import { addRow, clearRowVideo, clearStaleHookJobs, getRow, queueHook, rowFiles, setHookClip, setRowVideo } from "../src/bang/rows.js";
import { HOOK_PROMPT, insertBangBatch, insertHookOnlyBatch, planBangBatch, runsCost } from "../src/bang/run.js";
import { BotError, type WatchResult } from "../src/bot/museBot.js";
import { loadConfig } from "../src/config.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { getDailyQuota } from "../src/db/quota.js";
import { getHookSettings, getSettings, setHookOn } from "../src/db/settings.js";
import { BatchRunner, type MuseDriver } from "../src/queue/runner.js";
import { createApp } from "../src/web/app.js";
import { hookDownloadName } from "../src/web/bangMoi.js";

// Hook đầu video: CON-74 (clip trên máy), CON-137 (Muse chèn hook bằng tin thứ hai kèm clip mẫu).

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MP4 = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, 1, 2, 3, 4]);
const MP4_HOOK = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, 9, 9, 9, 9]);
const MOV = new Uint8Array([0, 0, 0, 20, ...Buffer.from("ftypqt  "), 0, 0, 2, 0]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, ...Buffer.from("B\x82\x84webm")]);
const H = { "X-Masys": "1", "Content-Type": "application/json" };
const CHAT = "https://muse.ai/thread/t1abcd";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "masys-hook-"));
  dirs.push(d);
  return d;
};

function setup() {
  const dataDir = tmp();
  const files = new BangFiles(dataDir);
  const db = openDatabase(":memory:");
  for (const id of [1, 2, 3]) addRow(db, { prompt: `dòng ${id}`, modelFront: files.saveImage(`${id}-mau-truoc`, PNG) });
  return { db, files, dataDir };
}

/**
 * Muse giả: gửi tin đầu → 1 video; tin chèn hook (reply kèm clip) → thêm 1 video khác. `hook` đổi cách Muse trả lời tin
 * chèn hook: "ok" làm video mới, "never" không làm gì, "same" làm video trùng byte với video gốc, "fail" lỗi chưa gửi.
 */
function fakeMuse(hook: "ok" | "never" | "same" | "fail" = "ok") {
  const s = { sends: 0, videos: 0, replies: [] as { text: string; tab: string; clips: string[] }[], opened: [] as string[] };
  const bot: MuseDriver = {
    isOpen: true,
    async open() {},
    async send() {
      s.sends++;
      s.videos = 1;
      return { chatUrl: CHAT };
    },
    async watch(): Promise<WatchResult> {
      return { closed: false, login: false, approval: false, videos: s.videos };
    },
    async openChat(url) {
      s.opened.push(url);
      s.videos = Math.max(s.videos, 1);
    },
    async bringToFront() {},
    async downloadVideo() {
      return { data: s.videos >= 2 && hook !== "same" ? MP4_HOOK : MP4, count: s.videos };
    },
    async reply(text, tab, clips = []) {
      if (hook === "fail") throw new BotError("ui_changed", "Không thấy chỗ đính kèm tệp của Muse", false);
      s.replies.push({ text, tab, clips });
      if (hook !== "never") s.videos++;
    },
  };
  return { s, bot };
}

const runnerFor = (db: DB, files: BangFiles, bot: MuseDriver) =>
  new BatchRunner(db, undefined, undefined, bot, { pollMs: 2, minuteMs: 40, secondMs: 1, random: () => 0, bangFiles: files });

const lastEvent = (db: DB) => (db.prepare("SELECT message FROM run_events ORDER BY id DESC LIMIT 1").get() as { message: string }).message;

describe("clip hook trên máy", () => {
  it("nhận MP4 / MOV / WEBM theo byte đầu, không nhận ảnh hay file trống", () => {
    expect(sniffClip(MP4)).toBe("mp4");
    expect(sniffClip(MOV)).toBe("mov");
    expect(sniffClip(WEBM)).toBe("webm");
    expect(sniffClip(PNG)).toBeNull();
    expect(clipProblem(new Uint8Array())).toBe("File trống.");
    expect(clipProblem(PNG)).toBe("Chỉ nhận clip MP4, MOV, WEBM hoặc MKV.");
    expect(clipProblem(MP4)).toBeNull();
  });

  it("lưu vào tep\\hook, tên riêng; tính vào dung lượng; xoá theo đúng thư mục", () => {
    const { files, dataDir } = setup();
    const name = files.saveClip(4, MOV);
    expect(name).toMatch(/^4-hookclip-[a-z0-9]+\.mov$/);
    expect(dirOf(name)).toBe(path.join("tep", "hook"));
    expect(dirOf("4-hook-abc.mp4")).toBe(path.join("tep", "video"));
    expect(fs.existsSync(path.join(dataDir, "tep", "hook", name))).toBe(true);
    expect(files.clipPath(name)).toBeTruthy();
    expect(files.clipPath("../data.db")).toBeUndefined();
    expect(files.fileBytes(name)).toBe(MOV.length);
    expect(files.usedBytes()).toBe(3 * PNG.length + MOV.length);
    files.removeAny(name);
    expect(files.clipPath(name)).toBeUndefined();
    const hv = files.saveHookVideo(4, MP4);
    expect(hv).toMatch(/^4-hook-[a-z0-9]+\.mp4$/);
    expect(fs.readFileSync(files.videoPath(hv)!)).toEqual(Buffer.from(MP4));
  });

  it("video mới về thì bỏ bản có hook cũ; 🗑 video xoá cả bản có hook; xoá dòng xoá cả clip", () => {
    const { db } = setup();
    setHookClip(db, 1, "1-hookclip-a.mp4");
    setRowVideo(db, 1, "1-video-a.mp4", 10);
    db.prepare("UPDATE bang_rows SET hookVideoFile = '1-hook-a.mp4', hookError = 'x' WHERE id = 1").run();
    expect(rowFiles(getRow(db, 1)!)).toEqual(["1-mau-truoc-" + getRow(db, 1)!.modelFront!.split("-mau-truoc-")[1], "1-video-a.mp4", "1-hookclip-a.mp4", "1-hook-a.mp4"]);
    expect(setRowVideo(db, 1, "1-video-b.mp4", 10)).toEqual(["1-video-a.mp4", "1-hook-a.mp4"]);
    expect(getRow(db, 1)).toMatchObject({ videoFile: "1-video-b.mp4", hookVideoFile: null, hookError: null, hookClip: "1-hookclip-a.mp4" });
    db.prepare("UPDATE bang_rows SET hookVideoFile = '1-hook-b.mp4' WHERE id = 1").run();
    expect(clearRowVideo(db, 1)).toEqual(["1-video-b.mp4", "1-hook-b.mp4"]);
  });
});

describe("Tạo video có hook (CON-137): kiểm tra trước khi chạy", () => {
  it("thiếu clip thì dòng không chạy; đủ thì lượt ghi đúng câu nhờ chèn hook và clip; mỗi dòng có hook tính 2 lượt", () => {
    const { db, files } = setup();
    setHookClip(db, 1, files.saveClip(1, MP4));
    const s = getSettings(db);
    const exists = (n: string) => !!files.clipPath(n);
    const plan = planBangBatch(db, [1, 2], s, "", { clipExists: exists });
    expect(plan.runs.map((r) => [r.row.id, r.hookText])).toEqual([[1, HOOK_PROMPT]]);
    expect(plan.rejected).toEqual([{ id: 2, why: "chưa có clip hook (bấm + ở cột Hook)" }]);
    expect(HOOK_PROMPT).toBe("Đây là video mẫu có hook, hãy xem video và tạo hook y hệt video mẫu trong video bạn vừa tạo");
    expect(runsCost(plan.runs)).toBe(2);
    expect(runsCost(planBangBatch(db, [1, 2], s, "").runs)).toBe(2);
    const batchId = insertBangBatch(db, "", plan.runs);
    const run = db.prepare("SELECT hookText, inputSnapshot FROM runs WHERE batchId = ?").get(batchId) as { hookText: string; inputSnapshot: string };
    expect(run.hookText).toBe(HOOK_PROMPT);
    expect(JSON.parse(run.inputSnapshot).hookClip).toBe(getRow(db, 1)!.hookClip);

    // Clip đã bị xoá khỏi máy: báo thiếu clip. Không thêm hook: như cũ.
    db.prepare("UPDATE batches SET status = 'done' WHERE id = ?").run(batchId);
    db.prepare("UPDATE runs SET state = 'done' WHERE batchId = ?").run(batchId);
    files.removeAny(getRow(db, 1)!.hookClip);
    expect(planBangBatch(db, [1], s, "", { clipExists: exists }).rejected[0]!.why).toBe("chưa có clip hook (bấm + ở cột Hook)");
    expect(planBangBatch(db, [3], s, "").runs[0]!.hookText).toBeUndefined();
  });
});

describe("hàng đợi: Muse chèn hook bằng tin thứ hai (CON-137)", () => {
  it("video về → gửi clip mẫu + câu trong cùng cuộc trò chuyện → tải video có hook; bản gốc giữ; tính 2 lượt", async () => {
    const { db, files } = setup();
    setHookClip(db, 1, files.saveClip(1, MP4));
    const { s, bot } = fakeMuse("ok");
    const runner = runnerFor(db, files, bot);
    runner.start(insertBangBatch(db, "", planBangBatch(db, [1], getSettings(db), "", {}).runs));
    await runner.idle();
    expect(s.sends).toBe(1);
    expect(s.replies).toHaveLength(1);
    expect(s.replies[0]!.text).toBe(HOOK_PROMPT);
    expect(s.replies[0]!.clips).toEqual([files.clipPath(getRow(db, 1)!.hookClip!)]);
    const row = getRow(db, 1)!;
    expect(row.hookJob).toBeNull();
    expect(row.hookError).toBeNull();
    expect(fs.readFileSync(files.videoPath(row.videoFile!)!)).toEqual(Buffer.from(MP4));
    expect(fs.readFileSync(files.videoPath(row.hookVideoFile!)!)).toEqual(Buffer.from(MP4_HOOK));
    const run = db.prepare("SELECT state, anhPhase, anhBaseline, anhBackAt FROM runs").get() as Record<string, unknown>;
    expect(run).toMatchObject({ state: "done", anhPhase: "hook", anhBaseline: 1 });
    expect(run.anhBackAt).toBeTruthy();
    expect(lastEvent(db)).toBe("Đã tải video có hook về máy (1 KB)");
    expect(getDailyQuota(db).used).toBe(2);
    const msgs = (db.prepare("SELECT message FROM run_events ORDER BY id").all() as { message: string }[]).map((e) => e.message);
    expect(msgs).toContain("Đã nhờ Muse chèn hook, chờ video có hook trong cuộc trò chuyện");

    // Lô không hook: không gửi tin thứ hai.
    const plain = fakeMuse("ok");
    const r2 = runnerFor(db, files, plain.bot);
    r2.start(insertBangBatch(db, "", planBangBatch(db, [2], getSettings(db), "").runs));
    await r2.idle();
    expect(plain.s.replies).toHaveLength(0);
    expect(getRow(db, 2)).toMatchObject({ hookVideoFile: null, hookJob: null });
    expect(getDailyQuota(db).used).toBe(3);
  });

  it("chưa gửi được tin chèn hook → Cần xem, báo lỗi ở ô Video, video gốc giữ, không tính lượt chèn", async () => {
    const { db, files } = setup();
    setHookClip(db, 1, files.saveClip(1, MP4));
    const { bot } = fakeMuse("fail");
    const runner = runnerFor(db, files, bot);
    runner.start(insertBangBatch(db, "", planBangBatch(db, [1], getSettings(db), "", {}).runs));
    await runner.idle();
    const row = getRow(db, 1)!;
    expect(row.videoFile).toBeTruthy();
    expect(row.hookVideoFile).toBeNull();
    expect(row.hookJob).toBeNull();
    expect(row.hookError).toContain("Chưa gửi được tin chèn hook");
    expect((db.prepare("SELECT state FROM runs").get() as { state: string }).state).toBe("needs_review");
    expect(getDailyQuota(db).used).toBe(1);
  });

  it("Muse không làm video có hook → hết giờ thì Cần xem; video trùng bản gốc thì không nhận", async () => {
    const { db, files } = setup();
    setHookClip(db, 1, files.saveClip(1, MP4));
    db.prepare("UPDATE settings SET timeoutMinutes = 1").run();
    const never = fakeMuse("never");
    const r1 = runnerFor(db, files, never.bot);
    r1.start(insertBangBatch(db, "", planBangBatch(db, [1], getSettings(db), "", {}).runs));
    await r1.idle();
    expect(getRow(db, 1)).toMatchObject({ hookVideoFile: null, hookJob: null, hookError: "quá thời gian chờ Muse chèn hook" });

    const same = fakeMuse("same");
    const r2 = runnerFor(db, files, same.bot);
    r2.start(insertBangBatch(db, "", planBangBatch(db, [1], getSettings(db), "", {}).runs));
    await r2.idle();
    expect(getRow(db, 1)).toMatchObject({ hookVideoFile: null, hookError: "không tải được video có hook từ Muse" });
    expect(lastEvent(db)).toContain("video mới nhất vẫn là video chưa có hook");
  });

  it("Ghép lại hook: mở lại cuộc trò chuyện cũ, chỉ gửi tin chèn hook (không gửi lại yêu cầu tạo video), tính 1 lượt", async () => {
    const { db, files } = setup();
    const exists = (n: string) => !!files.clipPath(n);
    expect(insertHookOnlyBatch(db, 1, { clipExists: exists })).toEqual({ why: "Dòng 1 chưa có video." });
    setRowVideo(db, 1, files.saveVideo(1, MP4), MP4.length);
    expect(insertHookOnlyBatch(db, 1, { clipExists: exists })).toEqual({ why: "Dòng 1 chưa có clip hook: bấm + ở cột Hook để chọn." });
    setHookClip(db, 1, files.saveClip(1, MP4));
    expect(insertHookOnlyBatch(db, 1, { clipExists: exists })).toEqual({ why: "Không còn cuộc trò chuyện Muse của video dòng 1: bấm Tạo video (có tích Thêm hook) để làm lại." });

    // Video cũ đã làm trong một cuộc trò chuyện.
    const old = insertBangBatch(db, "", planBangBatch(db, [1], getSettings(db), "").runs);
    db.prepare("UPDATE runs SET state = 'done', museChatUrl = ? WHERE batchId = ?").run(CHAT, old);
    db.prepare("UPDATE batches SET status = 'done' WHERE id = ?").run(old);
    const made = insertHookOnlyBatch(db, 1, { clipExists: exists });
    expect(made).toHaveProperty("batchId");
    const { s, bot } = fakeMuse("ok");
    const runner = runnerFor(db, files, bot);
    const before = getDailyQuota(db).used;
    runner.start((made as { batchId: number }).batchId);
    await runner.idle();
    expect(s.sends).toBe(0);
    expect(s.opened).toEqual([CHAT]);
    expect(s.replies.map((r) => r.text)).toEqual([HOOK_PROMPT]);
    expect(getRow(db, 1)!.hookVideoFile).toBeTruthy();
    expect(getDailyQuota(db).used).toBe(before + 1);
  });

  it("tool mở lại: dòng còn dấu đang chèn mà không còn lượt chạy thì báo lỗi để Ghép lại hook", () => {
    const { db } = setup();
    setRowVideo(db, 1, "1-video-a.mp4", 10);
    queueHook(db, 1, "Câu cũ của bộ ghép trên máy");
    expect(clearStaleHookJobs(db)).toBe(1);
    expect(getRow(db, 1)).toMatchObject({ hookJob: null, hookError: "chưa chèn được hook; bấm Ghép lại hook" });
  });
});

describe("Bảng: ô Thêm hook, cột Hook, Ghép lại hook", () => {
  function web() {
    const t = setup();
    const app = createApp(loadConfig({ MASYS_DATA_DIR: t.dataDir }), t.db, {});
    const post = (url: string, body: unknown) => app.request(url, { method: "POST", headers: H, body: JSON.stringify(body) });
    return { ...t, app, post };
  }

  it("tích Thêm hook → cột Hook chỉ còn clip, không còn câu hook / Clip có chữ sẵn", async () => {
    const { app, post, db } = web();
    let html = await (await app.request("/")).text();
    expect(html).toContain('id="hookOn"');
    expect(html).not.toContain("<th title=");
    expect((await app.request("/bang-moi/hook-chung", { method: "POST", body: JSON.stringify({ on: true }) })).status).toBe(403);
    expect(await (await post("/bang-moi/hook-chung", { on: true })).json()).toEqual({ ok: true });
    expect(getHookSettings(db).on).toBe(true);
    html = await (await app.request("/")).text();
    expect(html).toContain(">Hook</th>");
    expect(html).toContain("clip hook mẫu");
    expect(html).not.toContain('id="hookDay"');
    expect(html).not.toContain("hooktext-edit");
    expect(html).not.toContain("Clip có chữ sẵn");
    expect(html).not.toContain("câu chung hôm nay");
    expect((await post("/bang-moi/cau-hook", { row: 1, text: "x" })).status).toBe(404);
  });

  it("chọn / bỏ clip hook; xem trước Tạo video có hook báo dòng thiếu clip và tính 2 lượt mỗi dòng", async () => {
    const { app, post, db, files } = web();
    setHookOn(db, true);
    const fd = new FormData();
    fd.append("row", "1");
    fd.append("file", new File([PNG], "a.png"));
    expect(await (await app.request("/bang-moi/clip-hook", { method: "POST", headers: { "X-Masys": "1" }, body: fd })).json()).toEqual({
      ok: false,
      message: "Chỉ nhận clip MP4, MOV, WEBM hoặc MKV.",
    });
    const ok = new FormData();
    ok.append("row", "1");
    ok.append("file", new File([MP4], "hook.mp4"));
    const r = (await (await app.request("/bang-moi/clip-hook", { method: "POST", headers: { "X-Masys": "1" }, body: ok })).json()) as { ok: boolean; name: string };
    expect(r.ok).toBe(true);
    expect(getRow(db, 1)!.hookClip).toBe(r.name);
    expect((await app.request(`/bang-moi/clip-hook/${r.name}`)).headers.get("content-type")).toBe("video/mp4");

    const html = await (await app.request("/bang-moi/chuan-bi?ids=1,2&hook=1")).text();
    expect(html).toContain("Tạo video · 1 dòng");
    expect(html).toContain("Dòng 2: chưa có clip hook (bấm + ở cột Hook)");
    expect(html).toContain(HOOK_PROMPT);
    expect(html).toContain("tính 2 lượt");
    // CON-136: mở từ Bảng (không có tham số hook) thì theo ô Thêm hook trên Bảng; bỏ tích trên trang (hook=0) thì chạy không hook.
    const fromBoard = await (await app.request("/bang-moi/chuan-bi?ids=1,2")).text();
    expect(fromBoard).toContain("Tạo video · 1 dòng");
    expect(fromBoard).toMatch(/<input type="checkbox" name="hook" value="1" checked=""/);
    expect(await (await app.request("/bang-moi/chuan-bi?ids=1,2&hook=0")).text()).toContain("Tạo video · 2 dòng");
    expect(await (await app.request("/bang-moi/chuan-bi?ids=1,2&hook=0&hook=1")).text()).toContain("Tạo video · 1 dòng");

    // Còn 1 lượt: dòng có hook cần 2 lượt → báo không đủ.
    db.prepare("UPDATE settings SET dailyVideoLimit = 1").run();
    expect(await (await app.request("/bang-moi/chuan-bi?ids=1&hook=1")).text()).toContain("1 dòng đang chọn cần 2 lượt");
    expect(await (await app.request("/bang-moi/chuan-bi?ids=1&hook=0")).text()).not.toContain("đang chọn cần");

    expect(await (await post("/bang-moi/bo-clip-hook", { row: 1 })).json()).toEqual({ ok: true });
    expect(getRow(db, 1)!.hookClip).toBeNull();
    expect(files.clipPath(r.name)).toBeUndefined();
  });

  it("Muse đang chèn hook: chưa cho xem / tải bản gốc; có bản có hook thì chỉ hiện bản đó; Ghép lại hook báo lý do", async () => {
    const { app, post, db, files } = web();
    setHookOn(db, true);
    expect(await (await post("/bang-moi/ghep-hook", { row: 1 })).json()).toEqual({ ok: false, message: "Bot chưa sẵn sàng." });
    setRowVideo(db, 1, files.saveVideo(1, MP4), MP4.length, "2026-11-02T08:30:00");
    setHookClip(db, 1, files.saveClip(1, MP4));
    const orig = getRow(db, 1)!.videoFile!;
    queueHook(db, 1, "muse");
    const busyHtml = await (await app.request("/")).text();
    expect(busyHtml).toContain("Muse đang chèn hook…");
    expect(busyHtml).not.toContain(`/bang-moi/video/${orig}`);
    expect(busyHtml.match(/<tr data-row="1"[^>]*>/)![0]).not.toContain("data-dl=");

    const hv = files.saveHookVideo(1, MP4_HOOK);
    db.prepare("UPDATE bang_rows SET hookJob = NULL, hookVideoFile = ?, hookVideoBytes = ? WHERE id = 1").run(hv, MP4_HOOK.length);
    const html = await (await app.request("/")).text();
    expect(html).toContain("Có hook<");
    expect(html).toContain("Ghép lại hook");
    expect(html).toContain(`data-src="/bang-moi/video/${hv}"`);
    expect(html).toContain(`href="/bang-moi/video/${hv}?tai=1" download="Video 01.mp4"`);
    expect(html).not.toContain(`/bang-moi/video/${orig}`);
    expect(files.videoPath(orig)).toBeTruthy();
    expect(html).toContain('<main class="wide">');
    expect(html.match(/<tr data-row="1"[^>]*>/)![0]).toContain(`data-dl="/bang-moi/video/${hv}?tai=1" data-dl-name="Video 01.mp4"`);
    expect(hookDownloadName(1, "2026-11-02T08:30:00")).toBe("MASYS_1_20261102-0830_hook.mp4");

    db.prepare("UPDATE bang_rows SET hookError = 'quá thời gian chờ Muse chèn hook' WHERE id = 1").run();
    expect(await (await app.request("/")).text()).toContain("Chèn hook lỗi: quá thời gian chờ Muse chèn hook");

    // Xoá dòng: xoá cả clip hook và bản có hook.
    const clip = getRow(db, 1)!.hookClip!;
    await post("/bang-moi/xoa", { rows: [1] });
    expect(files.clipPath(clip)).toBeUndefined();
    expect(files.videoPath(hv)).toBeUndefined();
  });

  it("Ghép lại hook từ Bảng: tạo lô một dòng chạy ngay; không còn cuộc trò chuyện thì báo tạo lại video", async () => {
    const t = setup();
    const { s, bot } = fakeMuse("ok");
    const runner = runnerFor(t.db, t.files, bot);
    const app = createApp(loadConfig({ MASYS_DATA_DIR: t.dataDir }), t.db, { runner });
    const post = (url: string, body: unknown) => app.request(url, { method: "POST", headers: H, body: JSON.stringify(body) });
    setRowVideo(t.db, 1, t.files.saveVideo(1, MP4), MP4.length);
    setHookClip(t.db, 1, t.files.saveClip(1, MP4));
    expect(((await (await post("/bang-moi/ghep-hook", { row: 1 })).json()) as { message: string }).message).toContain("bấm Tạo video (có tích Thêm hook) để làm lại");
    const old = insertBangBatch(t.db, "", planBangBatch(t.db, [1], getSettings(t.db), "").runs);
    t.db.prepare("UPDATE runs SET state = 'done', museChatUrl = ? WHERE batchId = ?").run(CHAT, old);
    t.db.prepare("UPDATE batches SET status = 'done' WHERE id = ?").run(old);
    const res = (await (await post("/bang-moi/ghep-hook", { row: 1 })).json()) as { ok: boolean; message: string };
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Đang nhờ Muse chèn lại hook cho dòng 1");
    await runner.idle();
    expect(s.replies).toHaveLength(1);
    expect(getRow(t.db, 1)!.hookVideoFile).toBeTruthy();
  });
});
