import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addNhanVat, getNhanVat, listNhanVat } from "../src/anh/nhanVat.js";
import { DEFAULT_IMAGE_BACK_TEMPLATE } from "../src/anh/request.js";
import { addRow, filesOf, getRow, labelOf, mainFile, splitPrompts } from "../src/anh/rows.js";
import { insertAnhBatch, planAnhBatch } from "../src/anh/run.js";
import { BangFiles } from "../src/bang/files.js";
import { getRow as bangGetRow } from "../src/bang/rows.js";
import { BotError, type WatchResult } from "../src/bot/museBot.js";
import { getBatch } from "../src/batch/create.js";
import { loadConfig } from "../src/config.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { getDailyQuota, getImageQuota } from "../src/db/quota.js";
import { getSettings } from "../src/db/settings.js";
import { BatchRunner, type MuseDriver } from "../src/queue/runner.js";
import { createApp } from "../src/web/app.js";
import { anhDownloadName } from "../src/web/bangAnh.js";

// Bảng ảnh: tạo ảnh nhân vật theo character sheet (CON-77, spec v6.3 mục 17.13, D31–D33).

const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, n]);
const SHEET = png(1);
const FACE = png(200);
const H = { "X-Masys": "1", "Content-Type": "application/json" };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

interface FakeOpts {
  /** Chừng này lần gửi đầu Muse trắng trang (chưa gửi). */
  sendFailures?: number;
  /** Chừng này lần gửi đầu tin đến Muse thiếu ảnh (đã gửi). */
  lostImages?: number;
  /** Lần gửi nào (đánh số từ 1) tin đến Muse thiếu ảnh. */
  lostOn?: (nth: number) => boolean;
  /** Số ảnh Muse trả mỗi tin. */
  perReply?: number;
  /** Muse chỉ trả lại ảnh giống hệt character sheet. */
  echoSheet?: boolean;
  /** Muse hiện lại ảnh này (ảnh mặt đính kèm) sau ảnh của mình, cùng ảnh mới. */
  extraEcho?: Uint8Array;
  /** reply() ném lỗi này (tin quay lưng). */
  replyError?: BotError;
  /** Ảnh hiện mờ (chưa xong) ở lần xem đầu tiên sau mỗi tin. */
  blurFirst?: boolean;
}

