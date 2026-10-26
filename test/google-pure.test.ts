import { describe, expect, it } from "vitest";
import { cellRange, columnIndex, columnLetter, parseSpreadsheetId, quoteTab, rowRange } from "../src/google/a1.js";
import { guessColumns, normalizeHeader } from "../src/google/mapping.js";
import { diffSnapshots, unexpectedChanges } from "../src/google/snapshot.js";
import { describeGoogleError } from "../src/google/errors.js";
import { GoogleApiError } from "../src/google/http.js";

const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";

describe("a1", () => {
  it("tách spreadsheetId từ link hoặc ID", () => {
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=0#gid=0`)).toBe(ID);
    expect(parseSpreadsheetId(`  ${ID} `)).toBe(ID);
    expect(parseSpreadsheetId("https://example.com/abc")).toBeNull();
    expect(parseSpreadsheetId("")).toBeNull();
  });

  it("đổi cột chữ ↔ chỉ số", () => {
    for (const [l, i] of [["A", 0], ["D", 3], ["Z", 25], ["AA", 26], ["AZ", 51], ["BA", 52], ["ZZ", 701], ["AAA", 702]] as const) {
      expect(columnIndex(l)).toBe(i);
      expect(columnLetter(i)).toBe(l);
    }
    expect(() => columnIndex("a")).toThrow();
  });

  it("đặt tên tab có dấu, khoảng trắng, nháy đơn đúng cú pháp", () => {
    expect(quoteTab("Trang tính1")).toBe("'Trang tính1'");
    expect(quoteTab("It's")).toBe("'It''s'");
    expect(cellRange("Trang tính1", "D", 5)).toBe("'Trang tính1'!D5");
    expect(rowRange("Trang tính1", 1)).toBe("'Trang tính1'!1:1");
    expect(() => cellRange("x", "D", 0)).toThrow();
  });
});

describe("guessColumns", () => {
  it("đoán đúng tiêu đề thật của sheet mẫu", () => {
    expect(guessColumns(["Ảnh", "Prompt", "Video", "Trạng Thái"])).toEqual({
      colImage: "A",
      colPrompt: "B",
      colVideo: "C",
      colStatus: "D",
    });
  });

  it("không nhầm 'Link video' thành cột Ảnh, chịu được thứ tự và tiếng Anh", () => {
    expect(guessColumns(["STT", "Status", "Link video", "Mô tả", "Hình ảnh"])).toEqual({
      colStatus: "B",
      colVideo: "C",
      colPrompt: "D",
      colImage: "E",
    });
  });

  it("thiếu cột thì để trống vai trò đó", () => {
    expect(guessColumns(["Ảnh", "Ghi chú"])).toEqual({ colImage: "A" });
    expect(normalizeHeader("  Trạng   Thái ")).toBe("trang thai");
  });
});

describe("diffSnapshots", () => {
  it("chỉ ra đúng ô đổi, coi ô trống và ô không tồn tại như nhau", () => {
    const before = [["Ảnh", "Prompt", "Video", "Trạng Thái"], ["a.jpg", "p"], []];
    const after = [["Ảnh", "Prompt", "Video", "Trạng Thái"], ["a.jpg", "p", "https://drive/x", "Xong"], ["", ""], [], ["", "", "", "", "lạ"]];
    const changes = diffSnapshots(before, after);
    expect(changes.map((c) => c.cell)).toEqual(["C2", "D2", "E5"]);
    expect(unexpectedChanges(changes, ["C2", "D2"])).toEqual([{ cell: "E5", before: "", after: "lạ" }]);
    expect(diffSnapshots(before, before)).toEqual([]);
  });
});

describe("describeGoogleError", () => {
  it("thiếu quyền → hướng dẫn chia sẻ sheet (F1)", () => {
    const email = "bot@p.iam.gserviceaccount.com";
    expect(describeGoogleError(new GoogleApiError(403, "The caller does not have permission"), email)).toBe(
      `Chia sẻ sheet cho ${email} với quyền chỉnh sửa`,
    );
    expect(describeGoogleError(new GoogleApiError(404, "Requested entity was not found."), email)).toContain(email);
  });
});
