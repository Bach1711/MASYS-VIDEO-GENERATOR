// Thử ghép ảnh áo (CON-46) với Google Sheet thật, CHỈ ĐỌC (không ghi ô nào, không gửi Muse):
//   op run --env-file=.env -- npx tsx test/live/shirt.live.ts
import { DEFAULT_SHIRT_TEMPLATE, DEFAULT_TEMPLATE } from "../../src/batch/template.js";
import { planRuns } from "../../src/batch/create.js";
import { checkServiceAccount } from "../../src/config.js";
import { serviceAccountTokenProvider } from "../../src/google/auth.js";
import { DriveClient } from "../../src/google/drive.js";
import { createGoogleHttp } from "../../src/google/http.js";
import { guessColumns } from "../../src/google/mapping.js";
import { SheetsClient } from "../../src/google/sheets.js";
import { scanTab } from "../../src/scan/scan.js";

const SHEET_ID = process.env.MASYS_TEST_SHEET_ID ?? "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const TAB = process.env.MASYS_TEST_TAB ?? "Trang tính1";

const sa = checkServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
if (!sa.ok) throw new Error(sa.problem);
const http = createGoogleHttp(serviceAccountTokenProvider(sa.credentials));
const sheets = new SheetsClient(http);
const drive = new DriveClient(http);

const headers = await sheets.readRow(SHEET_ID, TAB, 1);
const g = guessColumns(headers);
console.log("Tiêu đề:", headers.join(" | "));
console.log("Tự đoán:", g);
if (!g.colImage || !g.colPrompt || !g.colVideo || !g.colStatus) throw new Error("Không đoán đủ 4 cột");
const cfg = { spreadsheetId: SHEET_ID, tab: TAB, headerRow: 1, colImage: g.colImage, colPrompt: g.colPrompt, colVideo: g.colVideo, colStatus: g.colStatus, colShirt: g.colShirt ?? null };

const result = await scanTab(sheets, drive, cfg);
for (const r of result.rows) {
  console.log(`Dòng ${r.row}: ${r.label}${r.shirt ? " · có ảnh áo " + (r.shirtFileId ?? "?") : ""}${r.problems.length ? " · " + r.problems.join("; ") : ""}`);
}
const withShirt = result.rows.filter((r) => r.shirt && r.problems.length === 0);
console.log("Ảnh đã kiểm tra được (để làm ảnh thu nhỏ):", result.images.map((f) => `${f.name} (${f.mimeType})`).join(", "));
const sheetId = (await sheets.getSpreadsheet(SHEET_ID)).tabs.find((t) => t.title === TAB)!.sheetId;
const plan = planRuns({
  cfg,
  sheetId,
  folderId: "1ktAlBSjKy-C_uZfgBnTe_yWcmIShHLSI",
  batchExtra: "",
  stamp: "20261028-1200",
  template: DEFAULT_TEMPLATE,
  shirtTemplate: DEFAULT_SHIRT_TEMPLATE,
  rows: [...withShirt.slice(0, 1), ...result.rows.filter((r) => !r.shirt && r.problems.length === 0).slice(0, 1)],
  edits: new Map(),
});
for (const run of plan.runs) console.log(`\n===== Xem trước yêu cầu dòng ${run.row} =====\n${run.requestText.replace(/(Prompt: .{60}).*/, "$1…")}`);