function setup(o: FakeOpts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-banganh-"));
  dirs.push(dataDir);
  const files = new BangFiles(dataDir);
  const db = openDatabase(":memory:");
  const nv = addNhanVat(db, "Linh", (id) => ({ file: files.saveNhanVat(id, SHEET), bytes: SHEET.length }));
  const log: { kind: "send" | "reply"; text: string; files?: string[]; tab: string }[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  /** Ảnh trên trang của từng tab: src + dữ liệu. */
  const pages = new Map<string, { src: string; data: Uint8Array; ready: boolean }[]>();
  const pending = new Map<string, number>();
  let counter = 10;
  const produce = (tab: string) => {
    const list = pages.get(tab) ?? [];
    const n = o.perReply ?? 1;
    if (o.extraEcho) list.push({ src: "blob:me/face", data: o.extraEcho, ready: !o.blurFirst });
    for (let i = 0; i < n; i++) {
      const data = o.echoSheet ? SHEET : png(counter++);
      list.push({ src: `blob:muse/${counter}-${i}`, data, ready: !o.blurFirst });
    }
    pages.set(tab, list);
  };
  const bot: MuseDriver = {
    isOpen: true,
    async open() {},
    async send(text: string, f: string[] = [], tab = "") {
      log.push({ kind: "send", text, files: f, tab });
      const nth = log.filter((l) => l.kind === "send").length;
      if (o.sendFailures && nth <= o.sendFailures) throw new BotError("ui_changed", "Không thấy nút Gửi của Muse", false);
      if ((o.lostImages && nth <= o.lostImages) || o.lostOn?.(nth)) throw new BotError("missing_images", "Tin đến Muse thiếu ảnh (0/2 ảnh)", true);
      // Tin của mình hiện kèm ảnh character sheet (ảnh lớn đầu tiên trong khung chat).
      pages.set(tab, [{ src: "blob:me/sheet", data: SHEET, ready: true }]);
      pending.set(tab, 2);
      return { chatUrl: `https://muse.ai/thread/t${log.length}abcd` };
    },
    async reply(text: string, tab: string) {
      log.push({ kind: "reply", text, tab });
      if (o.replyError) throw o.replyError;
      pending.set(tab, 2);
    },
    async watch(tab?: string): Promise<WatchResult> {
      const t = tab ?? "";
      const left = pending.get(t) ?? 0;
      if (left > 0) {
        pending.set(t, left - 1);
        if (left === 1) produce(t);
      } else for (const img of pages.get(t) ?? []) img.ready = true;
      return { closed: false, login: false, approval: false, images: (pages.get(t) ?? []).map((i) => ({ src: i.src, ready: i.ready })) };
    },
    async openChat(url: string, tab?: string) {
      opened.push(url);
      if (!pages.has(tab ?? "")) {
        pages.set(tab ?? "", [{ src: "blob:me/sheet", data: SHEET, ready: true }]);
        produce(tab ?? "");
      }
    },
    async bringToFront() {},
    async closeTab(tab: string) {
      closed.push(tab);
    },
    async downloadVideo() {
      throw new Error("không dùng");
    },
    async downloadImages(tab: string, from: number) {
      return (pages.get(tab) ?? []).slice(from).map((i) => i.data);
    },
  };
  const runner = new BatchRunner(db, undefined, undefined, bot, { pollMs: 2, minuteMs: 60, secondMs: 1, random: () => 0, bangFiles: files });
  const app = createApp(loadConfig({ MASYS_DATA_DIR: dataDir }), db, { runner });
  db.prepare("UPDATE settings SET pauseMinSec = 0, pauseMaxSec = 0").run();
  const run = async (ids: number[]) => {
    const batchId = insertAnhBatch(db, "", planAnhBatch(db, ids, getSettings(db), "").runs);
    runner.start(batchId);
    await runner.idle();
    return batchId;
  };
  return { db, files, dataDir, nv, runner, app, log, opened, closed, pages, run };
}

const lastRun = (db: DB, row: number) =>
  db.prepare("SELECT id, state, error, anhPhase, museChatUrl FROM runs WHERE anhRowId = ? ORDER BY id DESC").get(row) as Record<string, string | number | null>;
const events = (db: DB, runId: number) => (db.prepare("SELECT message FROM run_events WHERE runId = ? ORDER BY id").all(runId) as { message: string }[]).map((e) => e.message);
const post = (app: ReturnType<typeof createApp>, url: string, body: unknown) => app.request(url, { method: "POST", headers: H, body: JSON.stringify(body) });
const form = (fields: Record<string, string | Blob>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};

describe("Nhân vật (D32)", () => {
  it("thêm / đổi tên / đổi file / xoá; file nằm trong tep\\nhan-vat, không đóng gói vào app", async () => {
    const { app, db, dataDir } = setup();
    const add = await app.request("/nhan-vat/them", { method: "POST", body: form({ ten: " Mai ", file: new File([png(2)], "mai.png") }) });
    expect(add.status).toBe(303);
    const mai = listNhanVat(db).find((n) => n.ten === "Mai")!;
    expect(mai.file).toMatch(/^nv\d+-[a-z0-9]+\.png$/);
    expect(fs.existsSync(path.join(dataDir, "tep", "nhan-vat", mai.file))).toBe(true);

    await app.request(`/nhan-vat/${mai.id}/ten`, { method: "POST", body: form({ ten: "Mai 2" }) });
    expect(getNhanVat(db, mai.id)!.ten).toBe("Mai 2");

    await app.request(`/nhan-vat/${mai.id}/file`, { method: "POST", body: form({ file: new File([png(3)], "x.png") }) });
    const after = getNhanVat(db, mai.id)!;
    expect(after.file).not.toBe(mai.file);
    expect(fs.existsSync(path.join(dataDir, "tep", "nhan-vat", mai.file))).toBe(false);

    const bad = await app.request("/nhan-vat/them", { method: "POST", body: form({ ten: "X", file: new File(["chữ"], "a.txt") }) });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Chỉ nhận ảnh JPG, PNG hoặc WEBP.");

    await app.request(`/nhan-vat/${mai.id}/xoa`, { method: "POST" });
    expect(getNhanVat(db, mai.id)).toBeUndefined();
    expect(fs.existsSync(path.join(dataDir, "tep", "nhan-vat", after.file))).toBe(false);
    const html = await (await app.request("/nhan-vat")).text();
    expect(html).toContain("Linh");
    expect(html).not.toContain("Mai 2");
  });

  it("thẻ nhân vật: mỗi ô có dấu + tải ảnh, không còn nút tải riêng (CON-88)", async () => {
    const { app, nv } = setup();
    const html = await (await app.request("/nhan-vat")).text();
    for (const route of ["goc", "file", "mat"]) expect(html).toContain(`action="/nhan-vat/${nv}/${route}"`);
    expect(html.match(/data-nv-upload="1"/g)).toHaveLength(3);
    expect(html).toContain('class="nv-plus giua"');
    expect(html).toContain('class="nv-plus goc"');
    expect(html).not.toMatch(/<button[^>]*>\s*(Đổi|Thêm) ảnh/);
  });

  it("ảnh gốc: nhân vật cũ thêm và đổi được, thẻ hiện đủ 3 ô, không gửi Muse (CON-84)", async () => {
    const { app, db, dataDir, nv, log, run } = setup();
    const onDisk = (f: string) => fs.existsSync(path.join(dataDir, "tep", "nhan-vat", f));
    const before = await (await app.request("/nhan-vat")).text();
    expect(before).toContain("Chưa có ảnh gốc");
    expect(before).toContain("Thêm ảnh gốc");

    await app.request(`/nhan-vat/${nv}/goc`, { method: "POST", body: form({ file: new File([png(5)], "g.png") }) });
    const first = getNhanVat(db, nv)!;
    expect(first.masterFile).toMatch(/^nv\d+-[a-z0-9]+\.png$/);
    expect(first.masterBytes).toBe(12);
    const after = await (await app.request("/nhan-vat")).text();
    expect(after).not.toContain("Chưa có ảnh gốc");
    expect(after).toContain("Đổi ảnh gốc");
    expect(after).toContain(`/nhan-vat/anh/${first.masterFile}`);

    await app.request(`/nhan-vat/${nv}/goc`, { method: "POST", body: form({ file: new File([png(6)], "g2.png") }) });
    const second = getNhanVat(db, nv)!;
    expect(second.masterFile).not.toBe(first.masterFile);
    expect(onDisk(first.masterFile!)).toBe(false);
    expect(onDisk(second.masterFile!)).toBe(true);

    const bad = await app.request(`/nhan-vat/${nv}/goc`, { method: "POST", body: form({ file: new File(["chữ"], "a.txt") }) });
    expect(bad.status).toBe(303);
    expect(getNhanVat(db, nv)!.masterFile).toBe(second.masterFile);

    await run([addRow(db, { nhanVatId: nv, prompt: "đứng" })]);
    expect(log[0]!.files).toHaveLength(1);
    expect(log[0]!.files![0]).toContain(second.file);
  });

  it("ảnh mặt: thêm cùng nhân vật, đổi, xoá; không chọn ảnh mặt vẫn thêm được (CON-80)", async () => {
    const { app, db, dataDir } = setup();
    const onDisk = (f: string) => fs.existsSync(path.join(dataDir, "tep", "nhan-vat", f));
    await app.request("/nhan-vat/them", { method: "POST", body: form({ ten: "Mai", file: new File([png(2)], "g.png"), face: new File([png(3)], "m.png") }) });
    const mai = listNhanVat(db).find((n) => n.ten === "Mai")!;
    expect(mai.faceFile).toMatch(/^nv\d+-[a-z0-9]+\.png$/);
    expect(mai.faceFile).not.toBe(mai.file);
    expect(mai.faceBytes).toBe(12);
    expect(onDisk(mai.faceFile!)).toBe(true);

    await app.request(`/nhan-vat/${mai.id}/mat`, { method: "POST", body: form({ file: new File([png(4)], "m2.png") }) });
    const changed = getNhanVat(db, mai.id)!;
    expect(changed.faceFile).not.toBe(mai.faceFile);
    expect(onDisk(mai.faceFile!)).toBe(false);
    expect(changed.file).toBe(mai.file);

    await app.request(`/nhan-vat/${mai.id}/mat/xoa`, { method: "POST" });
    expect(getNhanVat(db, mai.id)).toMatchObject({ faceFile: null, faceBytes: 0, file: mai.file });
    expect(onDisk(changed.faceFile!)).toBe(false);

    await app.request("/nhan-vat/them", { method: "POST", body: form({ ten: "Lan", file: new File([png(5)], "g.png"), face: new File([], "") }) });
    expect(listNhanVat(db).find((n) => n.ten === "Lan")!.faceFile).toBeNull();
    const bad = await app.request("/nhan-vat/them", { method: "POST", body: form({ ten: "X", file: new File([png(6)], "g.png"), face: new File(["chữ"], "a.txt") }) });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Ảnh mặt:");

    await app.request(`/nhan-vat/${mai.id}/mat`, { method: "POST", body: form({ file: new File([png(7)], "m3.png") }) });
    const last = getNhanVat(db, mai.id)!;
    await app.request(`/nhan-vat/${mai.id}/xoa`, { method: "POST" });
    expect(onDisk(last.file)).toBe(false);
    expect(onDisk(last.faceFile!)).toBe(false);
  });

  it("dòng chọn nhân vật đã xoá thành Thiếu dữ liệu", async () => {
    const { db, nv, app } = setup();
    const id = addRow(db, { nhanVatId: nv, prompt: "đứng cạnh cửa sổ" });
    expect(labelOf(getRow(db, id)!).label).toBe("ready");
    await app.request(`/nhan-vat/${nv}/xoa`, { method: "POST" });
    expect(labelOf(getRow(db, id)!)).toEqual({ label: "missing_data", problems: ["Nhân vật đã bị xoá: chọn nhân vật khác"] });
  });
});

describe("Bảng ảnh: thêm và sửa dòng (D31)", () => {
  it("dán nhiều prompt → mỗi dòng chữ một dòng; sửa prompt, nhân vật, Quay lưng; lọc", async () => {
    const { app, db, nv } = setup();
    expect(splitPrompts("  a \n\n b\r\nc  ")).toEqual(["a", "b", "c"]);
    const r = (await (await post(app, "/bang-anh/them", { nhanVatId: nv, prompts: "mặc áo phông trắng\nngồi trên sofa", backOn: true })).json()) as { ok: boolean; ids: number[] };
    expect(r.ok).toBe(true);
    expect(r.ids).toHaveLength(2);
    expect(getRow(db, r.ids[0]!)).toMatchObject({ prompt: "mặc áo phông trắng", backOn: 1, nhanVatTen: "Linh" });
    expect(getSettings(db).lastNhanVatId).toBe(nv);

    const added = (await (await post(app, "/bang-anh/them", { nhanVatId: nv, prompts: "" })).json()) as { ids: number[] };
    const one = added.ids[0]!;
    expect(labelOf(getRow(db, one)!).label).toBe("missing_data");
    await post(app, "/bang-anh/prompt", { row: one, prompt: "  cười  " });
    expect(getRow(db, one)!.prompt).toBe("cười");
    await post(app, "/bang-anh/quay-lung", { row: one, on: true });
    expect(getRow(db, one)!.backOn).toBe(1);

    const noNv = await (await post(app, "/bang-anh/them", { nhanVatId: 999, prompts: "x" })).json();
    expect(noNv).toEqual({ ok: false, message: "Chọn nhân vật trước (trang Nhân vật)." });
    expect(await (await post(app, "/bang-anh/them", { nhanVatId: nv })).json()).toMatchObject({ ok: true });
    expect((await app.request("/bang-anh/them", { method: "POST", body: "{}" })).status).toBe(403);

    const html = await (await app.request("/bang-anh")).text();
    expect(html).toContain("Bảng ảnh");
    expect(html).toContain("Chưa tạo (3)");
    expect(html).toContain("Hôm nay 0/100 ảnh");
    expect(html).toContain('href="/bang-anh"');
  });

  it("chưa có nhân vật: Bảng ảnh nhắc thêm nhân vật trước", async () => {
    const { app, db, nv } = setup();
    db.prepare("UPDATE nhan_vat SET deletedAt = 'x' WHERE id = ?").run(nv);
    expect(await (await app.request("/bang-anh")).text()).toContain("Chưa có nhân vật nào.");
  });
});

describe("tạo ảnh trên Muse (17.13)", () => {
  it("trắng trang: đóng tab, mở tab mới làm lại, lô không dừng, chỉ tính một lượt ảnh (CON-98)", async () => {
    const t = setup({ sendFailures: 2 });
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "đứng ở quán cà phê" });
    const batchId = await t.run([id]);
    expect(t.log).toHaveLength(3);
    expect(lastRun(t.db, id).state).toBe("done");
    expect(getBatch(t.db, batchId)!.status).toBe("done");
    expect(getImageQuota(t.db).used).toBe(1);
    expect(events(t.db, lastRun(t.db, id).id as number).filter((e) => e.startsWith("Tab "))).toHaveLength(2);
    expect(t.closed.slice(0, 2)).toEqual([t.log[0]!.tab, t.log[0]!.tab]);
  });

  it("tin đến Muse thiếu ảnh: nhận ra ngay, gửi lại cuộc trò chuyện mới, mỗi lần gửi tính một lượt (CON-99)", async () => {
    const t = setup({ lostImages: 1 });
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "đứng ở quán cà phê" });
    await t.run([id]);
    expect(t.log).toHaveLength(2);
    expect(lastRun(t.db, id).state).toBe("done");
    expect(getImageQuota(t.db).used).toBe(2);
    expect(getDailyQuota(t.db).used).toBe(0);
    expect(events(t.db, lastRun(t.db, id).id as number)).toContain("Thất bại lần 1/3: Tin đến Muse thiếu ảnh (0/2 ảnh); sẽ tự chạy lại");
  });

  it("gửi đủ 3 lần vẫn thiếu ảnh: Cần xem, ghi rõ lý do, không gửi thêm, đủ 3 lượt (CON-99)", async () => {
    const t = setup({ lostImages: 9 });
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "đứng ở quán cà phê" });
    await t.run([id]);
    expect(t.log).toHaveLength(3);
    expect(lastRun(t.db, id)).toMatchObject({ state: "needs_review", error: "Thất bại 3 lần: Tin đến Muse thiếu ảnh (0/2 ảnh)" });
    expect(getImageQuota(t.db).used).toBe(3);
  });

  it("các dòng thiếu ảnh xen kẽ dòng thành công: lô không tạm dừng nhầm, đủ 4 ảnh (CON-99)", async () => {
    const t = setup({ lostOn: (nth) => nth === 1 || nth === 3 || nth === 5 });
    const ids = [1, 2, 3, 4].map((n) => addRow(t.db, { nhanVatId: t.nv, prompt: `cảnh ${n}` }));
    const batchId = await t.run(ids);
    expect(getBatch(t.db, batchId)).toMatchObject({ status: "done", pauseReason: null });
    expect(ids.map((id) => lastRun(t.db, id).state)).toEqual(["done", "done", "done", "done"]);
  });

  it("hỏng đủ 3 tab: tạm dừng lô, nêu lý do, không còn tab trắng, không tính lượt; Tiếp tục thì gửi lại được (CON-98)", async () => {
    const t = setup({ sendFailures: 3 });
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "đứng ở quán cà phê" });
    const batchId = await t.run([id]);
    expect(t.log).toHaveLength(3);
    expect(getBatch(t.db, batchId)).toMatchObject({ status: "paused", pauseReason: "ui" });
    expect(lastRun(t.db, id).state).toBe("paused_ui");
    expect(events(t.db, lastRun(t.db, id).id as number).at(-1)).toBe("Chưa gửi: Không thấy nút Gửi của Muse");
    expect(t.closed).toHaveLength(3);
    expect(getImageQuota(t.db).used).toBe(0);
    expect(t.runner.start(batchId)).toEqual({ ok: true });
    await t.runner.idle();
    expect(lastRun(t.db, id).state).toBe("done");
    expect(getImageQuota(t.db).used).toBe(1);
  });

  it("một ảnh: đính kèm character sheet, chờ ảnh mới sau ảnh của mình, tải về tep\\anh-tao, ảnh đầu là ảnh chính", async () => {
    const t = setup({ perReply: 3 });
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "đứng ở quán cà phê" });
    const batchId = await t.run([id]);
    expect(t.log).toHaveLength(1);
    expect(t.log[0]!.text).toContain("ảnh tham chiếu của nhân vật Linh");
    expect(t.log[0]!.text).toContain("trang phục trong ảnh");
    expect(t.log[0]!.text).toContain("đứng ở quán cà phê");
    expect(t.log[0]!.files).toEqual([t.files.nhanVatPath(getRow(t.db, id)!.nhanVatFile!)]);
    const list = filesOf(t.db, [id]).get(id)!;
    expect(list).toHaveLength(3);
    expect(list.every((f) => f.side === "truoc" && fs.existsSync(path.join(t.dataDir, "tep", "anh-tao", f.file)))).toBe(true);
    expect(mainFile(list, "truoc")!.file).toBe(list[0]!.file);
    expect(lastRun(t.db, id).state).toBe("done");
    expect(events(t.db, lastRun(t.db, id).id as number).at(-1)).toMatch(/^Đã tải 3 ảnh mặt trước về máy/);
    expect(labelOf(getRow(t.db, id)!).label).toBe("done");
    expect(getBatch(t.db, batchId)!.status).toBe("done");
    // Đếm vào giới hạn ảnh, không đụng giới hạn video.
    expect(getImageQuota(t.db).used).toBe(1);
    expect(getDailyQuota(t.db).used).toBe(0);
  });

  it("nhân vật có ảnh mặt: gửi ảnh 4 góc rồi ảnh mặt; ảnh mặt Muse hiện lại không bị lưu; đổi ảnh mặt sau khi bấm thì không gửi (CON-80)", async () => {
    const t = setup({ extraEcho: FACE });
    const face = t.files.saveNhanVat(t.nv, FACE);
    t.db.prepare("UPDATE nhan_vat SET faceFile = ?, faceBytes = ? WHERE id = ?").run(face, FACE.length, t.nv);
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "đứng ở quán cà phê" });
    await t.run([id]);
    const row = getRow(t.db, id)!;
    expect(t.log[0]!.files).toEqual([t.files.nhanVatPath(row.nhanVatFile!), t.files.nhanVatPath(face)]);
    const list = filesOf(t.db, [id]).get(id)!;
    expect(list).toHaveLength(1);
    expect(lastRun(t.db, id).state).toBe("done");

    const id2 = addRow(t.db, { nhanVatId: t.nv, prompt: "ngồi trên sofa" });
    const plan = planAnhBatch(t.db, [id2], getSettings(t.db), "");
    const batchId = insertAnhBatch(t.db, "", plan.runs);
    t.db.prepare("UPDATE nhan_vat SET faceFile = NULL WHERE id = ?").run(t.nv);
    t.runner.start(batchId);
    await t.runner.idle();
    expect(t.log).toHaveLength(1);
    expect(lastRun(t.db, id2)).toMatchObject({ state: "needs_review", error: "dữ liệu dòng đã đổi" });
  });

  it("thiếu file ảnh mặt: bị loại lúc chuẩn bị, không âm thầm gửi thiếu ảnh (CON-80)", async () => {
    const t = setup();
    t.db.prepare("UPDATE nhan_vat SET faceFile = 'nv1-khongcon.png' WHERE id = ?").run(t.nv);
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "x" });
    const plan = planAnhBatch(t.db, [id], getSettings(t.db), "", (f) => !!t.files.nhanVatPath(f));
    expect(plan.runs).toHaveLength(0);
    expect(plan.rejected[0]!.why).toContain("ảnh mặt");
  });

  it("Quay lưng: tải xong mặt trước mới gửi tin thứ hai trong cùng tab, ảnh quay lưng vào cột riêng, tính 2 lượt", async () => {
    const t = setup();
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "mặc áo phông trơn", backOn: true });
    await t.run([id]);
    expect(t.log.map((l) => l.kind)).toEqual(["send", "reply"]);
    expect(t.log[1]).toMatchObject({ text: DEFAULT_IMAGE_BACK_TEMPLATE, tab: t.log[0]!.tab });
    const list = filesOf(t.db, [id]).get(id)!;
    expect(list.map((f) => f.side)).toEqual(["truoc", "sau"]);
    expect(lastRun(t.db, id)).toMatchObject({ state: "done", anhPhase: "back" });
    expect(events(t.db, lastRun(t.db, id).id as number)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Đã tải 1 ảnh mặt trước về máy .*; gửi tin xin ảnh quay lưng/), expect.stringMatching(/^Đã tải 1 ảnh quay lưng về máy/)]),
    );
    expect(getImageQuota(t.db).used).toBe(2);
  });

  it("ảnh còn mờ thì chưa tải; chỉ tải khi ảnh đã xong và không đổi giữa hai lần xem", async () => {
    const t = setup({ blurFirst: true });
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "x" });
    await t.run([id]);
    expect(lastRun(t.db, id).state).toBe("done");
    expect(filesOf(t.db, [id]).get(id)).toHaveLength(1);
  });

  it("chỉ thấy lại ảnh character sheet → không lưu, Cần xem, không gửi lại", async () => {
    const t = setup({ echoSheet: true });
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "x" });
    await t.run([id]);
    expect(t.log).toHaveLength(1);
    expect(lastRun(t.db, id)).toMatchObject({ state: "needs_review", error: "không tải được ảnh mặt trước" });
    expect(filesOf(t.db, [id]).get(id)).toBeUndefined();
    expect(labelOf(getRow(t.db, id)!).label).toBe("review");
  });

  it("tin quay lưng chưa gửi được (Muse đòi đăng nhập): giữ ảnh mặt trước, dòng Cần xem, lô tạm dừng", async () => {
    const t = setup({ replyError: new BotError("login", "Cần đăng nhập Muse", false) });
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "x", backOn: true });
    const id2 = addRow(t.db, { nhanVatId: t.nv, prompt: "y" });
    db_parallel(t.db, 1);
    const batchId = await t.run([id, id2]);
    expect(lastRun(t.db, id)).toMatchObject({ state: "needs_review", error: "chưa có ảnh quay lưng" });
    expect(filesOf(t.db, [id]).get(id)!.map((f) => f.side)).toEqual(["truoc"]);
    expect(getBatch(t.db, batchId)).toMatchObject({ status: "paused", pauseReason: "login" });
    expect(lastRun(t.db, id2).state).toBe("queued");
    // Tin quay lưng chưa gửi thì không tính lượt.
    expect(getImageQuota(t.db).used).toBe(1);
  });

  it("dữ liệu dòng đổi sau khi bấm Tạo ảnh → không gửi, Cần xem", async () => {
    const t = setup();
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "x" });
    const batchId = insertAnhBatch(t.db, "", planAnhBatch(t.db, [id], getSettings(t.db), "").runs);
    t.db.prepare("UPDATE anh_rows SET prompt = 'khác' WHERE id = ?").run(id);
    t.runner.start(batchId);
    await t.runner.idle();
    expect(t.log).toHaveLength(0);
    expect(lastRun(t.db, id)).toMatchObject({ state: "needs_review", error: "dữ liệu dòng đã đổi" });
  });

  it("giới hạn ảnh mỗi ngày: dòng có Quay lưng cần 2 lượt; thiếu thì không gửi, lô tạm dừng", async () => {
    const t = setup();
    t.db.prepare("UPDATE settings SET dailyImageLimit = 1").run();
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "x", backOn: true });
    expect(planAnhBatch(t.db, [id], getSettings(t.db), "").turns).toBe(2);
    const batchId = await t.run([id]);
    expect(t.log).toHaveLength(0);
    expect(getBatch(t.db, batchId)).toMatchObject({ status: "paused", pauseReason: "image_limit" });
  });
});

