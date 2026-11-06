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
  /** Ảnh master khi nhân vật được tạo trong app (CON-81); chỉ để lưu giữ, không gửi Muse trên Bảng ảnh. */
  masterFile: string | null;
  masterBytes: number;
  /** Khu vực để lọc (CON-100); null = nhân vật thêm tay từ trước, chưa chọn. */
  khuVuc: string | null;
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
  return db.prepare("SELECT id, ten, file, bytes, faceFile, faceBytes, masterFile, masterBytes, khuVuc, createdAt FROM nhan_vat WHERE deletedAt IS NULL ORDER BY id").all() as NhanVat[];
}

export function getNhanVat(db: DB, id: number | null | undefined): NhanVat | undefined {
  if (!id) return undefined;
  return db.prepare("SELECT id, ten, file, bytes, faceFile, faceBytes, masterFile, masterBytes, khuVuc, createdAt FROM nhan_vat WHERE id = ? AND deletedAt IS NULL").get(id) as NhanVat | undefined;
}

/**
 * Thêm nhân vật. File character sheet đặt tên theo số nhân vật nên cần số trước: ghi tên tạm, lưu file bằng
 * `save(id)`, rồi gắn tên file. `save` ném lỗi thì không thêm gì.
 */
export function addNhanVat(db: DB, ten: string, save: (id: number) => { file: string; bytes: number; faceFile?: string; faceBytes?: number; masterFile?: string; masterBytes?: number }, khuVuc: string | null = null): number {
  return db.transaction(() => {
    const id = Number(db.prepare("INSERT INTO nhan_vat (ten, file, khuVuc) VALUES (?, '', ?)").run(ten.trim(), khuVuc).lastInsertRowid);
    const f = save(id);
    db.prepare("UPDATE nhan_vat SET file = ?, bytes = ?, faceFile = ?, faceBytes = ?, masterFile = ?, masterBytes = ? WHERE id = ?").run(f.file, f.bytes, f.faceFile ?? null, f.faceBytes ?? 0, f.masterFile ?? null, f.masterBytes ?? 0, id);
    return id;
  })();
}

export function renameNhanVat(db: DB, id: number, ten: string): void {
  db.prepare("UPDATE nhan_vat SET ten = ? WHERE id = ? AND deletedAt IS NULL").run(ten.trim(), id);
}

export function setNhanVatKhuVuc(db: DB, id: number, khuVuc: string): void {
  db.prepare("UPDATE nhan_vat SET khuVuc = ? WHERE id = ? AND deletedAt IS NULL").run(khuVuc, id);
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

/** Đặt ảnh master (nhân vật tạo trong app, CON-82); trả tên file cũ để xoá. */
export function setNhanVatMaster(db: DB, id: number, file: string, bytes: number): string | null {
  const old = getNhanVat(db, id)?.masterFile ?? null;
  db.prepare("UPDATE nhan_vat SET masterFile = ?, masterBytes = ? WHERE id = ? AND deletedAt IS NULL").run(file, bytes, id);
  return old && old !== file ? old : null;
}

/** Xoá nhân vật (người dùng bấm, D26); trả các tên file để xoá khỏi máy. */
export function deleteNhanVat(db: DB, id: number, at = new Date().toISOString()): string[] {
  const nv = getNhanVat(db, id);
  if (!nv) return [];
  db.prepare("UPDATE nhan_vat SET deletedAt = ? WHERE id = ?").run(at, id);
  return [nv.file, nv.faceFile, nv.masterFile].filter((f): f is string => !!f);
}

/** Còn lượt chưa xong của Bảng ảnh dùng file ảnh nhân vật này không (ảnh 4 góc hoặc ảnh mặt). */
export function fileInUse(db: DB, file: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM runs r JOIN batches b ON b.id = r.batchId
       WHERE r.anhRowId IS NOT NULL AND b.status IN ('queued', 'running', 'paused')
         AND r.state NOT IN ('done', 'failed', 'needs_review', 'skipped_has_video', 'canceled')
         AND ? IN (json_extract(r.inputSnapshot, '$.nhanVatFile'), json_extract(r.inputSnapshot, '$.nhanVatFaceFile')) LIMIT 1`,
    )
    .get(file);
  return !!row;
}

/** Số dòng Bảng ảnh (chưa xoá) đang chọn nhân vật này. */
export function nhanVatUsage(db: DB, id: number): number {
  return (db.prepare("SELECT count(*) AS n FROM anh_rows WHERE nhanVatId = ? AND deletedAt IS NULL").get(id) as { n: number }).n;
}
