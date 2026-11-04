import type { DB } from "../db/index.js";

// Thư viện nhân vật của Bảng ảnh (CON-77, CON-80, spec 17.13, D32): tên + ảnh 4 góc (character sheet, `file`) + ảnh mặt
// (`faceFile`, tuỳ chọn) người dùng tự thêm (tep\nhan-vat). Không đóng gói vào app. Xoá = đánh dấu deletedAt; dòng ảnh đã
// tạo giữ nguyên ảnh.

export interface NhanVat {
  id: number;
  ten: string;
  file: string;
  bytes: number;
  /** Ảnh mặt; null = nhân vật chỉ có ảnh 4 góc. */
  faceFile: string | null;
  faceBytes: number;
  createdAt: string;
}

export const MAX_TEN = 60;

/** Lý do không nhận tên nhân vật; null = nhận được. */
export function tenProblem(ten: string): string | null {
  const t = ten.trim();
  if (!t) return "Chưa đặt tên nhân vật.";
  if (t.length > MAX_TEN) return `Tên dài quá (tối đa ${MAX_TEN} ký tự).`;
  return null;
}

export function listNhanVat(db: DB): NhanVat[] {
  return db.prepare("SELECT id, ten, file, bytes, faceFile, faceBytes, createdAt FROM nhan_vat WHERE deletedAt IS NULL ORDER BY id").all() as NhanVat[];
}

export function getNhanVat(db: DB, id: number | null | undefined): NhanVat | undefined {
  if (!id) return undefined;
  return db.prepare("SELECT id, ten, file, bytes, faceFile, faceBytes, createdAt FROM nhan_vat WHERE id = ? AND deletedAt IS NULL").get(id) as NhanVat | undefined;
}

/**
 * Thêm nhân vật. File character sheet đặt tên theo số nhân vật nên cần số trước: ghi tên tạm, lưu file bằng
 * `save(id)`, rồi gắn tên file. `save` ném lỗi thì không thêm gì.
 */
export function addNhanVat(db: DB, ten: string, save: (id: number) => { file: string; bytes: number; faceFile?: string; faceBytes?: number }): number {
  return db.transaction(() => {
    const id = Number(db.prepare("INSERT INTO nhan_vat (ten, file) VALUES (?, '')").run(ten.trim()).lastInsertRowid);
    const f = save(id);
    db.prepare("UPDATE nhan_vat SET file = ?, bytes = ?, faceFile = ?, faceBytes = ? WHERE id = ?").run(f.file, f.bytes, f.faceFile ?? null, f.faceBytes ?? 0, id);
    return id;
  })();
}

export function renameNhanVat(db: DB, id: number, ten: string): void {
  db.prepare("UPDATE nhan_vat SET ten = ? WHERE id = ? AND deletedAt IS NULL").run(ten.trim(), id);
}

/** Đổi file character sheet (chỉ ảnh hưởng các lần tạo sau); trả tên file cũ để xoá. */
export function setNhanVatFile(db: DB, id: number, file: string, bytes: number): string | null {
  const old = getNhanVat(db, id)?.file ?? null;
  db.prepare("UPDATE nhan_vat SET file = ?, bytes = ? WHERE id = ? AND deletedAt IS NULL").run(file, bytes, id);
  return old && old !== file ? old : null;
}

/** Đặt ảnh mặt, `file` null = bỏ ảnh mặt (chỉ ảnh hưởng các lần tạo sau); trả tên file cũ để xoá. */
export function setNhanVatFace(db: DB, id: number, file: string | null, bytes: number): string | null {
  const old = getNhanVat(db, id)?.faceFile ?? null;
  db.prepare("UPDATE nhan_vat SET faceFile = ?, faceBytes = ? WHERE id = ? AND deletedAt IS NULL").run(file, bytes, id);
  return old && old !== file ? old : null;
}

/** Xoá nhân vật (người dùng bấm, D26); trả các tên file để xoá khỏi máy. */
export function deleteNhanVat(db: DB, id: number, at = new Date().toISOString()): string[] {
  const nv = getNhanVat(db, id);
  if (!nv) return [];
  db.prepare("UPDATE nhan_vat SET deletedAt = ? WHERE id = ?").run(at, id);
  return [nv.file, nv.faceFile].filter((f): f is string => !!f);
}

/** Số dòng Bảng ảnh (chưa xoá) đang chọn nhân vật này. */
export function nhanVatUsage(db: DB, id: number): number {
  return (db.prepare("SELECT count(*) AS n FROM anh_rows WHERE nhanVatId = ? AND deletedAt IS NULL").get(id) as { n: number }).n;
}