describe("tool mở lại giữa chừng (D9)", () => {
  const stuck = (t: ReturnType<typeof setup>, id: number, fields: string) => {
    const batchId = insertAnhBatch(t.db, "", planAnhBatch(t.db, [id], getSettings(t.db), "").runs);
    t.db.prepare("UPDATE batches SET status = 'running' WHERE id = ?").run(batchId);
    t.db.prepare(`UPDATE runs SET sentAt = ?, museChatUrl = 'https://muse.ai/thread/old1', ${fields}`).run(new Date().toISOString());
    t.runner.recover();
    return t.runner.idle();
  };

  it("đang chờ ảnh: mở lại đúng cuộc trò chuyện, tải ảnh, không gửi gì", async () => {
    const t = setup();
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "x" });
    await stuck(t, id, "state = 'waiting', anhPhase = 'front', anhBaseline = 1");
    expect(t.opened).toEqual(["https://muse.ai/thread/old1"]);
    expect(t.log).toEqual([]);
    expect(lastRun(t.db, id).state).toBe("done");
    expect(filesOf(t.db, [id]).get(id)).toHaveLength(1);
  });

  it("tắt đúng lúc gửi tin xin ảnh quay lưng → không biết đã gửi chưa: Cần xem, không gửi lại", async () => {
    const t = setup();
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "x", backOn: true });
    await stuck(t, id, "state = 'sending', anhPhase = 'back', anhBackAt = sentAt");
    expect(t.log).toEqual([]);
    expect(lastRun(t.db, id)).toMatchObject({ state: "needs_review", error: "chưa rõ đã xin ảnh quay lưng" });
  });
});

