import { describe, expect, it, vi } from "vitest";
import { getBatch } from "../src/batch/create.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { setDriveRootFolder } from "../src/db/settings.js";
import { saveSheetConfig, type SheetConfig } from "../src/db/sheetConfigs.js";
import { DriveClient, FOLDER_MIME, type DriveFile } from "../src/google/drive.js";
import { GoogleApiError } from "../src/google/http.js";
import type { Grid, SheetsClient } from "../src/google/sheets.js";
import type { BatchRunner } from "../src/queue/runner.js";
import { ThumbnailCache } from "../src/scan/thumbnails.js";
import { createApp } from "../src/web/app.js";

// Màn hình Bảng + một nút Tạo video (CON-49, spec v5.0 D17, D19).

const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const TAB = "Trang tính1";
const ROOT = "1eTZ0IlgShDhv4wMfH6OZ1Uwo5ve9GIOB";
const VIDEO = "1ktAlBSjKy-C_uZfgBnTe_yWcmIShHLSI";
const KENH2 = "1KENH2folderxxxxxxxxxxxxxxxxx";
const NGOAI = "1NGOAIfolderxxxxxxxxxxxxxxxxx";
const CFG: SheetConfig = { spreadsheetId: ID, tab: TAB, headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D", colShirt: "E" };
const img = (id: string) => `https://drive.google.com/file/d/${id}/view`;

// Dòng 2–4 sẵn sàng (dòng 3 có ảnh áo), 5 đã có video, 6 thiếu prompt.
function grid(): Grid {
  return [
    ["Ảnh người mẫu", "Prompt", "Video", "Trạng Thái", "Ảnh áo"],
    [img("imgimgimg02"), "prompt 2", "", "", ""],
    [img("imgimgimg03"), "prompt 3", "", "", img("imgimgaoo03")],
    [img("imgimgimg04"), "prompt 4", "", "", ""],
    [img("imgimgimg05"), "prompt 5", "https://drive.google.com/file/d/vvvvvvvvvv/view", "Xong", ""],
    [img("imgimgimg06"), "", "", "", ""],
  ];
}

function setup(opts: { root?: string | null; noConfig?: boolean; limit?: number; runner?: boolean } = {}) {
  const sheetGrid = grid();
  const sheets = {
    readTab: vi.fn(async () => sheetGrid),
    readRow: async (_i: string, _t: string, row: number) => sheetGrid[row - 1] ?? [],
    getSpreadsheet: async () => ({ spreadsheetId: ID, title: "MASYS Video – Danh sách", tabs: [{ sheetId: 777, title: TAB, rowCount: 100, columnCount: 5 }] }),
    writeStatus: vi.fn(async () => {}),
  } as unknown as SheetsClient;
  const folders: Record<string, string> = { [ROOT]: "MASYS Video", [VIDEO]: "Video", [KENH2]: "Kênh 2", [NGOAI]: "Thư mục ngoài" };
  const getFile = async (id: string): Promise<DriveFile> => {
    if (folders[id]) return { id, name: folders[id]!, mimeType: FOLDER_MIME, trashed: false };
    if (id.startsWith("imgimg")) return { id, name: `${id}.jpg`, mimeType: "image/jpeg", trashed: false };
    throw new GoogleApiError(404, "File not found");
  };
  const drive = {
    getFile,
    getFolder: (id: string) => DriveClient.prototype.getFolder.call({ getFile }, id),
    listFolders: async (parent: string) => (parent === ROOT ? [{ id: KENH2, name: "Kênh 2" }, { id: VIDEO, name: "Video" }] : []),
    thumbnail: async () => ({ contentType: "image/jpeg", data: new Uint8Array([1]) }),
  } as unknown as DriveClient;
  const config = loadConfig({
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "bot@x.iam.gserviceaccount.com", private_key: "PK" }),
  });
  const db = openDatabase(":memory:");
  if (!opts.noConfig) saveSheetConfig(db, { ...CFG, spreadsheetTitle: "MASYS Video – Danh sách" });
  if (opts.root !== null) setDriveRootFolder(db, opts.root ?? ROOT);
  if (opts.limit) db.prepare("UPDATE settings SET dailyVideoLimit = ? WHERE id = 1").run(opts.limit);
  const runner = {
    runningBatchId: undefined as number | undefined,
    notices: new Map<number, string>(),
    start: vi.fn((batchId: number) => {
      db.prepare("UPDATE batches SET status = 'running' WHERE id = ?").run(batchId);
      return { ok: true as const };
    }),
    pause: vi.fn(() => true),
    cancel: vi.fn(() => ({ ok: true as const, immediate: true })),
  };
  const app = createApp(config, db, {
    sheets,
    drive,
    thumbs: new ThumbnailCache(drive),
    runner: opts.runner === false ? undefined : (runner as unknown as BatchRunner),
  });
  const run = (rows: number[], overwrite: number[] = [], extra: [string, string][] = []) =>
    app.request("/bang/run", {
      method: "POST",
      body: new URLSearchParams([
        ["id", ID],
        ["tab", TAB],
        ...rows.map((r) => ["row", String(r)] as [string, string]),
        ...overwrite.map((r) => ["overwrite", String(r)] as [string, string]),
        ...extra,
      ]),
    });
  return { app, db, sheets, runner, run, sheetGrid };
}

