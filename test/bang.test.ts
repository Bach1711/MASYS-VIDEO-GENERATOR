import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageProblem, sniffImage, BangFiles, MAX_IMAGE_BYTES } from "../src/bang/files.js";
import { planImport, runImport } from "../src/bang/importSheet.js";
import { addRow, countByFilter, getRow, importedKeys, labelOf, listRows, lockedBangRows, planBangFill, PER_PAGE } from "../src/bang/rows.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { saveSheetConfig, type SheetConfig } from "../src/db/sheetConfigs.js";
import { getSettings, parseRunSettings } from "../src/db/settings.js";
import type { DriveClient } from "../src/google/drive.js";
import { GoogleApiError } from "../src/google/http.js";
import type { Grid, SheetsClient } from "../src/google/sheets.js";
import { createApp } from "../src/web/app.js";

// Bảng mới (CON-71, spec v6.0 mục 17, D21, D22, D25).

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
const GIF = new Uint8Array([...Buffer.from("GIF89a"), 0, 0]);

const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const TAB = "Trang tính1";
const CFG: SheetConfig = { spreadsheetId: ID, tab: TAB, headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D", colShirt: "E" };
const link = (id: string) => `https://drive.google.com/file/d/${id}/view`;

const dirs: string[] = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "masys-bang-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const row = (o: Partial<Parameters<typeof labelOf>[0]> = {}) => ({
  id: 1, createdAt: "", prompt: "", modelFront: null, shirtFront: null, modelBack: null, shirtBack: null, videoFile: null, videoBytes: null, videoAt: null, importedFrom: null, runState: null as string | null, ...o,
});

describe("ảnh chọn từ máy (17.2, 17.3)", () => {
  it("nhận JPG / PNG / WEBP theo byte đầu, từ chối GIF, file trống, quá 20 MB", () => {
    expect([sniffImage(JPG), sniffImage(PNG), sniffImage(WEBP), sniffImage(GIF)]).toEqual(["jpg", "png", "webp", null]);
    expect(imageProblem(new Uint8Array())).toBe("File trống.");
    expect(imageProblem(GIF)).toContain("JPG, PNG hoặc WEBP");
    expect(imageProblem(new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0xff))).toContain("tối đa 20 MB");
    expect(imageProblem(PNG)).toBeNull();
  });

  it("tool tự đặt tên file, chỉ phục vụ tên an toàn trong thư mục ảnh", () => {
    const files = new BangFiles(tmpDir());
    const name = files.saveImage("7-mau-truoc", PNG);
    expect(name).toMatch(/^7-mau-truoc-[a-z0-9]+\.png$/);
    expect(files.imagePath(name)).toBeDefined();
    expect(files.imagePath("../data.db")).toBeUndefined();
    expect(files.imagePath("..\\data.db")).toBeUndefined();
    files.removeImage(name);
    expect(files.imagePath(name)).toBeUndefined();
  });
});