describe("trên dòng: chọn ảnh chính, tải, xoá; Dọn tất cả", () => {
  it("★ đổi ảnh chính, ⬇ có tên MASYS_ANH_…, 🗑 xoá ảnh (ảnh chính chuyển sang ảnh còn lại), dọn xoá cả file", async () => {
    const t = setup({ perReply: 2 });
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "x" });
    await t.run([id]);
    const [a, b] = filesOf(t.db, [id]).get(id)!;
    expect(await (await post(t.app, "/bang-anh/chon-anh", { file: b!.id })).json()).toEqual({ ok: true });
    expect(mainFile(filesOf(t.db, [id]).get(id)!, "truoc")!.id).toBe(b!.id);

    const dl = await t.app.request(`/bang-anh/anh/${b!.file}?tai=1`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toBe(`attachment; filename="${anhDownloadName(id, "truoc", b!.createdAt, b!.file)}"`);
    expect(anhDownloadName(7, "sau", "2026-11-03T08:05:00", "a7-sau-x.png")).toBe("MASYS_ANH_7_sau_20261103-0805.png");
    expect((await t.app.request("/bang-anh/anh/..%2Fdata.db")).status).toBe(404);

    await post(t.app, "/bang-anh/xoa-anh", { file: b!.id });
    expect(fs.existsSync(path.join(t.dataDir, "tep", "anh-tao", b!.file))).toBe(false);
    expect(mainFile(filesOf(t.db, [id]).get(id)!, "truoc")!.id).toBe(a!.id);

    const html = await (await t.app.request("/bang-anh/don")).text();
    expect(html).toContain("Sẽ xoá <strong>1 dòng</strong>");
    const done = await t.app.request("/bang-anh/don", { method: "POST", body: form({}) });
    expect(done.status).toBe(303);
    expect(getRow(t.db, id)).toBeUndefined();
    expect(fs.readdirSync(path.join(t.dataDir, "tep", "anh-tao"))).toEqual([]);
    // Nhân vật không bị xoá khi dọn.
    expect(listNhanVat(t.db)).toHaveLength(1);
  });

  it("trang xem trước: cho thấy character sheet, hai tin gửi Muse, số lượt; dòng thiếu dữ liệu bị loại", async () => {
    const t = setup();
    const ok = addRow(t.db, { nhanVatId: t.nv, prompt: "x", backOn: true });
    const bad = addRow(t.db, { nhanVatId: t.nv, prompt: "" });
    const html = await (await t.app.request(`/bang-anh/chuan-bi?ids=${ok},${bad}`)).text();
    expect(html).toContain("Tạo ảnh · 1 dòng");
    expect(html).toContain("mặt trước + quay lưng");
    expect(html).toContain("Tin thứ hai, gửi sau khi đã có ảnh mặt trước");
    expect(html).toContain(`Dòng ${bad}: Thiếu prompt`);
    expect(html).toContain("lô này dùng 2 lượt");
  });
});

