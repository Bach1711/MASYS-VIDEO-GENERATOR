import { describe, expect, it, vi } from "vitest";
import type { CheckResult, MuseBot } from "../src/bot/museBot.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { getSettings, setDriveRootFolder, setMuseReady } from "../src/db/settings.js";
import { getSheetConfig, saveSheetConfig, type SheetConfig } from "../src/db/sheetConfigs.js";
import { DriveClient, FOLDER_MIME, type DriveFile } from "../src/google/drive.js";
import { GoogleApiError } from "../src/google/http.js";
import type { SheetsClient } from "../src/google/sheets.js";
import { ThumbnailCache } from "../src/scan/thumbnails.js";
import { createApp } from "../src/web/app.js";
import { pickTab } from "../src/web/start.js";

// Bắt đầu nhanh và hướng dẫn gọn (CON-51, spec v5.0 mục 16.5).

const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const ROOT = "1eTZ0IlgShDhv4wMfH6OZ1Uwo5ve9GIOB";
const VIDEO = "1ktAlBSjKy-C_uZfgBnTe_yWcmIShHLSI";
const EMAIL = "bot@x.iam.gserviceaccount.com";
const KEY = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: "PK" }) };
const HEADERS: Record<string, string[]> = {
  "Ghi chú": ["Ngày", "Việc"],
  "Danh sách": ["Ảnh người mẫu", "Prompt", "Video", "Trạng Thái", "Ảnh áo"],
  "Thiếu cột": ["Ảnh", "Mô tả sản phẩm", "Link"],
};
const CFG: SheetConfig = { spreadsheetId: ID, tab: "Danh sách", headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" };

function setup(opts: { env?: Record<string, string>; canEdit?: boolean; sheet?: boolean; root?: boolean; museReady?: boolean; muse?: CheckResult["state"] } = {}) {
  const sheets = {
    getSpreadsheet: async () => ({ spreadsheetId: ID, title: "MASYS Video – Danh sách", tabs: Object.keys(HEADERS).map((title, i) => ({ sheetId: i, title, rowCount: 100, columnCount: 5 })) }),
    canEdit: async () => opts.canEdit ?? true,
    readRow: async (_i: string, tab: string) => HEADERS[tab] ?? [],
    readTab: async (_i: string, tab: string) => [HEADERS[tab] ?? []],
  } as unknown as SheetsClient;
  const folders: Record<string, string> = { [ROOT]: "MASYS Video", [VIDEO]: "Video" };
  const getFile = async (id: string): Promise<DriveFile> => {
    if (folders[id]) return { id, name: folders[id]!, mimeType: FOLDER_MIME, trashed: false };
    throw new GoogleApiError(404, "File not found");
  };
  const drive = {
    getFile,
    getFolder: (id: string) => DriveClient.prototype.getFolder.call({ getFile }, id),
    listFolders: async (parent: string) => (parent === ROOT ? [{ id: VIDEO, name: "Video" }] : []),
  } as unknown as DriveClient;
  const bot = {
    isOpen: false,
    open: vi.fn(async function (this: { isOpen: boolean }) {
      this.isOpen = true;
    }),
    check: vi.fn(async (): Promise<CheckResult> => ({ state: opts.muse ?? "ready" })),
  };
  const db = openDatabase(":memory:");
  if (opts.sheet) saveSheetConfig(db, CFG);
  if (opts.root) setDriveRootFolder(db, ROOT);
  if (opts.museReady) setMuseReady(db, "2026-10-28T08:00:00.000Z");
  const app = createApp(loadConfig(opts.env ?? KEY), db, { sheets, drive, thumbs: new ThumbnailCache(drive), bot: bot as unknown as MuseBot });
  const form = (path: string, body: Record<string, string>) => app.request(path, { method: "POST", body: new URLSearchParams(body) });
  return { app, db, bot, form };
}

const q = (r: Response) => new URL(r.headers.get("location")!, "http://x");
const marks = (html: string) => [...html.matchAll(/aria-label="(Xong|Chưa xong)"/g)].map((m) => m[1]);

describe("Các bước bắt đầu (CON-51)", () => {
  it("máy mới (đã có khoá, chưa kết nối gì): trang chủ hiện 4 bước, bước 1 ✅ kèm email của tool", async () => {
    const { app } = setup();
    const html = await (await app.request("/")).text();
    expect(html).toContain("Bắt đầu trong 4 bước (1/4 xong)");
    expect(marks(html)).toEqual(["Xong", "Chưa xong", "Chưa xong", "Chưa xong"]);
    expect(html).toContain(`<code>${EMAIL}</code>`);
    for (const t of ["Dán link Google Sheet", "Đăng nhập Muse", "Thư mục Drive lưu video"]) expect(html).toContain(t);
    expect(html).toContain('action="/ket-noi"');
    expect(html).toContain('action="/bat-dau/thu-muc"');
  });

  it("khoá Google hỏng (op run): bước 1 báo lỗi và chỉ chỗ chọn file khoá; các ô khác khoá lại", async () => {
    const { app } = setup({ env: { GOOGLE_SERVICE_ACCOUNT_JSON: "không phải json" } });
    const html = await (await app.request("/bat-dau")).text();
    expect(marks(html)[0]).toBe("Chưa xong");
    expect(html).toContain('href="/setup"');
    expect(html).toMatch(/name="link"[^>]*disabled=""/);
  });

  it("đủ 4 bước: Bảng không hiện khung bắt đầu; thiếu bước nào thì Bảng chỉ hiện bước đó", async () => {
    const full = setup({ sheet: true, root: true, museReady: true });
    expect(await (await full.app.request("/")).text()).not.toContain('aria-label="Các bước bắt đầu"');
    const html = await (await setup({ sheet: true, root: true }).app.request("/")).text();
    expect(html).toContain('id="bang"');
    expect(html).toContain("Còn 1 bước nữa là dùng được");
    expect(marks(html)).toEqual(["Chưa xong"]);
    expect(html).toContain("Đăng nhập Muse");
    // Trang /bat-dau luôn mở được từ ⚙ Nâng cao, hiện đủ 4 bước.
    expect(marks(await (await full.app.request("/bat-dau")).text())).toEqual(["Xong", "Xong", "Xong", "Xong"]);
  });

  it("đăng nhập Muse: Kiểm tra mở cửa sổ bot nếu chưa mở; sẵn sàng thì nhớ (✅), cần đăng nhập thì quên và nói cách làm", async () => {
    const ok = setup();
    const r = await ok.form("/bat-dau/kiem-tra-muse", { back: "/" });
    expect(ok.bot.open).toHaveBeenCalledOnce();
    expect(q(r).searchParams.get("ok")).toContain("Muse đã đăng nhập");
    expect(getSettings(ok.db).museReadyAt).toBeTruthy();
    expect(marks(await (await ok.app.request("/bat-dau")).text())[2]).toBe("Xong");

    const login = setup({ museReady: true, muse: "login" });
    const r2 = await login.form("/bat-dau/kiem-tra-muse", { back: "/" });
    expect(q(r2).searchParams.get("msg")).toContain("Đăng nhập Meta trong cửa sổ Chrome của bot");
    expect(getSettings(login.db).museReadyAt).toBeNull();
    // Trang quay về chỉ là đường dẫn trong tool.
    expect(q(await login.form("/bat-dau/mo-muse", { back: "https://evil.example" })).pathname).toBe("/");
  });

  it("thư mục Drive: dán link thư mục → lưu làm thư mục gốc; link sai / không mở được thì báo", async () => {
    const { form, db } = setup();
    const r = await form("/bat-dau/thu-muc", { back: "/", link: `https://drive.google.com/drive/folders/${ROOT}?usp=sharing` });
    expect(q(r).searchParams.get("ok")).toBe('Đã lưu thư mục "MASYS Video". Video sẽ vào thư mục con "Video".');
    expect(getSettings(db).driveRootFolderId).toBe(ROOT);
    expect(q(await form("/bat-dau/thu-muc", { back: "/", link: "https://drive.google.com/file/d/abcdefghijk/view" })).searchParams.get("msg")).toContain(
      "không phải link thư mục",
    );
    expect(q(await form("/bat-dau/thu-muc", { back: "/", link: "https://drive.google.com/drive/folders/1KHONGCOxxxxxxxxxx" })).searchParams.get("msg")).toContain(
      "Không mở được thư mục",
    );
  });
});

describe("Kết nối sheet một bước (CON-51)", () => {
  it("dán link → tự chọn tab đoán đủ cột, hiện tóm tắt cột; Xác nhận lưu ánh xạ và về Bảng", async () => {
    const { app, db, form } = setup();
    const html = await (await app.request(`/ket-noi?link=${encodeURIComponent(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)}`)).text();
    expect(html).toContain('<option value="Danh sách" selected="">');
    expect(html).toContain("cột <strong>A</strong>");
    expect(html).toContain("(&quot;Ảnh người mẫu&quot;)");
    expect(html).toContain('name="colShirt" value="E"');
    expect(html).toContain("Xác nhận");
    const r = await form("/sheets/map", { id: ID, tab: "Danh sách", headerRow: "1", colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D", colShirt: "E", back: "bang" });
    expect(q(r).pathname).toBe("/");
    expect(q(r).searchParams.get("ok")).toBe('Đã thêm trang tính "Danh sách".');
    expect(getSheetConfig(db, ID, "Danh sách")).toMatchObject({ colImage: "A", colShirt: "E", spreadsheetTitle: "MASYS Video – Danh sách" });
  });

  it("đoán thiếu cột: chỉ khi đó mới đưa sang chọn cột (giữ đường quay về Bảng)", async () => {
    const { app } = setup();
    const html = await (await app.request(`/ket-noi?link=${ID}&tab=${encodeURIComponent("Thiếu cột")}`)).text();
    expect(html).toContain("Tool chưa tìm ra cột <strong>Video, Trạng thái</strong>");
    expect(html).toContain(`href="/sheets/map?id=${ID}&amp;tab=${encodeURIComponent("Thiếu cột")}&amp;back=bang"`);
    expect(await (await app.request(`/sheets/map?id=${ID}&tab=${encodeURIComponent("Thiếu cột")}&back=bang`)).text()).toContain('name="back" value="bang"');
  });

  it("chưa chia sẻ quyền sửa, link sai: báo rõ kèm email của tool", async () => {
    const view = setup({ canEdit: false });
    expect(await (await view.app.request(`/ket-noi?link=${ID}`)).text()).toContain(`Chia sẻ sheet cho ${EMAIL} với quyền chỉnh sửa`);
    const bad = await setup().app.request(`/ket-noi?link=${encodeURIComponent("https://example.com/sheet")}`);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Không nhận ra link Google Sheet");
  });

  it("chọn tab: theo yêu cầu → tab chưa kết nối đoán đủ → tab đoán đủ → tab đầu", () => {
    const full = { colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" };
    const tabs = [
      { title: "a", guess: {} },
      { title: "b", guess: full },
      { title: "c", guess: full },
    ];
    expect(pickTab(tabs, "a", () => false)!.title).toBe("a");
    expect(pickTab(tabs, undefined, (t) => t === "b")!.title).toBe("c");
    expect(pickTab(tabs, undefined, () => true)!.title).toBe("b");
    expect(pickTab([{ title: "x", guess: {} }], undefined, () => false)!.title).toBe("x");
  });
});

describe("Hướng dẫn và gợi ý tại chỗ (CON-51)", () => {
  it("Hướng dẫn gọn trong tool; ⚙ Nâng cao có Các bước bắt đầu và Hướng dẫn", async () => {
    const { app } = setup({ sheet: true, root: true, museReady: true });
    const html = await (await app.request("/huong-dan")).text();
    expect(html).toContain("Khi tool tạm dừng");
    expect(html).toContain("HUONG-DAN-CHI-TIET.md");
    const bang = await (await app.request("/")).text();
    expect(bang).toContain('href="/bat-dau"');
    expect(bang).toContain('href="/huong-dan"');
    expect(bang).toContain("mỗi dòng khoảng 3–5 phút");
    expect(bang).toContain("Muse lưu video xong vào thư mục này.");
    expect(bang).toContain("· còn 5");
  });
});
