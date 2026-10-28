import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DEFAULT_SHIRT_TEMPLATE, DEFAULT_TEMPLATE, lacksShirtSlot, renderTemplate, shirtBlock, validateShirtTemplate, validateTemplate } from "../src/batch/template.js";
import { migrate } from "../src/db/index.js";
import { MIGRATIONS } from "../src/db/schema.js";
import { getSheetConfig, saveSheetConfig, validateSheetConfig, type SheetConfig } from "../src/db/sheetConfigs.js";
import { guessColumns } from "../src/google/mapping.js";
import { labelRows, type ImageCheck } from "../src/scan/labels.js";

// Ghép ảnh áo (CON-46, spec v4.4): cột Ảnh áo tuỳ chọn, đoạn ghép áo trong yêu cầu gửi Muse.

const CFG: SheetConfig = { spreadsheetId: "S", tab: "T", headerRow: 1, colImage: "A", colPrompt: "C", colVideo: "D", colStatus: "E", colShirt: "B" };
const img = (id: string) => `https://drive.google.com/file/d/${id}/view`;

describe("tự đoán cột Ảnh áo", () => {
  it("nhận đúng 'Ảnh' và 'Ảnh áo', đứng trước hay sau đều không lẫn", () => {
    expect(guessColumns(["Ảnh", "Ảnh áo", "Prompt", "Video", "Trạng thái"])).toEqual({
      colImage: "A",
      colShirt: "B",
      colPrompt: "C",
      colVideo: "D",
      colStatus: "E",
    });
    expect(guessColumns(["Ảnh áo", "Ảnh người mẫu", "Prompt", "Video", "Trạng thái"])).toMatchObject({ colShirt: "A", colImage: "B" });
    expect(guessColumns(["Hình thiết kế", "Hình ảnh", "Mô tả", "Link video", "Status"])).toMatchObject({ colShirt: "A", colImage: "B" });
  });

  it("sheet không có cột ảnh áo thì không đoán", () => {
    expect(guessColumns(["Ảnh", "Prompt", "Video", "Trạng Thái"]).colShirt).toBeUndefined();
  });

  it("cột Ảnh áo không được trùng bốn cột kia; để trống là hợp lệ", () => {
    expect(validateSheetConfig(CFG)).toBeNull();
    expect(validateSheetConfig({ ...CFG, colShirt: null })).toBeNull();
    expect(validateSheetConfig({ ...CFG, colShirt: "A" })).toContain("phải khác");
  });
});

describe("migration chỉ thêm cột (bản cũ vẫn mở được dữ liệu)", () => {
  it("dữ liệu tạo ở bản trước giữ nguyên; ánh xạ cũ chưa có cột Ảnh áo", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATIONS.slice(0, 4).join("\n"));
    db.pragma("user_version = 4");
    db.prepare("INSERT INTO sheet_configs (spreadsheetId, tab, colImage, colPrompt, colVideo, colStatus) VALUES ('S', 'T', 'A', 'B', 'C', 'D')").run();
    migrate(db);
    expect(getSheetConfig(db, "S", "T")).toMatchObject({ colImage: "A", colShirt: null });
    expect(db.prepare("SELECT shirtTemplate FROM settings").get()).toEqual({ shirtTemplate: null });
    // Bản cũ ghi ánh xạ không biết cột colShirt: vẫn ghi được.
    db.prepare("INSERT INTO sheet_configs (spreadsheetId, tab, colImage, colPrompt, colVideo, colStatus) VALUES ('S', 'T2', 'A', 'B', 'C', 'D')").run();
    saveSheetConfig(db, { ...CFG, tab: "T3" });
    expect(getSheetConfig(db, "S", "T3")?.colShirt).toBe("B");
  });
});