describe("Xuất sang Bảng video (D34)", () => {
  it("chép ảnh chính mặt trước / quay lưng vào dòng Bảng video mới; hai bảng xoá độc lập; xuất lại phải xác nhận", async () => {
    const t = setup({ perReply: 2 });
    const both = addRow(t.db, { nhanVatId: t.nv, prompt: "x", backOn: true });
    const front = addRow(t.db, { nhanVatId: t.nv, prompt: "y" });
    const empty = addRow(t.db, { nhanVatId: t.nv, prompt: "z" });
    await t.run([both, front]);
    // Chọn ảnh thứ hai làm ảnh chính mặt trước của dòng `both`.
    const second = filesOf(t.db, [both]).get(both)!.filter((f) => f.side === "truoc")[1]!;
    await post(t.app, "/bang-anh/chon-anh", { file: second.id });

    const preview = await (await t.app.request(`/bang-anh/xuat?ids=${both},${front},${empty}`)).text();
    expect(preview).toContain('Sẽ thêm <strong id="exportCount">2</strong> dòng vào Bảng video.');
    expect(preview).toContain(`Dòng ${empty}: chưa có ảnh mặt trước`);

    const res = await t.app.request("/bang-anh/xuat", { method: "POST", body: form({ ids: `${both},${front}` }) });
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!, "http://x").searchParams.get("ok")).toContain("Đã xuất 2 dòng sang Bảng video");
    const out = (id: number) => bangGetRow(t.db, getRow(t.db, id)!.exportedBangRowId!)!;
    const a = out(both);
    const read = (dir: string, name: string) => fs.readFileSync(path.join(t.dataDir, "tep", dir, name));
    expect(read("anh", a.modelFront!)).toEqual(read("anh-tao", second.file));
    expect(read("anh", a.modelBack!)).toEqual(read("anh-tao", mainFile(filesOf(t.db, [both]).get(both)!, "sau")!.file));
    expect(a).toMatchObject({ prompt: "", shirtFront: null, shirtBack: null });
    expect(out(front).modelBack).toBeNull();

    // Bảng ảnh: ghi Đã xuất → dòng #N, lọc Đã xuất.
    const board = await (await t.app.request("/bang-anh?loc=exported")).text();
    expect(board).toContain(`Đã xuất → dòng #${a.id}`);
    expect(board).toContain("Đã xuất (2)");

    // Xuất lại: không xác nhận thì không thêm dòng; có xác nhận thì thêm dòng mới, dòng cũ vẫn giữ.
    const count = () => (t.db.prepare("SELECT count(*) n FROM bang_rows WHERE deletedAt IS NULL").get() as { n: number }).n;
    expect(await (await t.app.request(`/bang-anh/xuat?ids=${both}`)).text()).toContain(`Đã xuất rồi → dòng #${a.id}`);
    await t.app.request("/bang-anh/xuat", { method: "POST", body: form({ ids: String(both) }) });
    expect(count()).toBe(2);
    await t.app.request("/bang-anh/xuat", { method: "POST", body: form({ ids: String(both), lai: "1" }) });
    expect(count()).toBe(3);
    expect(getRow(t.db, both)!.exportedBangRowId).not.toBe(a.id);

    // Xoá dòng ảnh: ảnh trên Bảng video còn nguyên.
    await post(t.app, "/bang-anh/xoa", { rows: [both, front] });
    expect(fs.existsSync(path.join(t.dataDir, "tep", "anh", a.modelFront!))).toBe(true);
    // Xoá dòng Bảng video: Bảng ảnh ghi dòng đó đã xoá.
    const again = addRow(t.db, { nhanVatId: t.nv, prompt: "w" });
    t.db.prepare("UPDATE anh_rows SET exportedBangRowId = ? WHERE id = ?").run(a.id, again);
    t.db.prepare("UPDATE bang_rows SET deletedAt = 'x' WHERE id = ?").run(a.id);
    expect(await (await t.app.request("/bang-anh")).text()).toContain(`Đã xuất → dòng #${a.id} (đã xoá trên Bảng video)`);
  });
});

