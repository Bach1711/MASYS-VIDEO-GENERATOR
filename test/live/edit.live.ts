// Thử sửa ngay trên Bảng (CON-50) với Google Sheet thật, CHỈ trên một TAB THỬ (không phải tab dữ liệu của đội).
// Tab thử phải có sẵn dòng tiêu đề giống tab thật (Ảnh | Prompt | Video | Trạng Thái | Ảnh áo).
// Không gửi Muse. Ghi xong in ra các ô đã ghi để đối chiếu trên sheet.
//   op run --env-file=.env -- npx tsx test/live/edit.live.ts "<tên tab thử>" [thư-mục-ảnh]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { checkServiceAccount, loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/index.js";
import { setDriveRootFolder } from "../../src/db/settings.js";
import { saveSheetConfig } from "../../src/db/sheetConfigs.js";
import { listSheetEdits } from "../../src/db/sheetEdits.js";
import { serviceAccountTokenProvider } from "../../src/google/auth.js";
import { DriveClient } from "../../src/google/drive.js";
import { createGoogleHttp } from "../../src/google/http.js";
import { guessColumns } from "../../src/google/mapping.js";
import { SheetsClient } from "../../src/google/sheets.js";
import { ThumbnailCache } from "../../src/scan/thumbnails.js";
import { createApp } from "../../src/web/app.js";

const SHEET_ID = process.env.MASYS_TEST_SHEET_ID ?? "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const ROOT = process.env.MASYS_TEST_ROOT ?? "1eTZ0IlgShDhv4wMfH6OZ1Uwo5ve9GIOB";
const TAB = process.argv[2];
const out = process.argv[3];
if (!TAB || TAB === "Trang tính1") throw new Error("Truyền tên một tab THỬ (không phải Trang tính1).");

const sa = checkServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
if (!sa.ok) throw new Error(sa.problem);
const http = createGoogleHttp(serviceAccountTokenProvider(sa.credentials));
const sheets = new SheetsClient(http);
const drive = new DriveClient(http);

const info = await sheets.getSpreadsheet(SHEET_ID);
if (!info.tabs.some((t) => t.title === TAB)) throw new Error(`Sheet chưa có tab "${TAB}". Có: ${info.tabs.map((t) => t.title).join(", ")}`);
const g = guessColumns(await sheets.readRow(SHEET_ID, TAB, 1));
if (!g.colImage || !g.colPrompt || !g.colVideo || !g.colStatus) throw new Error("Tab thử chưa có đủ tiêu đề Ảnh | Prompt | Video | Trạng Thái");
const db = openDatabase(":memory:");
saveSheetConfig(db, { spreadsheetId: SHEET_ID, tab: TAB, headerRow: 1, colImage: g.colImage, colPrompt: g.colPrompt, colVideo: g.colVideo, colStatus: g.colStatus, colShirt: g.colShirt ?? null });
setDriveRootFolder(db, ROOT);
const app = createApp(loadConfig(process.env), db, { sheets, drive, thumbs: new ThumbnailCache(drive) });
const post = async (p: string, body: Record<string, unknown>) =>
  (await (await app.request(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: SHEET_ID, tab: TAB, ...body }) })).json()) as Record<string, unknown>;

// Lấy một ảnh người mẫu thật từ tab dữ liệu (chỉ đọc) để thêm dòng.
const realGrid = await sheets.readTab(SHEET_ID, "Trang tính1");
const realCfg = guessColumns(realGrid[0] ?? []);
const image = realGrid[1]?.[realCfg.colImage!.charCodeAt(0) - 65] ?? "";
console.log("Ảnh mẫu dùng thử:", image);

const before = await sheets.readTab(SHEET_ID, TAB);
console.log("Tab thử trước khi thử:", before.length, "dòng");

const a1 = await post("/bang/them-dong", { image, prompt: "CON-50 thử: dòng 1" });
const a2 = await post("/bang/them-dong", { image, prompt: "CON-50 thử: dòng 2" });
console.log("Thêm dòng:", a1, a2);
const r1 = Number(a1.row);
const r2 = Number(a2.row);
console.log("Link sai:", await post("/bang/them-dong", { image: "https://example.com/a.jpg", prompt: "x" }));

console.log("Sửa prompt:", await post("/bang/sua", { row: r1, field: "prompt", expected: "CON-50 thử: dòng 1", value: "CON-50 thử: dòng 1 đã sửa" }));
console.log("Xung đột (giá trị cũ sai):", await post("/bang/sua", { row: r1, field: "prompt", expected: "CON-50 thử: dòng 1", value: "không được ghi" }));

const plan = await post("/bang/dai-prompt/xem", { source: r1, mode: "rows", rows: String(r2) });
console.log("Dải prompt, xem trước:", plan.summary);
console.log("Dải prompt, ghi:", await post("/bang/dai-prompt", plan.plan as Record<string, unknown>));

const after = await sheets.readTab(SHEET_ID, TAB);
for (const r of [r1, r2]) console.log(`Dòng ${r} trên sheet:`, after[r - 1]);
console.log("Nhật ký:", listSheetEdits(db).map((e) => `${e.cell} ${e.kind}: "${e.oldValue}" → "${e.newValue}"`));
// Các ô ngoài hai dòng vừa thêm không đổi.
const untouched = before.every((row, i) => JSON.stringify(row) === JSON.stringify(after[i]));
console.log("Các dòng có sẵn trên tab thử không đổi:", untouched);

if (out) {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  for (const scheme of ["light", "dark"] as const) {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1200, height: 900 } });
    await page.route("http://masys.test/**", async (route) => {
      const u = new URL(route.request().url());
      const req = route.request();
      const res = await app.request(u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined });
      await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
    await page.goto("http://masys.test/");
    await page.waitForLoadState("networkidle");
    await page.click(`tr[data-row="${r1}"] td[data-field="prompt"] button.edit`);
    await page.click("#addOpen");
    await page.click("#fillOpen");
    await page.screenshot({ path: path.join(out, `sua-${scheme}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
  console.log("Đã chụp vào", out);
}
