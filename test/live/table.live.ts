// Xem màn hình Bảng (CON-49) với Google Sheet thật, CHỈ ĐỌC (không bấm Tạo video, không ghi ô nào, không gửi Muse).
// Chụp ảnh màn hình sáng/tối vào thư mục truyền vào:
//   op run --env-file=.env -- npx tsx test/live/table.live.ts <thư-mục-ảnh>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { checkServiceAccount, loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/index.js";
import { setDriveRootFolder } from "../../src/db/settings.js";
import { saveSheetConfig } from "../../src/db/sheetConfigs.js";
import { serviceAccountTokenProvider } from "../../src/google/auth.js";
import { DriveClient } from "../../src/google/drive.js";
import { createGoogleHttp } from "../../src/google/http.js";
import { guessColumns } from "../../src/google/mapping.js";
import { SheetsClient } from "../../src/google/sheets.js";
import { ThumbnailCache } from "../../src/scan/thumbnails.js";
import { createApp } from "../../src/web/app.js";

const SHEET_ID = process.env.MASYS_TEST_SHEET_ID ?? "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const TAB = process.env.MASYS_TEST_TAB ?? "Trang tính1";
const ROOT = process.env.MASYS_TEST_ROOT ?? "1eTZ0IlgShDhv4wMfH6OZ1Uwo5ve9GIOB";
const out = process.argv[2] ?? ".";

const sa = checkServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
if (!sa.ok) throw new Error(sa.problem);
const http = createGoogleHttp(serviceAccountTokenProvider(sa.credentials));
const sheets = new SheetsClient(http);
const drive = new DriveClient(http);

const g = guessColumns(await sheets.readRow(SHEET_ID, TAB, 1));
const db = openDatabase(":memory:");
saveSheetConfig(db, { spreadsheetId: SHEET_ID, tab: TAB, headerRow: 1, colImage: g.colImage!, colPrompt: g.colPrompt!, colVideo: g.colVideo!, colStatus: g.colStatus!, colShirt: g.colShirt ?? null });
setDriveRootFolder(db, ROOT);
// Không có runner/bot: nút Tạo video khoá, không thể gửi Muse.
const app = createApp(loadConfig(process.env), db, { sheets, drive, thumbs: new ThumbnailCache(drive) });

const preview = await (await app.request(`/bang/preview?id=${SHEET_ID}&tab=${encodeURIComponent(TAB)}&row=2`)).text();
console.log("Yêu cầu dòng 2:\n" + preview);

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
for (const scheme of ["light", "dark"] as const) {
  const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1200, height: 900 } });
  await page.route("http://masys.test/**", async (route) => {
    const u = new URL(route.request().url());
    const res = await app.request(u.pathname + u.search);
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  await page.goto("http://masys.test/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(out, `bang-${scheme}.png`), fullPage: true });
  if (scheme === "light") {
    await page.click("summary:has-text('Nâng cao')");
    await page.screenshot({ path: path.join(out, "bang-menu.png") });
  }
  // CON-50: mở khung sửa prompt dòng 2, Thêm dòng và Dải prompt (chỉ mở, không bấm Lưu nên không ghi gì).
  await page.click('tr[data-row="2"] td[data-field="prompt"] button.edit');
  await page.click('tr[data-row="2"] td[data-field="image"] button.edit');
  await page.click("#addOpen");
  await page.click("#fillOpen");
  await page.screenshot({ path: path.join(out, `bang-sua-${scheme}.png`), fullPage: true });
}
await browser.close();
console.log("Đã chụp vào", out);