describe("Cài đặt: mẫu yêu cầu và giới hạn ảnh", () => {
  it("lưu / khôi phục mẫu tạo ảnh; mẫu thiếu {prompt} bị từ chối; giới hạn ảnh lưu riêng", async () => {
    const t = setup();
    const save = await t.app.request("/settings/bang-anh", { method: "POST", body: form({ kind: "imageTemplate", action: "save", template: "Ảnh của {ten_nhan_vat}: {prompt}" }) });
    expect(save.status).toBe(303);
    expect(getSettings(t.db).imageTemplate).toBe("Ảnh của {ten_nhan_vat}: {prompt}");
    const id = addRow(t.db, { nhanVatId: t.nv, prompt: "cười" });
    expect(planAnhBatch(t.db, [id], getSettings(t.db), "").runs[0]!.text).toBe("Ảnh của Linh: cười");
    const bad = await t.app.request("/settings/bang-anh", { method: "POST", body: form({ kind: "imageTemplate", action: "save", template: "không có chỗ trống" }) });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Mẫu phải có: {prompt}");
    await t.app.request("/settings/bang-anh", { method: "POST", body: form({ kind: "imageTemplate", action: "reset" }) });
    expect(getSettings(t.db).imageTemplate).toBeNull();

    await t.app.request("/settings/run", {
      method: "POST",
      body: form({ timeoutMinutes: "20", pauseMinSec: "0", pauseMaxSec: "0", dailyVideoLimit: "100", dailyImageLimit: "40", parallelVideos: "3", museUrl: "" }),
    });
    expect(getSettings(t.db)).toMatchObject({ dailyImageLimit: 40, dailyVideoLimit: 100 });
    expect(await (await t.app.request("/settings")).text()).toContain("Mẫu yêu cầu cho Bảng ảnh");
  });
});

function db_parallel(db: DB, n: number) {
  db.prepare("UPDATE settings SET parallelVideos = ?").run(n);
}