describe("nhãn và bộ lọc (17.4)", () => {
  it("cần mẫu trước + prompt; có mặt sau thì cần đủ 4 ảnh", () => {
    expect(labelOf(row({ modelFront: "a.png", prompt: "đi bộ" })).label).toBe("ready");
    expect(labelOf(row({ modelFront: "a.png", shirtFront: "b.png", prompt: "đi bộ" })).label).toBe("ready");
    expect(labelOf(row({ prompt: "đi bộ" })).problems).toEqual(["Thiếu ảnh người mẫu mặt trước"]);
    const back = labelOf(row({ modelFront: "a.png", modelBack: "c.png", prompt: "x" }));
    expect(back.label).toBe("missing_data");
    expect(back.problems[0]).toContain("Áo trước, Áo sau");
    expect(labelOf(row({ modelFront: "a", shirtFront: "b", modelBack: "c", shirtBack: "d", prompt: "x" })).label).toBe("ready");
    expect(labelOf(row({ modelFront: "a", prompt: "x", videoFile: "v.mp4" })).label).toBe("done");
  });

  it("đếm theo bộ lọc khớp nhãn; tìm theo số dòng hoặc chữ; 50 dòng một trang, mới nhất trước", () => {
    const db = openDatabase(":memory:");
    addRow(db, { prompt: "vẫy tay", modelFront: "a.png" }); // 1 sẵn sàng
    addRow(db, { prompt: "xoay người" }); // 2 thiếu ảnh
    addRow(db, { prompt: "cười 100%", modelFront: "a.png", modelBack: "b.png" }); // 3 thiếu mặt sau
    const id4 = addRow(db, { prompt: "vẫy tay", modelFront: "a.png" });
    db.prepare("UPDATE bang_rows SET videoFile = 'v.mp4' WHERE id = ?").run(id4);
    expect(countByFilter(db)).toEqual({ all: 4, today: 4, todo: 1, missing: 2, running: 0, done: 1, review: 0 });
    expect(listRows(db, { filter: "missing" }).rows.map((r) => r.id)).toEqual([3, 2]);
    expect(listRows(db, { q: "vẫy" }).rows.map((r) => r.id)).toEqual([4, 1]);
    expect(listRows(db, { q: "2" }).rows.map((r) => r.id)).toEqual([2]);
    expect(listRows(db, { q: "100%" }).rows.map((r) => r.id)).toEqual([3]);
    expect(listRows(db, { q: "%" }).rows.map((r) => r.id)).toEqual([3]);
    for (let i = 0; i < 100; i++) addRow(db, { prompt: `p${i}` });
    const p1 = listRows(db);
    expect([p1.total, p1.pages, p1.rows.length, p1.rows[0]!.id]).toEqual([104, 3, PER_PAGE, 104]);
    expect(listRows(db, { page: 3 }).rows.map((r) => r.id)).toEqual([4, 3, 2, 1]);
    expect(listRows(db, { page: 99 }).page).toBe(3);
  });

  it("dải prompt bỏ qua dòng đã có video (trừ khi tích), dòng đang chạy, dòng đã cùng prompt", () => {
    const db = openDatabase(":memory:");
    const src = addRow(db, { prompt: "vẫy tay" });
    const same = addRow(db, { prompt: "vẫy tay" });
    const video = addRow(db, { prompt: "khác" });
    db.prepare("UPDATE bang_rows SET videoFile = 'v.mp4' WHERE id = ?").run(video);
    const free = addRow(db);
    const busy = addRow(db);
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (1, 'x', 'y', 'f', 'running')").run();
    db.prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, state, bangRowId) VALUES (1, 0, '{}', 'sending', ?)").run(busy);
    expect(lockedBangRows(db)).toEqual(new Set([busy]));
    const plan = planBangFill(db, src, [same, video, free, busy, 99], false);
    expect(plan).toMatchObject({ prompt: "vẫy tay", targets: [free] });
    expect("skipped" in plan && plan.skipped.map((s) => s.why)).toEqual(["đã cùng prompt", "đã có video", "đang tạo video", "không có dòng này"]);
    expect(planBangFill(db, src, [video], true)).toMatchObject({ targets: [video] });
    expect(planBangFill(db, free, [src], false)).toEqual({ error: `Dòng ${free} chưa có prompt.` });
  });
});

describe("giới hạn ngày (D25)", () => {
  it("mặc định 100, đặt được tới 150", () => {
    const db = openDatabase(":memory:");
    expect(getSettings(db).dailyVideoLimit).toBe(100);
    const base = { timeoutMinutes: "20", pauseMinSec: "20", pauseMaxSec: "60", museUrl: "https://muse.ai/" };
    expect(parseRunSettings({ ...base, dailyVideoLimit: "150" })).toMatchObject({ ok: true, value: { dailyVideoLimit: 150 } });
    expect(parseRunSettings({ ...base, dailyVideoLimit: "151" })).toMatchObject({ ok: false, errors: ["Giới hạn video mỗi ngày phải là số từ 1 đến 150."] });
  });
});

