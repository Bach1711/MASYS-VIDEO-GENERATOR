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
      spreadsheetId: ID, tab: "Trang tính1", headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D", colShirt: null,
      spreadsheetTitle: null,
    });
  });

  it("cột Ảnh áo (CON-46): tự đoán theo tiêu đề, để Không có được, lưu được; danh sách hiện cột", async () => {
    const { app, db } = setup({ readRow: async () => ["Ảnh", "Ảnh áo", "Prompt", "Video", "Trạng Thái"] });
    const html = await (await app.request(`/sheets/map?id=${ID}&tab=${encodeURIComponent("Trang tính1")}`)).text();
    expect(html).toMatch(/<option value="A" selected="">A — Ảnh<\/option>/);
    expect(html).toMatch(/<select id="colShirt" name="colShirt">[\s\S]*?<option value="B" selected="">B — Ảnh áo<\/option>/);
    expect(html).toContain("— Không có —");

    const base = { id: ID, tab: "Trang tính1", headerRow: "1", colImage: "A", colPrompt: "C", colVideo: "D", colStatus: "E" };
    await app.request("/sheets/map", { method: "POST", body: new URLSearchParams({ ...base, colShirt: "B" }) });
    expect(getSheetConfig(db, ID, "Trang tính1")?.colShirt).toBe("B");
    expect(await (await app.request("/sheets")).text()).toContain("<th>Ảnh áo</th>");

    await app.request("/sheets/map", { method: "POST", body: new URLSearchParams({ ...base, colShirt: "" }) });
    expect(getSheetConfig(db, ID, "Trang tính1")?.colShirt).toBeNull();

    const dup = await app.request("/sheets/map", { method: "POST", body: new URLSearchParams({ ...base, colShirt: "A" }) });
    expect(dup.status).toBe(400);
  });

  it("lưu tên file sheet khi lưu ánh xạ; danh sách hiện tên file thay cho mã", async () => {
    const { app, db } = setup({
      readRow: async () => ["Ảnh", "Prompt", "Video", "Trạng Thái"],
      getSpreadsheet: async () => ({ spreadsheetId: ID, title: "MASYS Video – Danh sách", tabs: [] }),
    });
    const form = new URLSearchParams({ id: ID, tab: "Trang tính1", headerRow: "1", colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" });
    await app.request("/sheets/map", { method: "POST", body: form });
    expect(getSheetConfig(db, ID, "Trang tính1")?.spreadsheetTitle).toBe("MASYS Video – Danh sách");
    const html = await (await app.request("/sheets")).text();
    expect(html).toContain("MASYS Video – Danh sách");
    expect(html).not.toContain(`${ID.slice(0, 8)}…`);
  });

  it("ánh xạ lưu từ trước (chưa có tên) được tự điền tên khi mở danh sách", async () => {
    let calls = 0;
    const { app, db } = setup({
      getSpreadsheet: async () => (calls++, { spreadsheetId: ID, title: "Sheet cũ", tabs: [] }),
    });
    saveSheetConfig(db, { spreadsheetId: ID, tab: "A", headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" });
    saveSheetConfig(db, { spreadsheetId: ID, tab: "B", headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" });
    expect(await (await app.request("/sheets")).text()).toContain("Sheet cũ");
    expect(getSheetConfig(db, ID, "B")?.spreadsheetTitle).toBe("Sheet cũ");
    await app.request("/sheets");
    expect(calls).toBe(1);
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
