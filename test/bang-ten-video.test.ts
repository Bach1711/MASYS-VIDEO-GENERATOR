import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { applyExport, planExport } from "../src/anh/export.js";
import { BangFiles } from "../src/bang/files.js";
import { addRow, clearRowVideo, getRow, listRows, nameOldVideos, setRowVideo, videoBaseName } from "../src/bang/rows.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { MIGRATIONS } from "../src/db/schema.js";
import { createApp } from "../src/web/app.js";
import { attachmentHeader } from "../src/web/bangMoi.js";

// CON-113: cột Người mẫu tự điền từ Bảng ảnh, video tự đặt tên "Tên người mẫu + STT".

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const MP4 = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, 1, 2, 3, 4]);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "masys-tenvideo-"));
  dirs.push(d);
  return d;
};
const name = (db: ReturnType<typeof openDatabase>, id: number) => getRow(db, id)!.videoName;

describe("đặt tên video theo người mẫu", () => {
  it("mỗi người mẫu một dãy số 01, 02…; dòng lẻ là Video 01…; khác hoa thường / khoảng trắng vẫn chung dãy", () => {
    const db = openDatabase(":memory:");
    const illya = [1, 2, 3].map(() => addRow(db, { nguoiMau: "Illya Osipov", nhanVatId: 1 }));
    const anna = addRow(db, { nguoiMau: "Anna" });
    const le = [addRow(db), addRow(db)];
    const khac = addRow(db, { nguoiMau: "  illya   OSIPOV " });
    for (const id of [...illya, anna, ...le]) setRowVideo(db, id, `${id}-video-a.mp4`, 10);
    expect(illya.map((id) => name(db, id))).toEqual(["Illya Osipov 01", "Illya Osipov 02", "Illya Osipov 03"]);
    expect(name(db, anna)).toBe("Anna 01");
    expect(le.map((id) => name(db, id))).toEqual(["Video 01", "Video 02"]);
    setRowVideo(db, khac, `${khac}-video-a.mp4`, 10);
    expect(name(db, khac)).toBe("illya OSIPOV 04");
  });

  it("số đã dùng không dùng lại: xoá video 02 thì video mới là 04; tạo lại video của một dòng thì lấy số mới", () => {
    const db = openDatabase(":memory:");
    const ids = [1, 2, 3, 4].map(() => addRow(db, { nguoiMau: "Mai" }));
    for (const id of ids.slice(0, 3)) setRowVideo(db, id, `${id}-video-a.mp4`, 10);
    clearRowVideo(db, ids[1]!);
    expect(name(db, ids[1]!)).toBeNull();
    setRowVideo(db, ids[3]!, "4-video-a.mp4", 10);
    expect(name(db, ids[3]!)).toBe("Mai 04");
    setRowVideo(db, ids[0]!, "1-video-b.mp4", 10);
    expect(name(db, ids[0]!)).toBe("Mai 05");
  });

  it("bỏ ký tự Windows không cho dùng trong tên file; tên trống thành Video", () => {
    expect(videoBaseName('A/B:C*?"<>|D')).toBe("A B C D");
    expect(videoBaseName("Ngọc Ánh.")).toBe("Ngọc Ánh");
    expect(videoBaseName("   ")).toBe("Video");
    expect(videoBaseName(null)).toBe("Video");
  });

  it("tên tiếng Việt khi tải: filename không dấu + filename* UTF-8", () => {
    expect(attachmentHeader("Ngọc Ánh 01.mp4")).toBe(`attachment; filename="Ngoc Anh 01.mp4"; filename*=UTF-8''Ng%E1%BB%8Dc%20%C3%81nh%2001.mp4`);
    expect(attachmentHeader("Đào 01.mp4")).toBe(`attachment; filename="Dao 01.mp4"; filename*=UTF-8''%C4%90%C3%A0o%2001.mp4`);
  });
});