describe("nhập từ Google Sheet (17.6)", () => {
  const grid: Grid = [
    ["Ảnh người mẫu", "Prompt", "Video", "Trạng Thái", "Ảnh áo"],
    [link("imgOK000002"), "prompt 2", "", "", link("aoOK0000002")],
    [link("imgOK000003"), "prompt 3", link("vid"), "Xong", ""],
    ["", "", "", "", ""],
    [link("imgGIF00005"), "prompt 5", "", "", "https://example.com/ao.png"],
    [link("imgMAT00006"), "", "", "", ""],
  ];
  const drive = {
    download: vi.fn(async (id: string) => {
      if (id.startsWith("imgOK") || id.startsWith("aoOK")) return { contentType: "image/png", data: PNG };
      if (id.startsWith("imgGIF")) return { contentType: "image/gif", data: GIF };
      throw new GoogleApiError(404, "File not found");
    }),
  } as unknown as DriveClient;

  it("chỉ đọc: bỏ dòng trống, dòng đã có video, dòng đã nhập; ảnh lỗi thì dòng vẫn được thêm", async () => {
    const db = openDatabase(":memory:");
    const files = new BangFiles(tmpDir());
    const plan = planImport(grid, CFG, new Set(), false);
    expect(plan.add.map((a) => a.row)).toEqual([2, 5, 6]);
    expect(plan.skipped).toEqual([{ row: 3, why: "đã có video" }]);
    expect(planImport(grid, CFG, new Set(), true).add.map((a) => a.row)).toEqual([2, 3, 5, 6]);

    const r = await runImport(db, files, drive, plan, "bot@x.iam.gserviceaccount.com");
    expect(r.added).toEqual([{ row: 2, id: 1 }, { row: 5, id: 2 }, { row: 6, id: 3 }]);
    const r1 = getRow(db, 1)!;
    expect([r1.prompt, labelOf(r1).label]).toEqual(["prompt 2", "ready"]);
    expect(r1.modelFront).toMatch(/^1-mau-truoc-.*\.png$/);
    expect(r1.shirtFront).toMatch(/^1-ao-truoc-.*\.png$/);
    expect(getRow(db, 2)!.modelFront).toBeNull();
    expect(r.problems).toHaveLength(3);
    expect(r.problems[0]).toContain("Dòng sheet 5 → dòng 2, Mẫu trước: Chỉ nhận ảnh JPG");
    expect(r.problems[1]).toContain("Áo trước: link không phải Google Drive");
    expect(r.problems[2]).toContain("bot@x.iam.gserviceaccount.com");

    const again = planImport(grid, CFG, importedKeys(db, `${ID}|${TAB}|`), false);
    expect(again.add).toEqual([]);
    expect(again.skipped.filter((s) => s.why === "đã nhập lần trước").map((s) => s.row)).toEqual([2, 5, 6]);
  });
});

