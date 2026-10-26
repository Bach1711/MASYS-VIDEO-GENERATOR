import { Window, type HTMLElement, type HTMLInputElement } from "happy-dom";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { saveSheetConfig } from "../src/db/sheetConfigs.js";
import type { DriveClient, DriveFile } from "../src/google/drive.js";
import { GoogleApiError } from "../src/google/http.js";
import type { SheetConfig } from "../src/db/sheetConfigs.js";
import type { Grid, SheetsClient } from "../src/google/sheets.js";
import { ThumbnailCache } from "../src/scan/thumbnails.js";
import { createApp } from "../src/web/app.js";

const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const TAB = "Trang tính1";
const CFG: SheetConfig = { spreadsheetId: ID, tab: TAB, headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" };
const img = (id: string) => `https://drive.google.com/file/d/${id}/view`;

// Dòng 2–4 sẵn sàng, 5 đã có video, 6 đang chạy, 7 thiếu prompt, 8 ảnh không mở được.
function sheetGrid(): Grid {
  return [
    ["Ảnh", "Prompt", "Video", "Trạng Thái"],
    [img("imgimgimg02"), "p2", "", ""],
    [img("imgimgimg03"), "p3", "", ""],
    [img("imgimgimg04"), "p4", "", ""],
    [img("imgimgimg05"), "p5", "https://drive.google.com/file/d/vvvvvvvvvv/view", "Xong"],
    [img("imgimgimg06"), "p6", "", "Đang chạy"],
    [img("imgimgimg07"), "", "", ""],
    [img("imgimgimg08"), "p8", "", ""],
  ];
}

function setup(opts: { grid?: Grid; sentToday?: number } = {}) {
  const grid = opts.grid ?? sheetGrid();
  const writes: { row: number; text: string }[] = [];
  const sheets = {
    readTab: async () => grid,
    readRow: async (_id: string, _tab: string, row: number) => grid[row - 1] ?? [],
    writeStatus: async (_cfg: SheetConfig, row: number, text: string) => {
      writes.push({ row, text });
      (grid[row - 1] ??= [])[3] = text;
    },
  } as unknown as SheetsClient;
  const thumbFetches: string[] = [];
  const drive = {
    getFile: async (id: string): Promise<DriveFile> => {
      if (id === "imgimgimg08") throw new GoogleApiError(404, "File not found");
      return { id, name: `${id}.jpg`, mimeType: "image/jpeg", trashed: false, thumbnailLink: `https://lh3/${id}` };
    },
    thumbnail: async (f: DriveFile) => (thumbFetches.push(f.id), { contentType: "image/jpeg", data: new Uint8Array([1, 2, 3]) }),
  } as unknown as DriveClient;

  const config = loadConfig({
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "bot@x.iam.gserviceaccount.com", private_key: "PK" }),
  });
  const db = openDatabase(":memory:");
  saveSheetConfig(db, CFG);
  if (opts.sentToday) {
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (1, ?, ?, 'F', 'done')").run(ID, TAB);
    for (let i = 0; i < opts.sentToday; i++) {
      db.prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, sentAt) VALUES (1, 2, '{}', ?)").run(new Date().toISOString());
    }
  }
  const app = createApp(config, db, { sheets, drive, thumbs: new ThumbnailCache(drive) });
  return { app, db, writes, thumbFetches };
}

const scanPath = `/scan?id=${ID}&tab=${encodeURIComponent(TAB)}`;

