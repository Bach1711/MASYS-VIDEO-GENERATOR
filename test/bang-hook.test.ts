import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BangFiles, clipProblem, dirOf, sniffClip } from "../src/bang/files.js";
import { captionHtml, findFfmpeg, hookFilter, hookLayout, HookMerger, parseProbe, probe, type CaptionRenderer } from "../src/bang/hook.js";
import { addRow, clearRowVideo, getRow, hookTextFor, queueHook, rowFiles, setHookClip, setHookText, setRowVideo } from "../src/bang/rows.js";
import { insertBangBatch, planBangBatch } from "../src/bang/run.js";
import type { WatchResult } from "../src/bot/museBot.js";
import { loadConfig } from "../src/config.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { getHookSettings, getSettings, localDay, setHookDayText, setHookOn } from "../src/db/settings.js";
import { BatchRunner, type MuseDriver } from "../src/queue/runner.js";
import { createApp } from "../src/web/app.js";
import { hookDownloadName } from "../src/web/bangMoi.js";

// Hook đầu video (CON-74, D30).

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MP4 = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, 1, 2, 3, 4]);
const MOV = new Uint8Array([0, 0, 0, 20, ...Buffer.from("ftypqt  "), 0, 0, 2, 0]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, ...Buffer.from("B\x82\x84webm")]);
const H = { "X-Masys": "1", "Content-Type": "application/json" };
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
  });
});

