import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { getDailyQuota, localDayBounds } from "../src/db/quota.js";
import type { SheetConfig } from "../src/db/sheetConfigs.js";
import { parseDriveLink } from "../src/google/drive.js";
import { labelRows, type ImageCheck } from "../src/scan/labels.js";
import { parseRowRanges } from "../src/scan/ranges.js";

const CFG: SheetConfig = {
  spreadsheetId: "S",
  tab: "Trang tính1",
  headerRow: 1,
  colImage: "A",
  colPrompt: "B",
  colVideo: "C",
  colStatus: "D",
};
const HEADER = ["Ảnh", "Prompt", "Video", "Trạng Thái"];
const img = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=drive_link`;
const okChecks = (...ids: string[]) => new Map<string, ImageCheck>(ids.map((id) => [id, { ok: true }]));

describe("parseDriveLink", () => {
  it("nhận các dạng link file Drive", () => {
    for (const s of [
      "https://drive.google.com/file/d/1nJH7l27hlXViCjPyXOtf3wl9HScfbLv1/view?usp=drive_link",
      "https://drive.google.com/open?id=1nJH7l27hlXViCjPyXOtf3wl9HScfbLv1",
      "https://drive.google.com/uc?export=view&id=1nJH7l27hlXViCjPyXOtf3wl9HScfbLv1",
      "https://docs.google.com/uc?id=1nJH7l27hlXViCjPyXOtf3wl9HScfbLv1",
    ]) {
      expect(parseDriveLink(s)).toEqual({ kind: "file", id: "1nJH7l27hlXViCjPyXOtf3wl9HScfbLv1" });
    }
  });

  it("phân biệt thư mục, link ngoài Drive, ô trống", () => {
    expect(parseDriveLink("https://drive.google.com/drive/folders/1ktAlBSjKy-C_uZfgBnTe_yWcmIShHLSI")).toEqual({
      kind: "folder",
      id: "1ktAlBSjKy-C_uZfgBnTe_yWcmIShHLSI",
    });
    expect(parseDriveLink("https://i.imgur.com/abc.jpg")).toEqual({ kind: "not_drive" });
    expect(parseDriveLink("   ")).toBeNull();
  });
});

describe("labelRows (F3)", () => {
  it("§12.1: sheet 20 dòng, 5 dòng có link → đúng 5 dòng Đã có video, không chọn được", () => {
    const grid = [HEADER];
    const ids: string[] = [];
    for (let n = 2; n <= 21; n++) {
      const id = `file_${String(n).padStart(8, "0")}`;
      ids.push(id);
      const video = [3, 7, 11, 15, 19].includes(n) ? `https://drive.google.com/file/d/vid_${n}xxxxxxxx/view` : "";
      grid.push([img(id), `prompt ${n}`, video, ""]);
    }
    const rows = labelRows(grid, CFG, okChecks(...ids));
    expect(rows).toHaveLength(20);
    const hasVideo = rows.filter((r) => r.label === "has_video");
    expect(hasVideo.map((r) => r.row)).toEqual([3, 7, 11, 15, 19]);
    expect(hasVideo.every((r) => !r.selectable && r.canOverwrite)).toBe(true);
    expect(rows.filter((r) => r.label === "ready")).toHaveLength(15);
    expect(rows.filter((r) => r.selectable)).toHaveLength(15);
  });

  it("gắn đủ 4 nhãn kèm lý do Thiếu dữ liệu", () => {
    const grid = [
      HEADER,
      [img("aaaaaaaaaa1"), "p", "", ""], // 2 sẵn sàng
      [img("aaaaaaaaaa2"), "p", "https://drive.google.com/file/d/v/view", "Xong"], // 3 đã có video
      [img("aaaaaaaaaa3"), "p", "", "Đang chạy"], // 4 đang chạy
      ["", "p", "", ""], // 5 thiếu ảnh
      [img("aaaaaaaaaa5"), "", "", ""], // 6 thiếu prompt
      ["https://drive.google.com/drive/folders/1ktAlBSjKy-C_uZfgBnTe", "p", "", ""], // 7 thư mục
      ["https://example.com/a.jpg", "p", "", ""], // 8 không phải Drive
      [img("aaaaaaaaaa8"), "p", "", ""], // 9 không mở được
      [], // 10 trống → bỏ qua
      [img("aaaaaaaaaa9"), "p", "đang làm", ""], // 11 ô Video có chữ → coi là đã có video
      [img("aaaaaaaaab0"), "p", "", "  đang CHẠY "], // 12 Đang chạy, khác hoa thường/khoảng trắng
      ["", "", "", "Lỗi: hết lượt"], // 13 chỉ có trạng thái → thiếu dữ liệu
    ];
    const checks = okChecks("aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3", "aaaaaaaaaa5", "aaaaaaaaaa9", "aaaaaaaaab0");
    checks.set("aaaaaaaaaa8", { ok: false, reason: "Không mở được ảnh" });
    const rows = labelRows(grid, CFG, checks);
    const at = (n: number) => rows.find((r) => r.row === n)!;

    expect(rows.map((r) => r.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13]);
    expect(at(2)).toMatchObject({ label: "ready", selectable: true, imageFileId: "aaaaaaaaaa1" });
    expect(at(3)).toMatchObject({ label: "has_video", selectable: false, canOverwrite: true });
    expect(at(4)).toMatchObject({ label: "running", selectable: false, canOverwrite: false });
    expect(at(5)).toMatchObject({ label: "missing_data", problems: ["Thiếu ảnh"] });
    expect(at(6)).toMatchObject({ label: "missing_data", problems: ["Thiếu prompt"] });
    expect(at(7).problems).toEqual(["Link ảnh là thư mục, cần link tới file ảnh"]);
    expect(at(8).problems).toEqual(["Link ảnh không phải link Google Drive"]);
    expect(at(9)).toMatchObject({ label: "missing_data", problems: ["Không mở được ảnh"] });
    expect(at(11)).toMatchObject({ label: "has_video", canOverwrite: true });
    expect(at(12).label).toBe("running");
    expect(at(13).problems).toEqual(["Thiếu ảnh", "Thiếu prompt"]);
  });

  it("dòng Đã có video nhưng thiếu dữ liệu thì không cho Ghi đè", () => {
    const rows = labelRows([HEADER, ["", "p", "https://x", ""]], CFG, new Map());
    expect(rows[0]).toMatchObject({ label: "has_video", canOverwrite: false, problems: ["Thiếu ảnh"] });
  });

  it("tôn trọng dòng tiêu đề khác 1 và thứ tự cột khác", () => {
    const cfg = { ...CFG, headerRow: 2, colImage: "D", colPrompt: "C", colVideo: "B", colStatus: "A" };
    const grid = [["Tiêu đề phụ"], ["Trạng thái", "Video", "Prompt", "Ảnh"], ["", "", "p", img("bbbbbbbbbb1")]];
    expect(labelRows(grid, cfg, okChecks("bbbbbbbbbb1"))).toMatchObject([{ row: 3, label: "ready" }]);
  });
});