describe("quét dòng có ảnh áo", () => {
  const grid = [
    ["Ảnh", "Ảnh áo", "Prompt", "Video", "Trạng thái"],
    [img("model000002"), img("shirt000002"), "p", "", ""], // 2 có ảnh áo
    [img("model000003"), "", "p", "", ""], // 3 không ảnh áo
    [img("model000004"), "https://example.com/ao.png", "p", "", ""], // 4 không phải Drive
    [img("model000005"), "https://drive.google.com/drive/folders/1ktAlBSjKy-C_uZfgBnTe", "p", "", ""], // 5 thư mục
    [img("model000006"), img("shirt000006"), "p", "", ""], // 6 ảnh áo không mở được
    [img("model000007"), img("shirt000007"), "p", "https://drive.google.com/file/d/v/view", "Xong"], // 7 đã có video, ảnh áo hỏng
    ["", img("shirt000008"), "", "", ""], // 8 chỉ có ảnh áo → vẫn hiện, thiếu dữ liệu
  ];
  const checks = new Map<string, ImageCheck>(
    ["model000002", "shirt000002", "model000003", "model000004", "model000005", "model000006", "model000007"].map((id) => [id, { ok: true }]),
  );
  checks.set("shirt000006", { ok: false, reason: "Không mở được ảnh: chưa chia sẻ cho service account hoặc đã bị xoá" });
  checks.set("shirt000007", { ok: false, reason: "Ảnh đã nằm trong thùng rác Drive" });

  it("ô Ảnh áo trống không lỗi; có ghi thì phải là ảnh Drive mở được", () => {
    const rows = labelRows(grid, CFG, checks);
    const by = (n: number) => rows.find((r) => r.row === n)!;
    expect(by(2)).toMatchObject({ label: "ready", shirt: img("shirt000002"), shirtFileId: "shirt000002", imageFileId: "model000002" });
    expect(by(3)).toMatchObject({ label: "ready", shirt: "" });
    expect(by(3).shirtFileId).toBeUndefined();
    expect(by(4)).toMatchObject({ label: "missing_data", problems: ["Link ảnh áo không phải link Google Drive"] });
    expect(by(5).problems).toEqual(["Link ảnh áo là thư mục, cần link tới file ảnh"]);
    expect(by(6).problems).toEqual(["Ảnh áo: Không mở được ảnh: chưa chia sẻ cho service account hoặc đã bị xoá"]);
    expect(by(7)).toMatchObject({ label: "has_video", canOverwrite: false });
    expect(by(8).label).toBe("missing_data");
  });

  it("ánh xạ không có cột Ảnh áo: cột đó bị bỏ qua như trước", () => {
    const rows = labelRows(grid, { ...CFG, colShirt: null }, checks);
    expect(rows.find((r) => r.row === 4)).toMatchObject({ label: "ready", shirt: "" });
    expect(rows.some((r) => r.row === 8)).toBe(false);
  });
});

describe("đoạn ghép áo trong yêu cầu gửi Muse", () => {
  const base = {
    link_anh: img("model000002"),
    prompt: "P",
    yeu_cau_them: "(không có)",
    link_thu_muc: "F",
    ten_file: "f.mp4",
    o_video: "D2",
    ten_tab: "T",
    link_sheet: "L",
  };

  it("mẫu gốc hợp lệ, có chỗ đặt đoạn ghép áo; đoạn gốc dùng đúng câu đã thử tay", () => {
    expect(validateTemplate(DEFAULT_TEMPLATE)).toEqual([]);
    expect(lacksShirtSlot(DEFAULT_TEMPLATE)).toBe(false);
    expect(validateShirtTemplate(DEFAULT_SHIRT_TEMPLATE)).toEqual([]);
    expect(DEFAULT_SHIRT_TEMPLATE).toContain("ghép áo trong ảnh áo vào người mẫu");
    expect(DEFAULT_SHIRT_TEMPLATE).toContain("Không cần lưu ảnh vừa ghép");
  });

  it("có ảnh áo: chèn đoạn đã điền link; không có: bỏ hẳn dòng đó", () => {
    const withShirt = renderTemplate(DEFAULT_TEMPLATE, { ...base, doan_ghep_ao: shirtBlock(DEFAULT_SHIRT_TEMPLATE, img("shirt000002")) });
    expect(withShirt).toContain(`Ảnh: ${img("model000002")}\nẢnh áo: ${img("shirt000002")}\nHãy ghép áo`);
    expect(withShirt).toContain("Không cần lưu ảnh vừa ghép.\nPrompt: P");

    const without = renderTemplate(DEFAULT_TEMPLATE, { ...base, doan_ghep_ao: shirtBlock(DEFAULT_SHIRT_TEMPLATE, "") });
    expect(without).toContain(`Ảnh: ${img("model000002")}\nPrompt: P`);
    expect(without).not.toContain("Ảnh áo");
    expect(without).not.toContain("{doan_ghep_ao}");
  });

  it("đoạn ghép áo chỉ nhận {link_anh_ao}, bắt buộc có", () => {
    expect(validateShirtTemplate("Áo: {link_anh}")).toEqual(["Không có chỗ trống tên: {link_anh}", "Mẫu phải có: {link_anh_ao}"]);
    expect(validateShirtTemplate("  ")).toEqual(["Mẫu đang trống."]);
  });

  it("mẫu chính sửa tay từ trước (không có {doan_ghep_ao}) vẫn hợp lệ nhưng bị đánh dấu thiếu chỗ ghép áo", () => {
    const old = DEFAULT_TEMPLATE.replace("{doan_ghep_ao}\n", "");
    expect(validateTemplate(old)).toEqual([]);
    expect(lacksShirtSlot(old)).toBe(true);
  });
});
