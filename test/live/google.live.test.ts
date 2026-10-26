// Test với Google Sheet thật. Chỉ chạy bằng:
//   op run --env-file=.env -- npm run test:google
// Ghi tạm một giá trị vào ô Trạng thái dòng MASYS_TEST_ROW (mặc định 2) rồi trả lại giá trị cũ.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkServiceAccount } from "../../src/config.js";
import type { SheetConfig } from "../../src/db/sheetConfigs.js";
import { columnIndex } from "../../src/google/a1.js";
import { serviceAccountTokenProvider } from "../../src/google/auth.js";
import { createGoogleHttp } from "../../src/google/http.js";
import { guessColumns } from "../../src/google/mapping.js";
import { SheetsClient } from "../../src/google/sheets.js";
import { diffSnapshots, takeSnapshot, type TabSnapshot } from "../../src/google/snapshot.js";

const SHEET_ID = process.env.MASYS_TEST_SHEET_ID ?? "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const TAB = process.env.MASYS_TEST_TAB ?? "Trang tính1";
const ROW = Number(process.env.MASYS_TEST_ROW ?? 2);

const sa = checkServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
if (!sa.ok) throw new Error(sa.problem);
const client = new SheetsClient(createGoogleHttp(serviceAccountTokenProvider(sa.credentials)));

describe("Google Sheet thật", () => {
  let cfg: SheetConfig;
  let before: TabSnapshot;
  let original = "";
  let wrote = false;

  beforeAll(async () => {
    const headers = await client.readRow(SHEET_ID, TAB, 1);
    const g = guessColumns(headers);
    cfg = { spreadsheetId: SHEET_ID, tab: TAB, headerRow: 1, colImage: g.colImage!, colPrompt: g.colPrompt!, colVideo: g.colVideo!, colStatus: g.colStatus! };
    before = await takeSnapshot(client, SHEET_ID, TAB);
    original = (await client.readRow(SHEET_ID, TAB, ROW, "FORMULA"))[columnIndex(cfg.colStatus)] ?? "";
  });

  afterAll(async () => {
    // Luôn trả lại giá trị cũ, kể cả khi test giữa chừng thất bại.
    if (wrote) await client.writeStatus(cfg, ROW, original);
  });

  it("đọc danh sách tab và có quyền sửa", async () => {
    const info = await client.getSpreadsheet(SHEET_ID);
    expect(info.tabs.map((t) => t.title)).toContain(TAB);
    expect(await client.canEdit(SHEET_ID)).toBe(true);
  });

  it("đoán đủ 4 cột từ tiêu đề thật", () => {
    expect([cfg.colImage, cfg.colPrompt, cfg.colVideo, cfg.colStatus].every(Boolean)).toBe(true);
  });

  it("đọc toàn tab: dòng 1 là tiêu đề", () => {
    expect(before.cells[0]?.length).toBeGreaterThanOrEqual(4);
  });

  it(`ghi ô Trạng thái dòng ${ROW}: chỉ đúng một ô đổi, rồi trả lại như cũ`, async () => {
    const marker = `TEST CON-36 ${new Date().toISOString()}`;
    wrote = true;
    await client.writeStatus(cfg, ROW, marker);

    const after = await takeSnapshot(client, SHEET_ID, TAB);
    expect(diffSnapshots(before, after)).toEqual([{ cell: `${cfg.colStatus}${ROW}`, before: original, after: marker }]);

    await client.writeStatus(cfg, ROW, original);
    wrote = false;
    const restored = await takeSnapshot(client, SHEET_ID, TAB);
    expect(diffSnapshots(before, restored)).toEqual([]);
  });
});