/** Nạp HTML trang Quét vào trình duyệt giả rồi chạy script của trang. */
async function openScanPage(html: string) {
  const window = new Window({ url: "http://localhost:4310/scan", settings: { enableJavaScriptEvaluation: true } });
  const document = window.document;
  document.write(html);
  await window.happyDOM.waitUntilComplete();
  const $ = (sel: string) => document.querySelector(sel) as unknown as HTMLInputElement;
  const row = (n: number) => document.querySelector(`tr[data-row="${n}"]`)!;
  const sel = (n: number) => row(n).querySelector(".sel") as unknown as HTMLInputElement;
  const click = (el: HTMLElement) => el.dispatchEvent(new window.Event("click", { bubbles: true }));
  const change = (el: HTMLInputElement, checked: boolean) => {
    el.checked = checked;
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  const checked = () =>
    Array.from(document.querySelectorAll("tr[data-row]"))
      .filter((tr) => (tr.querySelector(".sel") as unknown as HTMLInputElement).checked)
      .map((tr) => Number(tr.getAttribute("data-row")));
  return { window, $, row, sel, click, change, checked };
}

describe("trang Quét", () => {
  it("bảng mọi dòng có ảnh thu nhỏ, prompt, trạng thái, nhãn đúng; Quét lại; Hôm nay X/5", async () => {
    const { app } = setup({ sentToday: 1 });
    const res = await app.request(scanPath);
    expect(res.status).toBe(200);
    const html = await res.text();
    const p = await openScanPage(html);
    const label = (n: number) => p.row(n).getAttribute("data-label");
    expect([2, 3, 4, 5, 6, 7, 8].map(label)).toEqual(["ready", "ready", "ready", "has_video", "running", "missing_data", "missing_data"]);
    expect(p.row(2).querySelector("img.thumb")?.getAttribute("src")).toBe("/thumb/imgimgimg02");
    expect(p.row(8).textContent).toContain("Không mở được ảnh");
    expect(p.row(7).textContent).toContain("Thiếu prompt");
    expect(p.row(6).querySelector("form[action='/scan/unlock']")).not.toBeNull();
    expect(p.row(5).querySelector(".ow")).not.toBeNull();
    expect(html).toContain("Hôm nay: <strong>1/5 video</strong>");
    expect(html).toContain(`href="${scanPath.replace("&", "&amp;")}">Quét lại`);
  });

  it("chọn dòng: tích bảng, gõ khoảng, chọn mọi dòng chưa có video, Ghi đè", async () => {
    const { app } = setup();
    const p = await openScanPage(await (await app.request(scanPath)).text());
    const runBtn = p.$("#runBtn");
    expect(runBtn.disabled).toBe(true);
    expect([5, 6, 7, 8].map((n) => p.sel(n).disabled)).toEqual([true, true, true, true]);

    p.change(p.sel(3), true);
    expect(p.checked()).toEqual([3]);
    expect(p.$("#count").textContent).toBe("Đã chọn 1 dòng");
    expect(runBtn.disabled).toBe(false);

    p.$("#range").value = "2-5, 8, 30";
    p.click(p.$("#applyRange"));
    expect(p.checked()).toEqual([2, 3, 4]);
    expect(p.$("#rangeMsg").textContent).toContain("5 (Đã có video, cần tích Ghi đè)");
    expect(p.$("#rangeMsg").textContent).toContain("8 (Thiếu dữ liệu)");
    expect(p.$("#rangeMsg").textContent).toContain("30 (không có dữ liệu)");

    p.change(p.row(5).querySelector(".ow") as unknown as HTMLInputElement, true);
    expect(p.sel(5).disabled).toBe(false);
    p.click(p.$("#applyRange"));
    expect(p.checked()).toEqual([2, 3, 4, 5]);
    p.change(p.row(5).querySelector(".ow") as unknown as HTMLInputElement, false);
    expect(p.sel(5).disabled).toBe(true);
    expect(p.checked()).toEqual([2, 3, 4]);

    p.click(p.$("#clearSel"));
    p.click(p.$("#selectReady"));
    expect(p.checked()).toEqual([2, 3, 4]);
  });

  it("chọn vượt số còn lại trong ngày → khoá nút Chạy kèm lời nhắc", async () => {
    const { app } = setup({ sentToday: 3 });
    const p = await openScanPage(await (await app.request(scanPath)).text());
    p.click(p.$("#selectReady"));
    expect(p.checked()).toHaveLength(3);
    expect(p.$("#runBtn").disabled).toBe(true);
    expect(p.$("#runMsg").textContent).toContain("Hôm nay chỉ còn 2 video");
    p.change(p.sel(4), false);
    expect(p.$("#runBtn").disabled).toBe(false);
    expect(p.$("#runMsg").textContent).toBe("");
  });

  it("đã đủ 5/5 → không chạy được dòng nào", async () => {
    const { app } = setup({ sentToday: 5 });
    const p = await openScanPage(await (await app.request(scanPath)).text());
    p.change(p.sel(2), true);
    expect(p.$("#runBtn").disabled).toBe(true);
    expect(p.$("#runMsg").textContent).toContain("đã đủ 5 video");
  });
});

describe("danh sách chọn trang tính để quét", () => {
  it("gom theo tên file, mỗi trang tính một nút Quét", async () => {
    const { app, db } = setup();
    saveSheetConfig(db, { ...CFG, tab: "Tháng 11", spreadsheetTitle: "MASYS Video – Danh sách" });
    saveSheetConfig(db, { ...CFG, spreadsheetId: "2AAAAAAAAAAAAAAAAAAAAAAAAAAAA", tab: "Trang tính1", spreadsheetTitle: "Sheet khách B" });
    const html = await (await app.request("/scan")).text();
    const w = new Window();
    w.document.write(html);
    const groups = Array.from(w.document.querySelectorAll(".sheet-group")).map((g) => ({
      name: g.querySelector("strong")!.textContent,
      tabs: Array.from(g.querySelectorAll("ul.tabs li strong")).map((s) => s.textContent),
    }));
    expect(groups).toEqual([
      { name: "📄 MASYS Video – Danh sách", tabs: ["Tháng 11", "Trang tính1"] },
      { name: "📄 Sheet khách B", tabs: ["Trang tính1"] },
    ]);
    await w.happyDOM.close();
  });
});

describe("Bỏ khoá", () => {
  const unlock = (app: ReturnType<typeof setup>["app"], row: number) =>
    app.request("/scan/unlock", { method: "POST", body: new URLSearchParams({ id: ID, tab: TAB, row: String(row) }) });

  it("chỉ xoá ô Trạng thái khi ô vẫn là Đang chạy, dùng đúng hàm ghi 1 ô", async () => {
    const { app, writes } = setup();
    const ok = await unlock(app, 6);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toContain("unlocked=6");
    expect(writes).toEqual([{ row: 6, text: "" }]);

    const again = await unlock(app, 6);
    expect(again.headers.get("location")).toContain("unlockFail=6");
    const other = await unlock(app, 2);
    expect(other.headers.get("location")).toContain("unlockFail=2");
    expect(writes).toHaveLength(1);
  });

  it("từ chối dòng tiêu đề", async () => {
    const { app, writes } = setup();
    expect((await unlock(app, 1)).status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});

describe("ảnh thu nhỏ", () => {
  it("chỉ phục vụ ảnh đã qua kiểm tra trong lần quét", async () => {
    const { app, thumbFetches } = setup();
    expect((await app.request("/thumb/imgimgimg02")).status).toBe(404);
    await app.request(scanPath);
    const res = await app.request("/thumb/imgimgimg02");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    await app.request("/thumb/imgimgimg02");
    expect(thumbFetches).toEqual(["imgimgimg02"]);
    expect((await app.request("/thumb/imgimgimg08")).status).toBe(404);
    expect((await app.request("/thumb/khongcotrongsheet")).status).toBe(404);
  });
});
