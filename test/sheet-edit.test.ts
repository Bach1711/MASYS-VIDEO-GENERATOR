import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { setDriveRootFolder } from "../src/db/settings.js";
import { saveSheetConfig, type SheetConfig } from "../src/db/sheetConfigs.js";
import { listSheetEdits } from "../src/db/sheetEdits.js";
import { columnIndex } from "../src/google/a1.js";
import { DriveClient, FOLDER_MIME, type DriveFile } from "../src/google/drive.js";
import { GoogleApiError } from "../src/google/http.js";
import type { Grid, SheetsClient } from "../src/google/sheets.js";
import { ThumbnailCache } from "../src/scan/thumbnails.js";
import { parseRowList } from "../src/sheetEdit/edit.js";
import { createApp } from "../src/web/app.js";

// Sửa ngay trên Bảng (CON-50, spec v5.0 mục 16.3, D18).

const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const TAB = "Trang tính1";
const ROOT = "1eTZ0IlgShDhv4wMfH6OZ1Uwo5ve9GIOB";
const CFG: SheetConfig = { spreadsheetId: ID, tab: TAB, headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D", colShirt: "E" };
const img = (id: string) => `https://drive.google.com/file/d/${id}/view`;

// Dòng 2–4 sẵn sàng, 5 đã có video, 6 thiếu prompt.
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

function setup(opts: { rowCount?: number } = {}) {
  const g = grid();
  const get = (col: string, row: number) => g[row - 1]?.[columnIndex(col)] ?? "";
  const set = (col: string, row: number, value: string) => {
    while (g.length < row) g.push([]);
    const r = g[row - 1]!;
    while (r.length <= columnIndex(col)) r.push("");
    r[columnIndex(col)] = value;
  };
  const writes: string[] = [];
  const sheets = {
    readTab: async () => g.map((r) => [...r]),
    readRow: async (_i: string, _t: string, row: number) => [...(g[row - 1] ?? [])],
    readCells: async (_i: string, _t: string, cells: { col: string; row: number }[]) => cells.map((c) => get(c.col, c.row)),
    writeDataCells: vi.fn(async (_cfg: SheetConfig, cells: { col: string; row: number; value: string }[]) => {
      for (const c of cells) {
        writes.push(`${c.col}${c.row}=${c.value}`);
        set(c.col, c.row, c.value);
      }
    }),
    ensureRows: vi.fn(async () => {}),
    writeStatus: vi.fn(async () => {}),
    getSpreadsheet: async () => ({ spreadsheetId: ID, title: "MASYS", tabs: [{ sheetId: 0, title: TAB, rowCount: opts.rowCount ?? 100, columnCount: 5 }] }),
  } as unknown as SheetsClient & { ensureRows: ReturnType<typeof vi.fn> };
  const getFile = async (id: string): Promise<DriveFile> => {
    if (id === ROOT) return { id, name: "MASYS Video", mimeType: FOLDER_MIME, trashed: false };
    if (id.startsWith("imgimg")) return { id, name: `${id}.jpg`, mimeType: "image/jpeg", trashed: false };
    if (id.startsWith("videoo")) return { id, name: `${id}.mp4`, mimeType: "video/mp4", trashed: false };
    throw new GoogleApiError(404, "File not found");
  };
  const drive = {
    getFile,
    getFolder: (id: string) => DriveClient.prototype.getFolder.call({ getFile }, id),
    listFolders: async () => [],
    thumbnail: async () => ({ contentType: "image/jpeg", data: new Uint8Array([1]) }),
  } as unknown as DriveClient;
  const config = loadConfig({
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "bot@x.iam.gserviceaccount.com", private_key: "PK" }),
  });
  const db = openDatabase(":memory:");
  saveSheetConfig(db, CFG);
  setDriveRootFolder(db, ROOT);
  const app = createApp(config, db, { sheets, drive, thumbs: new ThumbnailCache(drive) });
  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ID, tab: TAB, ...body }) });
    return (await r.json()) as Record<string, unknown> & { ok: boolean; message?: string };
  };
  /** Đưa dòng vào một lô đang chạy (khoá sửa). */
  const lock = (row: number, state = "waiting") => {
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (50, ?, ?, 'F', 'running') ON CONFLICT DO NOTHING").run(ID, TAB);
    db.prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, state) VALUES (50, ?, '{}', ?)").run(row, state);
  };
  return { app, db, g, set, writes, sheets, post, lock };
}