describe("dữ liệu hook của dòng", () => {
  it("câu riêng thắng câu chung; câu chung chỉ dùng trong ngày điền", () => {
    const { db } = setup();
    expect(getHookSettings(db)).toEqual({ on: false, dayText: "" });
    setHookOn(db, true);
    setHookDayText(db, "  I want this shirt but I'm broke...  ", new Date(2026, 10, 2, 9));
    expect(getHookSettings(db, new Date(2026, 10, 2, 23))).toEqual({ on: true, dayText: "I want this shirt but I'm broke..." });
    expect(getHookSettings(db, new Date(2026, 10, 3, 8)).dayText).toBe("");
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    setHookText(db, 1, "Câu riêng");
    setHookText(db, 2, "   ");
    expect(hookTextFor(getRow(db, 1)!, "Chung")).toBe("Câu riêng");
    expect(hookTextFor(getRow(db, 2)!, "Chung")).toBe("Chung");
    expect(getRow(db, 2)!.hookText).toBeNull();
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

describe("Tạo video có hook: kiểm tra trước khi chạy", () => {
  it("thiếu clip / thiếu câu thì dòng không chạy, kèm lý do; đủ thì lượt ghi câu hook", () => {
    const { db, files } = setup();
    setHookClip(db, 1, files.saveClip(1, MP4));
    setHookClip(db, 2, files.saveClip(2, MP4));
    setHookText(db, 2, "Câu riêng dòng 2");
    const s = getSettings(db);
    const exists = (n: string) => !!files.clipPath(n);

    const noDay = planBangBatch(db, [1, 2, 3], s, "", { dayText: "", clipExists: exists });
    expect(noDay.runs.map((r) => [r.row.id, r.hookText, r.hookOwn])).toEqual([[2, "Câu riêng dòng 2", true]]);
    expect(noDay.rejected).toEqual([
      { id: 1, why: "chưa có câu hook (điền câu hook chung hôm nay hoặc câu riêng của dòng)" },
      { id: 3, why: "chưa có clip hook (bấm + ở cột Hook); chưa có câu hook (điền câu hook chung hôm nay hoặc câu riêng của dòng)" },
    ]);

    const plan = planBangBatch(db, [1, 2], s, "", { dayText: "Chung", clipExists: exists });
    expect(plan.runs.map((r) => r.hookText)).toEqual(["Chung", "Câu riêng dòng 2"]);
    const batchId = insertBangBatch(db, "", plan.runs);
    expect(db.prepare("SELECT rowNumber, hookText FROM runs WHERE batchId = ? ORDER BY rowNumber").all(batchId)).toEqual([
      { rowNumber: 1, hookText: "Chung" },
      { rowNumber: 2, hookText: "Câu riêng dòng 2" },
    ]);

    // Clip đã bị xoá khỏi máy: báo thiếu clip. Không thêm hook: như cũ, không ghi câu.
    db.prepare("UPDATE batches SET status = 'done' WHERE id = ?").run(batchId);
    db.prepare("UPDATE runs SET state = 'done' WHERE batchId = ?").run(batchId);
    files.removeAny(getRow(db, 1)!.hookClip);
    expect(planBangBatch(db, [1], s, "", { dayText: "Chung", clipExists: exists }).rejected[0]!.why).toBe("chưa có clip hook (bấm + ở cột Hook)");
    expect(planBangBatch(db, [3], s, "").runs[0]!.hookText).toBeUndefined();
  });

  it("video về từ lô có hook → dòng vào hàng chờ ghép; lô không hook thì không", async () => {
    const { db, files } = setup();
    setHookClip(db, 1, files.saveClip(1, MP4));
    const queued: number[] = [];
    let polls = 0;
    const bot: MuseDriver = {
      isOpen: true,
      async open() {},
      async send() {
        polls = 0;
        return { chatUrl: "https://muse.ai/thread/t1abcd" };
      },
      async watch(): Promise<WatchResult> {
        polls++;
        return { closed: false, login: false, approval: false, videos: polls >= 1 ? 1 : 0 };
      },
      async openChat() {},
      async bringToFront() {},
      async downloadVideo() {
        return { data: MP4, count: 1 };
      },
    };
    const runner = new BatchRunner(db, undefined, undefined, bot, { pollMs: 2, minuteMs: 40, secondMs: 1, random: () => 0, bangFiles: files, onHookJob: (id) => queued.push(id) });
    const runOnce = async (hook: boolean) => {
      runner.start(insertBangBatch(db, "", planBangBatch(db, [1], getSettings(db), "", hook ? { dayText: "Chung" } : undefined).runs));
      await runner.idle();
    };
    await runOnce(true);
    expect(queued).toEqual([1]);
    expect(getRow(db, 1)).toMatchObject({ hookJob: "Chung" });
    const ev = db.prepare("SELECT message FROM run_events ORDER BY id DESC LIMIT 1").get() as { message: string };
    expect(ev.message).toBe("Đã tải video về máy (1 KB); đang ghép hook");
    await runOnce(false);
    expect(queued).toEqual([1]);
    expect(getRow(db, 1)!.hookJob).toBeNull();
  });
});

describe("ghép hook (ffmpeg)", () => {
  it("đọc độ dài và khổ hình; clip quay dọc trên điện thoại thì đổi chiều", () => {
    const out = "Duration: 00:01:02.50, start: 0\n  Stream #0:0[0x1](und): Video: h264 (High), yuv420p(tv, bt709), 1280x720 [SAR 1:1 DAR 16:9], 30 fps";
    expect(parseProbe(out)).toEqual({ duration: 62.5, width: 1280, height: 720 });
    expect(parseProbe(`${out}\n      displaymatrix: rotation of -90.00 degrees`)).toEqual({ duration: 62.5, width: 720, height: 1280 });
    expect(parseProbe("Duration: N/A")).toBeNull();
  });

  it("clip ngang nằm giữa khung, câu hook ngay trên clip; clip dọc phủ kín khung thì câu không lên quá cao", () => {
    // Như video mẫu: clip 1080×792 → từ y=564, câu cao 160 nằm cách mép trên clip 40.
    expect(hookLayout({ width: 1080, height: 792 }, 160)).toEqual({ clipTop: 564, clipHeight: 792, captionY: 364 });
    expect(hookLayout({ width: 1920, height: 1080 }, 160)).toEqual({ clipTop: 656, clipHeight: 608, captionY: 456 });
    expect(hookLayout({ width: 1080, height: 1920 }, 160)).toEqual({ clipTop: 0, clipHeight: 1920, captionY: 160 });
    const f = hookFilter(6.5, 364);
    expect(f).toContain("trim=duration=6.500");
    expect(f).toContain("overlay=x=(W-w)/2:y=364");
    expect(f).toContain("xfade=transition=fade:duration=0.5:offset=6.000");
  });

  it("câu hook: chữ được thoát HTML, khung bo góc từng dòng", () => {
    const html = captionHtml(" <b>Áo này</b> & \"hot\" ");
    expect(html).toContain("<span>&lt;b&gt;Áo này&lt;/b&gt; &amp; &quot;hot&quot;</span>");
    expect(html).toContain("box-decoration-break:clone");
  });

  const ffmpeg = findFfmpeg();
  it.skipIf(!ffmpeg)("ghép thật: 1080×1920, dài = clip + video − 0,5 giây, không tiếng; giữ bản gốc; lỗi thì ghi lý do", async () => {
    const { db, files, dataDir } = setup();
    const src = tmp();
    const make = (file: string, args: string[]) => execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", ...args, path.join(src, file)]);
    make("clip.mp4", ["-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=2", "-pix_fmt", "yuv420p"]);
    make("muse.mp4", ["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=24:duration=3", "-pix_fmt", "yuv420p"]);
    const captions: string[] = [];
    const renderCaption: CaptionRenderer = async (text, out) => {
      captions.push(text);
      execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=400x120", "-frames:v", "1", out]);
      return { height: 120 };
    };
    setHookClip(db, 1, files.saveClip(1, fs.readFileSync(path.join(src, "clip.mp4"))));
    const video = files.saveVideo(1, fs.readFileSync(path.join(src, "muse.mp4")));
    setRowVideo(db, 1, video, 1);
    queueHook(db, 1, "I want this shirt but I'm broke...");
    const merger = new HookMerger(db, files, { renderCaption });
    merger.enqueue(1);
    expect(merger.isBusy(1)).toBe(true);
    await merger.idle();
    const row = getRow(db, 1)!;
    expect(row).toMatchObject({ hookJob: null, hookError: null, videoFile: video });
    expect(row.hookVideoFile).toMatch(/^1-hook-[a-z0-9]+\.mp4$/);
    expect(captions).toEqual(["I want this shirt but I'm broke..."]);
    const out = files.videoPath(row.hookVideoFile!)!;
    expect(row.hookVideoBytes).toBe(fs.statSync(out).size);
    const info = await probe(ffmpeg!, out);
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(info.duration).toBeCloseTo(4.5, 1);
    let stderr = "";
    try {
      execFileSync(ffmpeg!, ["-hide_banner", "-i", out], { stdio: "pipe" });
    } catch (e) {
      stderr = String((e as { stderr: Buffer }).stderr);
    }
    expect(stderr).not.toMatch(/Audio:/);
    expect(fs.readdirSync(path.join(dataDir, "tep", "tam"))).toEqual([]);

    // Ghép lại: bản có hook cũ bị thay. Clip hỏng: ghi lý do, video gốc và bản có hook cũ giữ nguyên.
    const first = row.hookVideoFile!;
    queueHook(db, 1, "Câu khác");
    merger.enqueue(1);
    await merger.idle();
    const second = getRow(db, 1)!.hookVideoFile!;
    expect(second).not.toBe(first);
    expect(files.videoPath(first)).toBeUndefined();

    setHookClip(db, 1, files.saveClip(1, MP4));
    queueHook(db, 1, "Câu khác");
    merger.enqueue(1);
    await merger.idle();
    expect(getRow(db, 1)).toMatchObject({ hookJob: null, hookError: "clip hook không đọc được (không phải video hoặc bị hỏng)", hookVideoFile: second, videoFile: video });
  }, 120_000);

  it("không chờ ghép / thiếu clip / không thấy ffmpeg → báo lý do, không chạy ffmpeg; tool mở lại thì ghép tiếp", async () => {
    const { db, files } = setup();
    const merger = new HookMerger(db, files, { ffmpeg: () => undefined, renderCaption: async () => ({ height: 0 }) });
    setRowVideo(db, 1, files.saveVideo(1, MP4), MP4.length);
    queueHook(db, 1, "Câu");
    queueHook(db, 2, "Câu");
    merger.recover();
    await merger.idle();
    expect(getRow(db, 1)).toMatchObject({ hookJob: null, hookError: "chưa có clip hook (bấm + ở cột Hook để chọn)" });
    expect(getRow(db, 2)).toMatchObject({ hookJob: null, hookError: "dòng chưa có video" });
    setHookClip(db, 1, files.saveClip(1, MP4));
    queueHook(db, 1, "Câu");
    merger.enqueue(1);
    await merger.idle();
    expect(getRow(db, 1)!.hookError).toBe("không tìm thấy ffmpeg (bộ ghép video đi kèm tool); giải nén lại bản zip");
  });
});

describe("Bảng: ô Thêm hook, cột Hook, Ghép hook", () => {
  function web() {
    const t = setup();
    const enqueued: number[] = [];
    const hooks = { isBusy: () => false, enqueue: (id: number) => enqueued.push(id) } as unknown as HookMerger;
    const app = createApp(loadConfig({ MASYS_DATA_DIR: t.dataDir }), t.db, { hooks });
    const post = (url: string, body: unknown) => app.request(url, { method: "POST", headers: H, body: JSON.stringify(body) });
    return { ...t, app, post, enqueued };
  }

  it("chưa tích: chỉ có ô Thêm hook, không có cột Hook; tích → cột Hook + ô câu chung hôm nay", async () => {
    const { app, post, db } = web();
    let html = await (await app.request("/")).text();
    expect(html).toContain('id="hookOn"');
    expect(html).not.toContain('id="hookDay"');
    expect(html).not.toContain("<th title=");
    expect((await app.request("/bang-moi/hook-chung", { method: "POST", body: JSON.stringify({ on: true }) })).status).toBe(403);
    expect(await (await post("/bang-moi/hook-chung", { on: true })).json()).toEqual({ ok: true });
    expect(await (await post("/bang-moi/hook-chung", { text: "I want this shirt" })).json()).toEqual({ ok: true });
    expect(await (await post("/bang-moi/hook-chung", { text: "x".repeat(201) })).json()).toEqual({ ok: false, message: "Câu hook dài quá (tối đa 200 ký tự)." });
    expect(getHookSettings(db)).toEqual({ on: true, dayText: "I want this shirt" });
    html = await (await app.request("/")).text();
    expect(html).toContain('id="hookDay"');
    expect(html).toContain('value="I want this shirt"');
    expect(html).toContain(">Hook</th>");
    expect(html).toContain("(câu chung hôm nay)");
  });

  it("chọn / bỏ clip hook, câu riêng; xem trước Tạo video có hook báo dòng thiếu clip", async () => {
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
    expect(await (await post("/bang-moi/cau-hook", { row: 1, text: "Câu riêng" })).json()).toEqual({ ok: true });
    expect(getRow(db, 1)!.hookText).toBe("Câu riêng");

    const html = await (await app.request("/bang-moi/chuan-bi?ids=1,2&hook=1")).text();
    expect(html).toContain("Tạo video · 1 dòng");
    expect(html).toContain("Dòng 2: chưa có clip hook (bấm + ở cột Hook); chưa có câu hook");
    expect(html).toContain("“Câu riêng”");
    expect(html).toContain('name="ids" value="1,2"');
    expect(await (await app.request("/bang-moi/chuan-bi?ids=1,2")).text()).toContain("Tạo video · 2 dòng");

    expect(await (await post("/bang-moi/bo-clip-hook", { row: 1 })).json()).toEqual({ ok: true });
    expect(getRow(db, 1)!.hookClip).toBeNull();
    expect(files.clipPath(r.name)).toBeUndefined();
  });

  it("Ghép hook cho dòng đã có video: kiểm tra đủ clip + câu rồi xếp hàng ghép; tải bản có hook đúng tên", async () => {
    const { app, post, db, files, enqueued } = web();
    setHookOn(db, true);
    expect(await (await post("/bang-moi/ghep-hook", { row: 1 })).json()).toEqual({ ok: false, message: "Dòng 1 chưa có video." });
    setRowVideo(db, 1, files.saveVideo(1, MP4), MP4.length, "2026-11-02T08:30:00");
    expect((await (await post("/bang-moi/ghep-hook", { row: 1 })).json()) as object).toMatchObject({ ok: false, message: "Dòng 1 chưa có clip hook: bấm + ở cột Hook để chọn." });
    setHookClip(db, 1, files.saveClip(1, MP4));
    expect((await (await post("/bang-moi/ghep-hook", { row: 1 })).json()) as object).toMatchObject({ ok: false });
    setHookDayText(db, "Chung");
    expect(await (await post("/bang-moi/ghep-hook", { row: 1 })).json()).toEqual({ ok: true, message: "Đang ghép hook cho dòng 1." });
    expect(enqueued).toEqual([1]);
    expect(getRow(db, 1)!.hookJob).toBe("Chung");
    const orig = getRow(db, 1)!.videoFile!;
    const busyHtml = await (await app.request("/")).text();
    expect(busyHtml).toContain("Đang ghép hook…");
    // Đang ghép (CON-135): chưa cho xem hay tải bản gốc, chưa có trong Tải các dòng đã chọn.
    expect(busyHtml).not.toContain(`/bang-moi/video/${orig}`);
    expect(busyHtml.match(/<tr data-row="1"[^>]*>/)![0]).not.toContain("data-dl=");

    const hv = files.newHookVideo(1);
    fs.writeFileSync(hv.path, MP4);
    db.prepare("UPDATE bang_rows SET hookJob = NULL, hookVideoFile = ?, hookVideoBytes = ? WHERE id = 1").run(hv.name, MP4.length);
    const html = await (await app.request("/")).text();
    expect(html).toContain("Có hook<");
    expect(html).toContain("Ghép lại hook");
    // Có bản có hook (CON-135): ô Video chỉ hiện bản có hook (xem, tải), bản gốc ẩn nhưng vẫn còn trên máy.
    expect(html).toContain(`data-src="/bang-moi/video/${hv.name}"`);
    expect(html).toContain(`href="/bang-moi/video/${hv.name}?tai=1" download="Video 01.mp4"`);
    expect(html).not.toContain(`/bang-moi/video/${orig}`);
    expect(files.videoPath(orig)).toBeTruthy();
    // Bảng video dùng hết chiều ngang để cột Video không bị khuất khi bật hook.
    expect(html).toContain('<main class="wide">');
    setHookOn(db, false);
    expect(await (await app.request("/")).text()).toContain(`data-src="/bang-moi/video/${hv.name}"`);
    setHookOn(db, true);
    // Tải các dòng đã chọn (CON-107): dòng có hook thì tải bản có hook; bản có hook cùng tên video (CON-113).
    expect(html.match(/<tr data-row="1"[^>]*>/)![0]).toContain(`data-dl="/bang-moi/video/${hv.name}?tai=1" data-dl-name="Video 01.mp4"`);
    const dl = await app.request(`/bang-moi/video/${hv.name}?tai=1`);
    expect(dl.headers.get("content-disposition")).toBe(`attachment; filename="Video 01.mp4"; filename*=UTF-8''Video%2001.mp4`);
    // Tên cũ chỉ còn dùng cho dòng chưa có tên video.
    expect(hookDownloadName(1, "2026-11-02T08:30:00")).toBe("MASYS_1_20261102-0830_hook.mp4");

    // Xoá dòng: xoá cả clip hook và bản có hook.
    const clip = getRow(db, 1)!.hookClip!;
    await post("/bang-moi/xoa", { rows: [1] });
    expect(files.clipPath(clip)).toBeUndefined();
    expect(files.videoPath(hv.name)).toBeUndefined();
  });
});

export type { DB };
