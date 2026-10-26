import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { SheetConfig } from "../src/db/sheetConfigs.js";
import { createGoogleHttp, GoogleApiError, type FetchLike } from "../src/google/http.js";
import { SheetsClient } from "../src/google/sheets.js";
import { createLogger } from "../src/logger.js";

const TOKEN = "ya29.FAKE-ACCESS-TOKEN-should-never-leak";
const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const CFG: SheetConfig = {
  spreadsheetId: ID,
  tab: "Trang tính1",
  headerRow: 1,
  colImage: "A",
  colPrompt: "B",
  colVideo: "C",
  colStatus: "D",
};

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

function fakeGoogle(handler: (call: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      method: init.method ?? "GET",
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const { status = 200, json } = handler(call);
    return new Response(JSON.stringify(json), { status });
  };
  return { calls, client: new SheetsClient(createGoogleHttp(async () => TOKEN, fetchImpl)) };
}

describe("SheetsClient", () => {
  it("liệt kê tab", async () => {
    const { client, calls } = fakeGoogle(() => ({
      json: {
        properties: { title: "MASYS Video – Danh sách" },
        sheets: [{ properties: { sheetId: 0, title: "Trang tính1", gridProperties: { rowCount: 1000, columnCount: 26 } } }],
      },
    }));
    const info = await client.getSpreadsheet(ID);
    expect(info.tabs).toEqual([{ sheetId: 0, title: "Trang tính1", rowCount: 1000, columnCount: 26 }]);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("đọc toàn tab và dòng N, đổi số/null thành chuỗi", async () => {
    const { client, calls } = fakeGoogle((c) =>
      c.url.includes(encodeURIComponent("'Trang tính1'!5:5"))
        ? { json: { values: [["a.jpg", "p5", null, 3]] } }
        : { json: { values: [["Ảnh", "Prompt"], ["x"]] } },
    );
    expect(await client.readTab(ID, "Trang tính1")).toEqual([["Ảnh", "Prompt"], ["x"]]);
    expect(await client.readRow(ID, "Trang tính1", 5)).toEqual(["a.jpg", "p5", "", "3"]);
    expect(calls[0]!.url).toContain("valueRenderOption=FORMATTED_VALUE");
  });

  it("ghi ô Trạng thái: đúng một ô, RAW, đúng dòng N", async () => {
    const { client, calls } = fakeGoogle(() => ({
      json: { updatedRange: "'Trang tính1'!D5", updatedRows: 1, updatedColumns: 1, updatedCells: 1 },
    }));
    await client.writeStatus(CFG, 5, "=Đang chạy");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("PUT");
    expect(call.url).toContain(`/values/${encodeURIComponent("'Trang tính1'!D5")}?valueInputOption=RAW`);
    expect(call.body).toEqual({ range: "'Trang tính1'!D5", majorDimension: "ROWS", values: [["=Đang chạy"]] });
  });

  it("báo lỗi nếu Google xác nhận ghi sang vùng khác hoặc nhiều hơn một ô", async () => {
    for (const json of [
      { updatedRange: "'Trang tính1'!D6", updatedCells: 1 },
      { updatedRange: "'Trang tính1'!D5:E5", updatedCells: 2, updatedColumns: 2 },
      {},
    ]) {
      const { client } = fakeGoogle(() => ({ json }));
      await expect(client.writeStatus(CFG, 5, "Xong")).rejects.toThrow(/vùng không mong đợi/);
    }
  });

  it("không bao giờ ghi vào dòng tiêu đề", async () => {
    const { client, calls } = fakeGoogle(() => ({ json: {} }));
    await expect(client.writeStatus(CFG, 1, "Xong")).rejects.toThrow(/tiêu đề/);
    expect(calls).toHaveLength(0);
  });

  it("lỗi Google không mang theo access token, kể cả khi log", async () => {
    const { client } = fakeGoogle(() => ({
      status: 403,
      json: { error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } },
    }));
    const err = await client.getSpreadsheet(ID).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.status).toBe(403);

    const lines: string[] = [];
    const log = createLogger(new Writable({ write: (c, _e, cb) => (lines.push(c.toString()), cb()) }));
    log.warn({ err }, "Không đọc được sheet");
    log.error(err);
    const out = lines.join("") + JSON.stringify(err) + String(err.stack);
    expect(out).toContain("does not have permission");
    expect(out).not.toContain(TOKEN);
  });
});
