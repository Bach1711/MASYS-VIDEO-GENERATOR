// Xem luồng bắt đầu nhanh (CON-51) như trên máy sạch: SQLite trống, Google Sheet / Drive thật, KHÔNG có bot
// (không mở Chrome bot, không gửi Muse) và không ghi ô nào lên sheet. Chụp màn hình từng bước vào thư mục truyền vào:
//   op run --env-file=.env -- npx tsx test/live/start.live.ts <thư-mục-ảnh>
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { checkServiceAccount, loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/index.js";
import { serviceAccountTokenProvider } from "../../src/google/auth.js";
import { DriveClient } from "../../src/google/drive.js";
import { createGoogleHttp } from "../../src/google/http.js";
import { SheetsClient } from "../../src/google/sheets.js";
import { ThumbnailCache } from "../../src/scan/thumbnails.js";
import { createApp } from "../../src/web/app.js";

const SHEET_ID = process.env.MASYS_TEST_SHEET_ID ?? "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const ROOT = process.env.MASYS_TEST_ROOT ?? "1eTZ0IlgShDhv4wMfH6OZ1Uwo5ve9GIOB";
const out = process.argv[2] ?? ".";

const sa = checkServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
if (!sa.ok) throw new Error(sa.problem);
const http = createGoogleHttp(serviceAccountTokenProvider(sa.credentials));
const sheets = new SheetsClient(http);
const drive = new DriveClient(http);
const db = openDatabase(":memory:");
const app = createApp(loadConfig(process.env), db, { sheets, drive, thumbs: new ThumbnailCache(drive) });
// Máy chưa có khoá: mọi trang dẫn về Cài khoá Google (D15).
const noKey = createApp(loadConfig({}), openDatabase(":memory:"), {});

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
async function open(target: typeof app, scheme: "light" | "dark"): Promise<Page> {
  const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1100, height: 900 } });
  await page.route("http://masys.test/**", async (route) => {
    // Chuyển hướng đi theo ngay ở đây: Chrome không cho trang giả tự chuyển hướng qua route.
    const req = route.request();
    const u = new URL(req.url());
    let res = await target.request(u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined });
    for (let i = 0; i < 5 && res.status >= 300 && res.status < 400; i++) {
      const next = res.headers.get("location")!;
      lastPath = next;
      res = await target.request(next);
    }
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  return page;
}
let lastPath = "";
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(out, name), fullPage: true });

const k = await open(noKey, "light");
await k.goto("http://masys.test/");
console.log("Chưa có khoá → chuyển tới:", lastPath);
await shot(k, "0-chua-co-khoa.png");

for (const scheme of ["light", "dark"] as const) {
  const p = await open(app, scheme);
  await p.goto("http://masys.test/");
  await shot(p, `1-bat-dau-${scheme}.png`);
  if (scheme === "dark") break;
  await p.fill('input[aria-label="Link Google Sheet"]', `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`);
  await p.click("form[action='/ket-noi'] button");
  await p.waitForLoadState("networkidle");
  console.log("Kết nối nhanh:", (await p.locator("ul.mapping").innerText()).replace(/\n/g, " · "));
  await shot(p, "2-ket-noi.png");
  await p.click("button:has-text('Xác nhận')");
  await p.waitForLoadState("networkidle");
  console.log("Sau Xác nhận:", lastPath, await p.locator(".card.ok").first().innerText().catch(() => ""));
  await p.fill('input[aria-label="Link thư mục Drive"]', `https://drive.google.com/drive/folders/${ROOT}`);
  await p.click("form[action='/bat-dau/thu-muc'] button");
  await p.waitForLoadState("networkidle");
  console.log("Thư mục:", await p.locator(".card.ok").first().innerText().catch(() => ""));
  await shot(p, "3-bang-con-buoc-muse.png");
  await p.goto("http://masys.test/huong-dan");
  await shot(p, "4-huong-dan.png");
}
await browser.close();
console.log("Đã chụp vào", out);
