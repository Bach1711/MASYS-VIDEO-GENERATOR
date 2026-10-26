import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { getSheetConfig, saveSheetConfig } from "../src/db/sheetConfigs.js";
import { GoogleApiError } from "../src/google/http.js";
import type { SheetsClient } from "../src/google/sheets.js";
import { createApp } from "../src/web/app.js";

const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const EMAIL = "masys-video-tool@masys-video-generator.iam.gserviceaccount.com";

function setup(fake: Partial<SheetsClient>) {
  const config = loadConfig({
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: "PK" }),
  });
  const db = openDatabase(":memory:");
  return { db, app: createApp(config, db, { sheets: fake as SheetsClient }) };
}

describe("trang Kết nối sheet", () => {
  it("dán link → hiện danh sách tab", async () => {
    const { app } = setup({
      getSpreadsheet: async () => ({ spreadsheetId: ID, title: "MASYS Video – Danh sách", tabs: [{ sheetId: 0, title: "Trang tính1", rowCount: 1, columnCount: 4 }] }),
      canEdit: async () => true,
    });
    const res = await app.request(`/sheets/connect?link=${encodeURIComponent(`https://docs.google.com/spreadsheets/d/${ID}/edit`)}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Trang tính1");
    expect(html).toContain(`/sheets/map?id=${ID}`);
  });

  it("không có quyền → báo chia sẻ sheet cho email service account", async () => {
    const { app } = setup({
      getSpreadsheet: async () => {
        throw new GoogleApiError(403, "The caller does not have permission");
      },
    });
    const html = await (await app.request(`/sheets/connect?link=${ID}`)).text();
    expect(html).toContain(`Chia sẻ sheet cho ${EMAIL} với quyền chỉnh sửa`);
  });

  it("chỉ có quyền xem → vẫn báo cần quyền chỉnh sửa", async () => {
    const { app } = setup({
      getSpreadsheet: async () => ({ spreadsheetId: ID, title: "S", tabs: [{ sheetId: 0, title: "Trang tính1", rowCount: 1, columnCount: 4 }] }),
      canEdit: async () => false,
    });
    const html = await (await app.request(`/sheets/connect?link=${ID}`)).text();
    expect(html).toContain(`Chia sẻ sheet cho ${EMAIL} với quyền chỉnh sửa`);
    expect(html).not.toContain(`/sheets/map?id=`);
  });

  it("form ánh xạ tự đoán cột, lưu theo (spreadsheetId, tab)", async () => {
    const { app, db } = setup({ readRow: async () => ["Ảnh", "Prompt", "Video", "Trạng Thái"] });
    const html = await (await app.request(`/sheets/map?id=${ID}&tab=${encodeURIComponent("Trang tính1")}`)).text();
    expect(html).toMatch(/<option value="D" selected="">D — Trạng Thái<\/option>/);

    const form = new URLSearchParams({ id: ID, tab: "Trang tính1", headerRow: "1", colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" });
    const res = await app.request("/sheets/map", { method: "POST", body: form });
    expect(res.status).toBe(303);
    expect(getSheetConfig(db, ID, "Trang tính1")).toEqual({
      spreadsheetId: ID, tab: "Trang tính1", headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D",
    });
  });

  it("từ chối ánh xạ trùng cột", async () => {
    const { app, db } = setup({ readRow: async () => ["Ảnh", "Prompt", "Video", "Trạng Thái"] });
    const form = new URLSearchParams({ id: ID, tab: "T", headerRow: "1", colImage: "A", colPrompt: "A", colVideo: "C", colStatus: "D" });
    const res = await app.request("/sheets/map", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("phải khác nhau");
    expect(getSheetConfig(db, ID, "T")).toBeUndefined();
  });

  it("lưu lại thì cập nhật, không tạo bản trùng", () => {
    const db = openDatabase(":memory:");
    const base = { spreadsheetId: ID, tab: "T", headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" };
    saveSheetConfig(db, base);
    saveSheetConfig(db, { ...base, headerRow: 2 });
    expect(db.prepare("SELECT COUNT(*) n FROM sheet_configs").get()).toEqual({ n: 1 });
    expect(getSheetConfig(db, ID, "T")?.headerRow).toBe(2);
  });
});