const query = (r: Response) => new URL(r.headers.get("location")!, "http://x").searchParams;

describe("Bảng (CON-49)", () => {
  it("trang chủ là Bảng: mỗi dòng sheet, ảnh người mẫu + ảnh áo, prompt, video, nhãn; menu ⚙ Nâng cao", async () => {
    const { app } = setup();
    const r = await app.request("/bang-sheet");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('id="bang"');
    for (const n of [2, 3, 4, 5, 6]) expect(html).toContain(`data-row="${n}"`);
    expect(html).toContain('src="/thumb/imgimgaoo03"');
    expect(html).toContain('href="https://drive.google.com/file/d/imgimgimg02/view"');
    expect(html).toContain("▶ Xem");
    expect(html).toContain("Sẵn sàng");
    expect(html).toContain("Đã có video");
    expect(html).toContain("Thiếu dữ liệu");
    expect(html).toContain("⚙ Nâng cao");
    expect(html).toContain("☑ Chọn mọi dòng chưa có video (3)");
    expect(html).toContain("Hôm nay <strong>0/100</strong> video");
    // Dòng thiếu prompt và dòng đã có video không tích được; dòng đã có video có Ghi đè.
    expect(html).toMatch(/value="6" form="run" disabled=""/);
    expect(html).toMatch(/class="ow" name="overwrite" value="5"/);
    // Bảng tự hiện lô nên không có dải báo lô; nhớ sheet/tab lần dùng.
    expect(r.headers.get("set-cookie")).toContain("masys_bang=");
  });

  it("chưa kết nối sheet nào: trang chủ là các bước bắt đầu (CON-51); /gioi-thieu cũ chuyển sang Hướng dẫn", async () => {
    const { app } = setup({ noConfig: true });
    const html = await (await app.request("/bang-sheet")).text();
    expect(html).not.toContain('id="bang"');
    expect(html).toContain("Bắt đầu trong 4 bước");
    expect((await app.request("/gioi-thieu")).headers.get("location")).toBe("/huong-dan");
    expect((await app.request("/huong-dan")).status).toBe(200);
  });

  it("Tạo video: tạo lô với thư mục mặc định (thư mục con Video), prompt trong sheet, rồi chạy luôn", async () => {
    const { run, db, runner } = setup();
    const r = await run([2, 3]);
    expect(r.status).toBe(303);
    expect(query(r).get("ok")).toContain("Đang tạo video cho 2 dòng");
    expect(runner.start).toHaveBeenCalledOnce();
    const b = getBatch(db, runner.start.mock.calls[0]![0])!;
    expect(b.driveFolderId).toBe(VIDEO);
    expect(b.status).toBe("running");
    expect(b.runs.map((x) => x.rowNumber)).toEqual([2, 3]);
    expect(b.runs[0]!.promptSent).toBe("prompt 2");
    expect(b.runs[1]!.requestText).toContain(`Ảnh áo: ${img("imgimgaoo03")}`);
    expect(b.runs[0]!.requestText).not.toContain("Ảnh áo:");
  });

  it("bỏ dòng không chạy được (đã có video mà không Ghi đè, thiếu prompt); Ghi đè thì nhận", async () => {
    const { run, db, runner } = setup();
    const r = await run([4, 5, 6]);
    expect(query(r).get("ok")).toContain("Bỏ qua vì dữ liệu vừa đổi: dòng 5 (Đã có video); dòng 6 (Thiếu dữ liệu)");
    expect(getBatch(db, runner.start.mock.calls[0]![0])!.runs.map((x) => x.rowNumber)).toEqual([4]);

    const s2 = setup();
    await s2.run([5], [5]);
    expect(getBatch(s2.db, s2.runner.start.mock.calls[0]![0])!.runs[0]).toMatchObject({ rowNumber: 5, overwrite: 1 });
  });

  it("vượt giới hạn ngày, chưa đặt thư mục Drive, không chọn gì: báo rõ, không tạo lô", async () => {
    const a = setup({ limit: 1 });
    expect(query(await a.run([2, 3])).get("msg")).toContain("hôm nay chỉ còn 1 video");
    const b = setup({ root: null });
    expect(query(await b.run([2])).get("msg")).toContain("Chưa chọn thư mục Drive lưu video");
    const c = setup();
    expect(query(await c.run([])).get("msg")).toBe("Chưa chọn dòng nào.");
    for (const s of [a, b, c]) {
      expect(s.runner.start).not.toHaveBeenCalled();
      expect((s.db.prepare("SELECT COUNT(*) AS n FROM batches").get() as { n: number }).n).toBe(0);
    }
  });

  it("đang có lô chưa xong: không tạo lô mới; Bảng hiện tiến độ, Tạm dừng / Tiếp tục / Huỷ", async () => {
    const { app, run, db, runner } = setup();
    await run([2, 3]);
    const batchId = runner.start.mock.calls[0]![0];
    runner.runningBatchId = batchId;
    db.prepare("UPDATE runs SET state = 'waiting' WHERE rowNumber = 2").run();
    let html = await (await app.request("/bang-sheet")).text();
    expect(html).toContain("Đang tạo video: 0/2 dòng xong");
    expect(html).toContain("Chờ Muse làm video");
    expect(html).toContain('data-live="1"');
    expect(html).toContain('data-blocked="1"');
    expect(html).toContain('action="/bang/pause"');
    expect(query(await run([4])).get("msg")).toContain(`Lô #${batchId} chưa xong`);

    // Tạm dừng vì cần đăng nhập Muse: nói rõ phải làm gì, có nút Tiếp tục.
    runner.runningBatchId = undefined;
    db.prepare("UPDATE batches SET status = 'paused', pauseReason = 'login' WHERE id = ?").run(batchId);
    html = await (await app.request("/bang-sheet")).text();
    expect(html).toContain("Hãy đăng nhập Muse trong cửa sổ bot");
    expect(html).toContain("⚠ Cần đăng nhập Muse");
    expect(html).toContain('action="/bang/continue"');
    const r = await app.request("/bang/continue", { method: "POST", body: new URLSearchParams({ batch: String(batchId), id: ID, tab: TAB }) });
    expect(runner.start).toHaveBeenLastCalledWith(batchId);
    expect(r.headers.get("location")).toContain("/bang-sheet?id=");
  });

  it("làm mới: /bang/state đổi khi sheet hoặc lô đổi; xem yêu cầu gửi Muse từng dòng", async () => {
    const { app, sheetGrid } = setup();
    const s1 = (await (await app.request(`/bang/state?id=${ID}&tab=${encodeURIComponent(TAB)}`)).json()) as { batch: string; data: string };
    sheetGrid[1]![1] = "prompt 2 đã sửa trên sheet";
    const s2 = (await (await app.request(`/bang/state?id=${ID}&tab=${encodeURIComponent(TAB)}`)).json()) as { batch: string; data: string };
    expect(s1.batch).toBe("none");
    expect(s2.data).not.toBe(s1.data);
    const text = await (await app.request(`/bang/preview?id=${ID}&tab=${encodeURIComponent(TAB)}&row=3`)).text();
    expect(text).toContain("prompt 3");
    expect(text).toContain(`Ảnh áo: ${img("imgimgaoo03")}`);
    expect(text).toContain(`https://drive.google.com/drive/folders/${VIDEO}`);
  });

  it("chưa có bot / khoá Google: nút Tạo video khoá, bấm cũng không tạo lô", async () => {
    const { app, run, db } = setup({ runner: false });
    expect(await (await app.request("/bang-sheet")).text()).toContain('data-blocked="1"');
    expect(query(await run([2])).get("msg")).toContain("Chưa nạp được khoá Google");
    expect((db.prepare("SELECT COUNT(*) AS n FROM batches").get() as { n: number }).n).toBe(0);
  });

  it("ô Lưu video vào: mặc định thư mục Video; chọn thư mục con khác hoặc dán link; nhớ lần trước", async () => {
    const { app, run, db, runner } = setup();
    const html = await (await app.request("/bang-sheet")).text();
    expect(html).toContain(`<option value="${VIDEO}" selected="">📁 MASYS Video / Video`);
    expect(html).toContain("📁 MASYS Video (thư mục gốc)");
    expect(html).toContain("Dán link thư mục khác…");

    const r1 = await run([2], [], [["folder", KENH2]]);
    expect(getBatch(db, runner.start.mock.calls[0]![0])!.driveFolderId).toBe(KENH2);
    expect(r1.headers.get("set-cookie")).toContain(`masys_folder=${KENH2}`);
    // Lần sau mở Bảng, thư mục vừa dùng được chọn sẵn.
    const again = await (await app.request("/bang-sheet", { headers: { cookie: `masys_folder=${KENH2}` } })).text();
    expect(again).toContain(`<option value="${KENH2}" selected="">`);

    db.prepare("UPDATE batches SET status = 'done'").run();
    await run([3], [], [["folder", "__link"], ["folderLink", `https://drive.google.com/drive/folders/${NGOAI}?usp=sharing`]]);
    expect(getBatch(db, runner.start.mock.calls[1]![0])!.driveFolderId).toBe(NGOAI);
    // Thư mục ngoài dán lần trước vẫn hiện trong danh sách.
    expect(await (await app.request("/bang-sheet", { headers: { cookie: `masys_folder=${NGOAI}` } })).text()).toContain("📁 Thư mục ngoài");
  });

  it("link thư mục sai hoặc không mở được: báo, không tạo lô; xem trước theo thư mục chọn", async () => {
    const { run, db, app } = setup();
    const msg = async (extra: [string, string][]) => query(await run([2], [], extra)).get("msg");
    expect(await msg([["folder", "__link"], ["folderLink", "https://drive.google.com/file/d/abcdefghijk/view"]])).toContain("Link thư mục không đúng dạng");
    expect(await msg([["folder", "__link"], ["folderLink", ""]])).toContain("Chưa dán link thư mục");
    expect(await msg([["folder", "1KHONGCOfolderxxxxxxxxxxxxxx"]])).toContain("Không mở được thư mục");
    expect((db.prepare("SELECT COUNT(*) AS n FROM batches").get() as { n: number }).n).toBe(0);
    const text = await (await app.request(`/bang/preview?id=${ID}&tab=${encodeURIComponent(TAB)}&row=2&folder=${KENH2}`)).text();
    expect(text).toContain(`https://drive.google.com/drive/folders/${KENH2}`);
  });

  it("+ Thêm sheet: mở Kết nối nhanh; lưu ánh xạ xong quay về Bảng với trang tính mới", async () => {
    const { app } = setup();
    expect(await (await app.request("/bang-sheet")).text()).toContain('href="/ket-noi"');
    expect((await app.request("/bang/them-sheet")).headers.get("location")).toBe("/ket-noi");
    // Bản cũ đánh dấu quay về Bảng bằng cookie; vẫn nhận.
    const save = (cookie: string) =>
      app.request("/sheets/map", {
        method: "POST",
        headers: { cookie },
        body: new URLSearchParams({ id: ID, tab: "Kênh 2", headerRow: "1", colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" }),
      });
    const r = await save("masys_back=bang");
    const back = new URL(r.headers.get("location")!, "http://x");
    expect(back.pathname).toBe("/bang-sheet");
    expect(back.searchParams.get("tab")).toBe("Kênh 2");
    expect(back.searchParams.get("ok")).toBe('Đã thêm trang tính "Kênh 2".');
    // Vào Kết nối sheet theo đường thường thì vẫn ở lại trang Kết nối sheet như cũ.
    expect((await save("")).headers.get("location")).toBe(`/sheets?saved=${encodeURIComponent("Kênh 2")}`);
  });
});
