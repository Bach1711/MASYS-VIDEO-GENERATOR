import fs from "node:fs";
import type { BangFiles } from "../bang/files.js";
import { addRow as addBangRow, setSlot } from "../bang/rows.js";
import type { DB } from "../db/index.js";
import { filesOf, getRow, labelOf, lockedAnhRows, mainFile, type AnhFile, type AnhRow } from "./rows.js";

// Xuất sang Bảng video (D34, spec 6.3 mục 17.13): mỗi dòng Bảng ảnh thành một dòng Bảng video mới; ảnh chính mặt trước
// → Mẫu trước, ảnh chính quay lưng (nếu có) → Mẫu sau. File được CHÉP vào tep\anh: hai bảng xoá độc lập (D26).

export interface ExportItem {
  row: AnhRow;
  front: AnhFile;
  back: AnhFile | undefined;
  /** Dòng này đã xuất trước đó (và dòng Bảng video đó còn): xuất lại phải được người dùng xác nhận. */
  again: boolean;
}

export interface ExportPlan {
  items: ExportItem[];
  rejected: { id: number; why: string }[];
}

export function planExport(db: DB, ids: number[]): ExportPlan {
  const plan: ExportPlan = { items: [], rejected: [] };
  const locked = lockedAnhRows(db);
  const files = filesOf(db, ids);
  for (const id of [...new Set(ids)]) {
    const row = getRow(db, id);
    if (!row) {
      plan.rejected.push({ id, why: "không còn dòng này" });
      continue;
    }
    if (locked.has(id) || labelOf(row).label === "running") {
      plan.rejected.push({ id, why: "đang tạo ảnh" });
      continue;
    }
    const list = files.get(id) ?? [];
    const front = mainFile(list, "truoc");
    if (!front) {
      plan.rejected.push({ id, why: "chưa có ảnh mặt trước" });
      continue;
    }
    plan.items.push({ row, front, back: mainFile(list, "sau"), again: !!row.exportedBangRowId && row.exportedAlive > 0 });
  }
  return plan;
}

/**
 * Xuất các dòng của kế hoạch; trả về cặp (dòng ảnh, dòng Bảng video mới). Dòng `again` chỉ xuất khi `allowAgain`.
 * Mỗi dòng một giao dịch: chép file trước, lỗi thì xoá file vừa chép và dòng đó không đổi gì.
 */
export function applyExport(
  db: DB,
  files: Pick<BangFiles, "anhTaoPath" | "saveImage" | "removeImage">,
  plan: ExportPlan,
  allowAgain: boolean,
): { done: { anhRowId: number; bangRowId: number }[]; failed: { id: number; why: string }[] } {
  const done: { anhRowId: number; bangRowId: number }[] = [];
  const failed: { id: number; why: string }[] = [];
  for (const it of plan.items) {
    if (it.again && !allowAgain) continue;
    const written: string[] = [];
    try {
      db.transaction(() => {
        const bangRowId = addBangRow(db, {});
        const copy = (f: AnhFile, tag: "mau-truoc" | "mau-sau") => {
          const src = files.anhTaoPath(f.file);
          if (!src) throw new Error(`không còn file ảnh ${tag === "mau-truoc" ? "mặt trước" : "quay lưng"}`);
          const name = files.saveImage(`${bangRowId}-${tag}`, new Uint8Array(fs.readFileSync(src)));
          written.push(name);
          return name;
        };
        setSlot(db, bangRowId, "modelFront", copy(it.front, "mau-truoc"));
        if (it.back) setSlot(db, bangRowId, "modelBack", copy(it.back, "mau-sau"));
        db.prepare("UPDATE anh_rows SET exportedBangRowId = ? WHERE id = ?").run(bangRowId, it.row.id);
        done.push({ anhRowId: it.row.id, bangRowId });
      })();
    } catch (e) {
      written.forEach((n) => files.removeImage(n));
      failed.push({ id: it.row.id, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { done, failed };
}