describe("parseRowRanges", () => {
  it("đọc '2-5, 8' và các kiểu gõ khác", () => {
    expect(parseRowRanges("2-5, 8")).toEqual({ rows: [2, 3, 4, 5, 8], errors: [] });
    expect(parseRowRanges(" 8 ;2 - 3,3, 10–11 ")).toEqual({ rows: [2, 3, 8, 10, 11], errors: [] });
    expect(parseRowRanges("")).toEqual({ rows: [], errors: [] });
  });

  it("báo phần gõ sai, không làm hỏng phần đúng", () => {
    expect(parseRowRanges("2-5, abc, 9-7, 0, 4")).toEqual({ rows: [2, 3, 4, 5], errors: ["abc", "9-7", "0"] });
  });

  it("chạy được khi nhúng vào trình duyệt (không phụ thuộc gì bên ngoài)", () => {
    const fn = new Function(`${parseRowRanges.toString()}; return parseRowRanges;`)() as typeof parseRowRanges;
    expect(fn("2-5, 8").rows).toEqual([2, 3, 4, 5, 8]);
  });
});

describe("giới hạn ngày (D13)", () => {
  it("đếm các lượt đã gửi trong ngày theo giờ máy, kể cả lượt lỗi", () => {
    const db = openDatabase(":memory:");

    db.prepare("UPDATE settings SET dailyVideoLimit = 5").run(); // các ca giới hạn ngày viết theo mức 5 cũ (D13)
    const now = new Date(2026, 9, 26, 15, 0, 0);
    const { start } = localDayBounds(now);
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (1, 'S', 'T', 'F', 'done')").run();
    const add = (sentAt: string | null, state = "done") =>
      db.prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, state, sentAt) VALUES (1, 2, '{}', ?, ?)").run(state, sentAt);
    add(new Date(2026, 9, 26, 0, 0, 1).toISOString());
    add(new Date(2026, 9, 26, 14, 0, 0).toISOString(), "failed");
    add(new Date(2026, 9, 25, 23, 59, 59).toISOString()); // hôm qua
    add(new Date(2026, 9, 27, 0, 0, 0).toISOString()); // mai
    add(null, "queued"); // chưa gửi

    expect(start).toBe(new Date(2026, 9, 26).toISOString());
    expect(getDailyQuota(db, now)).toEqual({ used: 2, limit: 5, remaining: 3 });

    db.prepare("UPDATE settings SET dailyVideoLimit = 1").run();
    expect(getDailyQuota(db, now)).toEqual({ used: 2, limit: 1, remaining: 0 });
  });
});
