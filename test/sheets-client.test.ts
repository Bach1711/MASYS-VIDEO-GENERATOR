import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { SheetConfig } from "../src/db/sheetConfigs.js";
import { createGoogleHttp, GoogleApiError, type FetchLike } from "../src/google/http.js";
import { SheetsClient } from "../src/google/sheets.js";
import { createLogger } from "../src/logger.js";

const TOKEN = "fake-access-token-for-tests-0123456789";
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

describe("SheetsClient: ghi ô dữ liệu từ Bảng (D18)", () => {
  const CFG2: SheetConfig = { ...CFG, colShirt: "E" };

  it("ghi Prompt / Ảnh / Ảnh áo bằng một lệnh batchUpdate RAW, đúng từng ô", async () => {
    const { client, calls } = fakeGoogle((c) => {
      const data = (c.body as { data: { range: string }[] }).data;
      return { json: { responses: data.map((d) => ({ updatedRange: d.range, updatedCells: 1 })) } };
    });
    await client.writeDataCells(CFG2, [
      { col: "B", row: 3, value: "=SUM(1)" },
      { col: "E", row: 3, value: "https://drive.google.com/file/d/abcdefghijk/view" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toContain("/values:batchUpdate");
    expect(calls[0]!.body).toMatchObject({ valueInputOption: "RAW", data: [{ range: "'Trang tính1'!B3", values: [["=SUM(1)"]] }, { range: "'Trang tính1'!E3" }] });
  });

  it("không bao giờ ghi ô Video, ô Trạng thái, cột lạ hay dòng tiêu đề; không gọi Google", async () => {
    const { client, calls } = fakeGoogle(() => ({ json: {} }));
    await expect(client.writeDataCells(CFG2, [{ col: "C", row: 3, value: "x" }])).rejects.toThrow("không được ghi cột C");
    await expect(client.writeDataCells(CFG2, [{ col: "D", row: 3, value: "x" }])).rejects.toThrow("không được ghi cột D");
    await expect(client.writeDataCells(CFG, [{ col: "E", row: 3, value: "x" }])).rejects.toThrow("không được ghi cột E");
    await expect(client.writeDataCells(CFG2, [{ col: "B", row: 1, value: "x" }])).rejects.toThrow("dòng tiêu đề");
    await expect(client.writeDataCells(CFG2, [{ col: "B", row: 3, value: "x" }, { col: "B", row: 3, value: "y" }])).rejects.toThrow("hai lần");
    expect(calls).toHaveLength(0);
  });

  it("Google báo ghi sai vùng: báo lỗi", async () => {
    const { client } = fakeGoogle(() => ({ json: { responses: [{ updatedRange: "'Trang tính1'!B3:B4", updatedCells: 2 }] } }));
    await expect(client.writeDataCells(CFG2, [{ col: "B", row: 3, value: "x" }])).rejects.toThrow("vùng không mong đợi");
  });

  it("đọc nhiều ô (FORMULA); thêm dòng trống vào cuối tab khi tab hết dòng", async () => {
    const { client, calls } = fakeGoogle((c) => {
      if (c.url.includes("values:batchGet")) return { json: { valueRanges: [{ values: [["=A1"]] }, {}] } };
      if (c.method === "GET") return { json: { properties: { title: "S" }, sheets: [{ properties: { sheetId: 7, title: "Trang tính1", gridProperties: { rowCount: 10 } } }] } };
      return { json: {} };
    });
    expect(await client.readCells(ID, "Trang tính1", [{ col: "B", row: 2 }, { col: "B", row: 3 }])).toEqual(["=A1", ""]);
    expect(calls[0]!.url).toContain("valueRenderOption=FORMULA");
    await client.ensureRows(ID, "Trang tính1", 10);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await client.ensureRows(ID, "Trang tính1", 11);
    expect(calls.at(-1)!.body).toEqual({ requests: [{ appendDimension: { sheetId: 7, dimension: "ROWS", length: 1 } }] });
  });
});

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