describe("trang Bảng mới", () => {
  function setup() {
    const dataDir = tmpDir();
    const config = loadConfig({
      MASYS_DATA_DIR: dataDir,
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "bot@x.iam.gserviceaccount.com", private_key: "PK" }),
    });
    const db = openDatabase(":memory:");
    saveSheetConfig(db, { ...CFG, spreadsheetTitle: "MASYS Video – Danh sách" });
    const sheets = { readTab: vi.fn(async () => [grid0[0]!, [link("imgOK000002"), "prompt 2", "", "", ""]]), writeStatus: vi.fn() } as unknown as SheetsClient;
    const drive = { download: vi.fn(async () => ({ contentType: "image/png", data: PNG })) } as unknown as DriveClient;
    const app = createApp(config, db, { sheets, drive });
    return { app, db, sheets, dataDir };
  }
  const grid0: Grid = [["Ảnh người mẫu", "Prompt", "Video", "Trạng Thái", "Ảnh áo"]];
  const H = { "X-Masys": "1" };
  const form = (entries: [string, string | Blob, string?][]) => {
    const fd = new FormData();
    for (const [k, v, n] of entries) (typeof v === "string" ? fd.append(k, v) : fd.append(k, v, n));
    return fd;
  };

  it("trang chủ là Bảng mới (v2.0.0), menu Nâng cao có Bảng theo sheet; trang trống có hướng dẫn và nút Tạo video tạm khoá", async () => {
    const { app } = setup();
    const html = await (await app.request("/")).text();
    expect(html).toContain('href="/bang-sheet"');
    expect(html).toContain('id="bangmoi"');
    expect(await (await app.request("/bang-moi")).text()).toContain('id="bangmoi"');
    expect(html).toContain("Chưa có dòng nào");
    expect(html).toContain("Hôm nay 0/100");
    expect(html).toMatch(/<button type="button" id="runBtn" disabled/);
    expect(html).toContain("Tích các dòng cần tạo video.");
  });

  it("thêm dòng từ nhiều ảnh, đặt / bỏ ảnh từng ô, sửa prompt; yêu cầu thiếu header riêng bị chặn", async () => {
    const { app, db, dataDir } = setup();
    const add = await app.request("/bang-moi/them", {
      method: "POST",
      headers: H,
      body: form([["files", new Blob([PNG]), "a.png"], ["files", new Blob([GIF]), "b.gif"], ["files", new Blob([JPG]), "c.jpg"]]),
    });
    const r = (await add.json()) as { ids: number[]; problems: string[] };
    expect(r.ids).toEqual([1, 2]);
    expect(r.problems).toEqual(["b.gif: Chỉ nhận ảnh JPG, PNG hoặc WEBP."]);
    expect(getRow(db, 2)!.modelFront).toMatch(/\.jpg$/);

    expect((await app.request("/bang-moi/them", { method: "POST", body: form([]) })).status).toBe(403);

    const put = await app.request("/bang-moi/anh", { method: "POST", headers: H, body: form([["row", "1"], ["slot", "shirtFront"], ["file", new Blob([WEBP]), "ao.webp"]]) });
    const name = ((await put.json()) as { name: string }).name;
    expect(getRow(db, 1)!.shirtFront).toBe(name);
    const img = await app.request(`/bang-moi/anh/${name}`);
    expect([img.status, img.headers.get("content-type")]).toEqual([200, "image/webp"]);
    expect((await app.request("/bang-moi/anh/..%2Fdata.db")).status).toBe(404);

    const bad = await app.request("/bang-moi/anh", { method: "POST", headers: H, body: form([["row", "1"], ["slot", "videoFile"], ["file", new Blob([PNG]), "x.png"]]) });
    expect(bad.status).toBe(400);

    const json = (p: string, b: unknown) => app.request(p, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(b) });
    expect(await (await json("/bang-moi/bo-anh", { row: 1, slot: "shirtFront" })).json()).toEqual({ ok: true });
    expect(getRow(db, 1)!.shirtFront).toBeNull();
    expect(fs.readdirSync(path.join(dataDir, "tep", "anh")).filter((f) => f.startsWith("1-ao-truoc"))).toEqual([]);

    await json("/bang-moi/prompt", { row: 1, prompt: "  vẫy tay  " });
    expect(getRow(db, 1)!.prompt).toBe("vẫy tay");
    const prev = (await (await json("/bang-moi/dai-prompt/xem", { source: 1, mode: "down" })).json()) as { count: number; summary: string };
    expect(prev).toMatchObject({ count: 1, summary: "Sẽ thay prompt của 1 dòng (dòng 2) bằng prompt của dòng 1." });
    await json("/bang-moi/dai-prompt", { source: 1, mode: "rows", rows: "2" });
    expect(getRow(db, 2)!.prompt).toBe("vẫy tay");

    const html = await (await app.request("/bang-moi")).text();
    expect(html).toContain('data-ready="2,1"');
    expect(html).toContain("Chưa tạo (2)");
  });

  it("dòng đang tạo video thì không sửa được", async () => {
    const { app, db } = setup();
    const id = addRow(db, { prompt: "x" });
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (1, 'x', 'y', 'f', 'running')").run();
    db.prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, state, bangRowId) VALUES (1, 0, '{}', 'waiting_video', ?)").run(id);
    const res = await app.request("/bang-moi/prompt", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ row: id, prompt: "y" }) });
    expect(res.status).toBe(409);
    expect(getRow(db, id)!.prompt).toBe("x");
    expect(await (await app.request("/bang-moi")).text()).toContain("Đang chạy");
  });

  it("nhập từ sheet: xem trước 'Sẽ thêm N dòng', bấm Nhập mới thêm; không ghi gì lên sheet", async () => {
    const { app, db, sheets } = setup();
    const post = (step: string) => app.request("/bang-moi/nhap", { method: "POST", body: new URLSearchParams({ sheet: `${ID}|${TAB}`, step }) });
    const prev = await (await post("preview")).text();
    expect(prev).toContain("Sẽ thêm 1 dòng (dòng sheet 2).");
    expect(listRows(db).total).toBe(0);
    const go = await post("go");
    expect(go.status).toBe(303);
    expect(new URL(go.headers.get("location")!, "http://x").searchParams.get("ok")).toContain("Đã nhập 1 dòng");
    expect(getRow(db, 1)!.modelFront).toMatch(/\.png$/);
    expect((sheets as unknown as { writeStatus: ReturnType<typeof vi.fn> }).writeStatus).not.toHaveBeenCalled();
    expect(await (await post("preview")).text()).toContain("đã nhập lần trước");
  });
});