describe("cột Người mẫu tự điền từ Bảng ảnh", () => {
  function setupExport() {
    const dataDir = tmp();
    const files = new BangFiles(dataDir);
    const db = openDatabase(":memory:");
    const sheet = files.saveNhanVat(1, PNG);
    const face = files.saveNhanVat(1, PNG);
    db.prepare("INSERT INTO nhan_vat (id, ten, file, faceFile) VALUES (1, 'Ngọc Ánh', ?, ?)").run(sheet, face);
    db.prepare("INSERT INTO nhan_vat (id, ten, file) VALUES (2, 'Lan', ?)").run(files.saveNhanVat(2, PNG));
    const anhRow = (nv: number) => {
      const id = Number(db.prepare("INSERT INTO anh_rows (nhanVatId, prompt) VALUES (?, 'p')").run(nv).lastInsertRowid);
      db.prepare("INSERT INTO anh_files (anhRowId, side, file, chosen) VALUES (?, 'truoc', ?, 1)").run(id, files.saveAnhTao(id, "truoc", PNG));
      return id;
    };
    return { db, files, dataDir, face, sheet, anhRow };
  }

  it("xuất sang Bảng video: dòng mới có tên + ảnh mặt nhân vật; video về mang tên người mẫu; dòng lẻ để trống", async () => {
    const { db, files, dataDir, face, anhRow } = setupExport();
    const a1 = anhRow(1);
    const a2 = anhRow(2);
    const r = applyExport(db, files, planExport(db, [a1, a2]), false);
    const [b1, b2] = r.done.map((d) => d.bangRowId);
    expect(getRow(db, b1!)).toMatchObject({ nhanVatId: 1, nguoiMau: "Ngọc Ánh", nguoiMauAnh: face });
    // Nhân vật chưa có ảnh mặt: dùng ảnh 4 góc.
    expect(getRow(db, b2!)).toMatchObject({ nhanVatId: 2, nguoiMau: "Lan" });
    expect(getRow(db, b2!)!.nguoiMauAnh).toMatch(/^nv2-/);
    const le = addRow(db);
    expect(getRow(db, le)!.nguoiMau).toBeNull();

    setRowVideo(db, b1!, files.saveVideo(b1!, MP4), MP4.length);
    const app = createApp(loadConfig({ MASYS_DATA_DIR: dataDir }), db);
    const html = await (await app.request("/bang-moi")).text();
    const window = new Window();
    window.document.write(html);
    const tr = (id: number) => window.document.querySelector(`tr[data-row="${id}"]`)!;
    expect(tr(b1!).querySelector("td.nguoimau")!.textContent).toContain("Ngọc Ánh");
    expect(tr(b1!).querySelector("td.nguoimau img")!.getAttribute("src")).toBe(`/nhan-vat/anh/${face}`);
    expect(tr(b1!).querySelector(".vid-name")!.textContent).toBe("Ngọc Ánh 01");
    expect(tr(b1!).getAttribute("data-dl-name")).toBe("Ngọc Ánh 01.mp4");
    expect(tr(le).querySelector("td.nguoimau")!.textContent).toBe("—");

    // Nhân vật bị xoá: vẫn giữ tên, không còn ảnh.
    db.prepare("UPDATE nhan_vat SET deletedAt = 'x' WHERE id = 1").run();
    expect(getRow(db, b1!)).toMatchObject({ nguoiMau: "Ngọc Ánh", nguoiMauAnh: null });
    // Tìm theo tên người mẫu.
    expect(listRows(db, { filter: "all", q: "Ánh", page: 1 }).rows.map((x) => x.id)).toEqual([b1]);
  });

  it("bản cũ lên bản này: dòng đã xuất được điền người mẫu, video có sẵn được đặt tên theo thứ tự video về", () => {
    const db = new Database(":memory:");
    // Migration của CON-113 (tạo bảng video_names); các migration sau nó chạy tiếp ở cuối.
    const m17 = MIGRATIONS.findIndex((m) => m.includes("CREATE TABLE video_names"));
    for (const m of MIGRATIONS.slice(0, m17)) db.exec(m);
    db.prepare("INSERT INTO nhan_vat (id, ten, file) VALUES (1, 'Mai', 'nv1.png')").run();
    db.prepare("INSERT INTO bang_rows (id, videoFile, videoAt) VALUES (1, '1-video-a.mp4', '2026-11-08T10:00:00Z'), (2, '2-video-a.mp4', '2026-11-07T10:00:00Z'), (3, '3-video-a.mp4', '2026-11-06T10:00:00Z'), (4, NULL, NULL)").run();
    db.prepare("INSERT INTO anh_rows (nhanVatId, exportedBangRowId) VALUES (1, 1), (1, 2), (1, 4)").run();
    for (const m of MIGRATIONS.slice(m17)) db.exec(m);
    const rows = () => db.prepare("SELECT id, nhanVatId, nguoiMau, videoName FROM bang_rows ORDER BY id").all();
    expect(rows()).toEqual([
      { id: 1, nhanVatId: 1, nguoiMau: "Mai", videoName: null },
      { id: 2, nhanVatId: 1, nguoiMau: "Mai", videoName: null },
      { id: 3, nhanVatId: null, nguoiMau: null, videoName: null },
      { id: 4, nhanVatId: 1, nguoiMau: "Mai", videoName: null },
    ]);
    expect(nameOldVideos(db as unknown as ReturnType<typeof openDatabase>)).toBe(3);
    expect(rows().map((r) => (r as { videoName: string | null }).videoName)).toEqual(["Mai 02", "Mai 01", "Video 01", null]);
    expect(nameOldVideos(db as unknown as ReturnType<typeof openDatabase>)).toBe(0);
  });
});