describe("Sửa một ô trên Bảng (CON-50)", () => {
  it("sửa prompt: đọc lại ô, ghi đúng ô đó lên sheet, ghi nhật ký (ô, cũ, mới, giờ)", async () => {
    const t = setup();
    const r = await t.post("/bang/sua", { row: 3, field: "prompt", expected: "prompt 3", value: "  prompt 3 mới\r\ndòng hai  " });
    expect(r).toEqual({ ok: true, changed: true });
    expect(t.writes).toEqual(["B3=prompt 3 mới\ndòng hai"]);
    const [e] = listSheetEdits(t.db);
    expect(e).toMatchObject({ cell: "B3", row: 3, field: "prompt", oldValue: "prompt 3", newValue: "prompt 3 mới\ndòng hai", kind: "edit" });
    expect(e!.at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("người khác vừa sửa ô trên sheet: không ghi, báo và trả giá trị mới; lưu lần nữa thì ghi", async () => {
    const t = setup();
    t.set("B", 3, "prompt 3 do người khác sửa");
    const r = await t.post("/bang/sua", { row: 3, field: "prompt", expected: "prompt 3", value: "của tôi" });
    expect(r).toMatchObject({ ok: false, conflict: true, current: "prompt 3 do người khác sửa" });
    expect(r.message).toContain("Ô này vừa được người khác sửa");
    expect(t.writes).toEqual([]);
    // Bấm Lưu lần nữa: khung sửa gửi giá trị mới làm "expected".
    expect(await t.post("/bang/sua", { row: 3, field: "prompt", expected: "prompt 3 do người khác sửa", value: "của tôi" })).toMatchObject({ ok: true });
    expect(t.writes).toEqual(["B3=của tôi"]);
  });

  it("dán link ảnh: kiểm tra như F3 trước khi ghi; sai thì báo, không ghi", async () => {
    const t = setup();
    const bad = async (value: string, field = "image") => (await t.post("/bang/sua", { row: 2, field, expected: field === "image" ? img("imgimgimg02") : "", value })).message;
    expect(await bad("https://example.com/a.jpg")).toContain("không phải link Google Drive");
    expect(await bad("https://drive.google.com/drive/folders/1abcdefghijkl")).toContain("là thư mục");
    expect(await bad(img("khongcofile1"))).toContain("Tool không mở được ảnh người mẫu");
    expect(await bad(img("videooooo01"), "shirt")).toContain("File không phải ảnh");
    expect(t.writes).toEqual([]);
    expect(await t.post("/bang/sua", { row: 2, field: "shirt", expected: "", value: img("imgimgaoo02") })).toMatchObject({ ok: true, changed: true });
    expect(t.writes).toEqual([`E2=${img("imgimgaoo02")}`]);
  });

  it("dòng đang trong lô (hoặc Đang chạy trên sheet) khoá sửa; Bảng không có nút ✎ ở dòng đó", async () => {
    const t = setup();
    t.lock(3);
    expect((await t.post("/bang/sua", { row: 3, field: "prompt", expected: "prompt 3", value: "x" })).message).toContain("đang tạo video");
    t.set("D", 4, "Đang chạy");
    expect((await t.post("/bang/sua", { row: 4, field: "prompt", expected: "prompt 4", value: "x" })).message).toContain("đang tạo video");
    expect(t.writes).toEqual([]);
    const html = await (await t.app.request("/")).text();
    const rowHtml = (n: number) => html.slice(html.indexOf(`<tr data-row="${n}"`), html.indexOf("</tr>", html.indexOf(`<tr data-row="${n}"`)));
    expect(rowHtml(2)).toContain('class="edit"');
    expect(rowHtml(3)).not.toContain('class="edit"');
    expect(rowHtml(4)).not.toContain('class="edit"');
    // Lượt của dòng đã xong (lô vẫn chạy dòng khác) thì mở khoá.
    t.db.prepare("UPDATE runs SET state = 'done' WHERE rowNumber = 3").run();
    expect(await t.post("/bang/sua", { row: 3, field: "prompt", expected: "prompt 3", value: "x" })).toMatchObject({ ok: true });
  });

  it("ô là công thức, ô Video / Trạng thái, cột Ảnh áo khi sheet không có: không ghi", async () => {
    const t = setup();
    t.set("B", 2, "=B3");
    expect((await t.post("/bang/sua", { row: 2, field: "prompt", expected: "=B3", value: "x" })).message).toContain("công thức");
    expect((await t.post("/bang/sua", { row: 2, field: "video", expected: "", value: "x" })).message).toContain("không sửa được");
    expect((await t.post("/bang/sua", { row: 2, field: "status", expected: "", value: "x" })).message).toContain("không sửa được");
    expect((await t.post("/bang/sua", { row: 1, field: "prompt", expected: "Prompt", value: "x" })).message).toBe("Dòng không hợp lệ.");
    expect(t.writes).toEqual([]);
  });

  it("chỉ nhận JSON (trang khác không gửi lén được)", async () => {
    const t = setup();
    const r = await t.app.request("/bang/sua", { method: "POST", body: new URLSearchParams({ id: ID, tab: TAB, row: "2", field: "prompt", expected: "prompt 2", value: "x" }) });
    expect(r.status).toBe(415);
    expect(t.writes).toEqual([]);
  });
});

describe("Dải prompt (CON-50)", () => {
  it("áp cho các dòng đã chọn: xem trước đếm dòng, bỏ qua dòng đã có video; xác nhận rồi mới ghi", async () => {
    const t = setup();
    const plan = await t.post("/bang/dai-prompt/xem", { source: 2, mode: "rows", rows: "3-6", includeVideo: false });
    expect(plan.summary).toBe("Sẽ thay prompt của 3 dòng (dòng 3, 4, 6) bằng prompt của dòng 2. Bỏ qua: dòng 5 (đã có video).");
    expect(t.writes).toEqual([]);
    const p = plan.plan as { prompt: string; targets: { row: number; old: string }[] };
    const r = await t.post("/bang/dai-prompt", { prompt: p.prompt, targets: p.targets });
    expect(r).toMatchObject({ ok: true, written: 3, message: "Đã thay prompt của 3 dòng (dòng 3, 4, 6)." });
    expect(t.writes).toEqual(["B3=prompt 2", "B4=prompt 2", "B6=prompt 2"]);
    expect(t.sheets.writeDataCells).toHaveBeenCalledOnce();
    expect(listSheetEdits(t.db).map((e) => [e.cell, e.kind, e.oldValue])).toEqual([
      ["B6", "fill", ""],
      ["B4", "fill", "prompt 4"],
      ["B3", "fill", "prompt 3"],
    ]);
  });

  it("dải xuống tới dòng cuối, kể cả dòng đã có video khi tích; bỏ dòng đang tạo video", async () => {
    const t = setup();
    t.lock(4);
    const plan = await t.post("/bang/dai-prompt/xem", { source: 2, mode: "down", includeVideo: true });
    expect((plan.plan as { targets: { row: number }[] }).targets.map((x) => x.row)).toEqual([3, 5, 6]);
    expect(plan.summary).toContain("Bỏ qua: dòng 4 (đang tạo video).");
  });

  it("dòng bị người khác sửa giữa lúc xem trước và lúc ghi: không ghi dòng đó, báo", async () => {
    const t = setup();
    const plan = (await t.post("/bang/dai-prompt/xem", { source: 2, mode: "rows", rows: "3, 4" })).plan as { prompt: string; targets: unknown[] };
    t.set("B", 4, "người khác vừa gõ");
    const r = await t.post("/bang/dai-prompt", plan);
    expect(r.message).toBe("Đã thay prompt của 1 dòng (dòng 3). Ô này vừa được người khác sửa nên không ghi: dòng 4.");
    expect(t.writes).toEqual(["B3=prompt 2"]);
  });

  it("dòng nguồn không có prompt, ô dòng sai cú pháp, không có dòng nào: báo rõ", async () => {
    const t = setup();
    expect((await t.post("/bang/dai-prompt/xem", { source: 6, mode: "down" })).message).toBe("Dòng 6 chưa có prompt để dải.");
    expect((await t.post("/bang/dai-prompt/xem", { source: 2, mode: "rows", rows: "3 tới 5" })).message).toContain("chưa đúng dạng");
    expect((await t.post("/bang/dai-prompt/xem", { source: 2, mode: "rows", rows: "" })).message).toBe("Chưa chọn dòng nào để áp prompt.");
    expect((await t.post("/bang/dai-prompt/xem", { source: 2, mode: "rows", rows: "9" })).summary).toBe("Không có dòng nào cần thay. Bỏ qua: dòng 9 (dòng trống (dùng Thêm dòng)).");
  });

  it("đọc khoảng dòng", () => {
    expect(parseRowList("3-6, 9;2")).toEqual([2, 3, 4, 5, 6, 9]);
    expect(parseRowList("")).toEqual([]);
    expect(parseRowList("6-3")).toBeNull();
    expect(parseRowList("a")).toBeNull();
  });
});

describe("Thêm dòng (CON-50)", () => {
  it("ghi vào dòng trống đầu tiên sau dòng dữ liệu cuối, chỉ các ô điền; ghi nhật ký", async () => {
    const t = setup();
    const r = await t.post("/bang/them-dong", { image: img("imgimgimg07"), shirt: "", prompt: "prompt 7" });
    expect(r).toEqual({ ok: true, row: 7 });
    expect(t.writes).toEqual([`A7=${img("imgimgimg07")}`, "B7=prompt 7"]);
    expect(t.sheets.ensureRows).toHaveBeenCalledWith(ID, TAB, 7);
    expect(listSheetEdits(t.db).map((e) => [e.cell, e.kind])).toEqual([
      ["B7", "add_row"],
      ["A7", "add_row"],
    ]);
  });

  it("dòng cuối có dữ liệu ở cột khác (ghi chú) vẫn tính; không chèn vào dòng trống giữa bảng", async () => {
    const t = setup();
    t.set("B", 4, "");
    t.set("A", 4, "");
    t.set("G", 9, "ghi chú cuối");
    expect(await t.post("/bang/them-dong", { prompt: "mới" })).toEqual({ ok: true, row: 10 });
  });

  it("không điền gì, link ảnh sai: báo, không ghi", async () => {
    const t = setup();
    expect((await t.post("/bang/them-dong", { image: " ", prompt: "" })).message).toContain("Điền ít nhất một ô");
    expect((await t.post("/bang/them-dong", { image: "https://example.com/x.jpg", prompt: "p" })).message).toContain("không phải link Google Drive");
    expect(t.writes).toEqual([]);
  });

  it("Bảng có nút + Thêm dòng, Dải prompt, ✎; Nhật ký hiện các ô đã sửa", async () => {
    const t = setup();
    const html = await (await t.app.request("/")).text();
    expect(html).toContain('id="addOpen"');
    expect(html).toContain("Dải prompt ▾");
    expect(html).toContain('data-field="prompt" data-value="prompt 3"');
    await t.post("/bang/sua", { row: 3, field: "prompt", expected: "prompt 3", value: "prompt 3 mới" });
    const logs = await (await t.app.request("/logs")).text();
    expect(logs).toContain("Ô đã sửa từ Bảng");
    expect(logs).toContain("<strong>B3</strong>");
    expect(logs).toContain("prompt 3 mới");
  });
});
