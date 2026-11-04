import { FINAL_RUN_STATES } from "../batch/create.js";
import type { DB } from "../db/index.js";

// Các dòng của Bảng ảnh (CON-77, spec 17.13, D31–D33). Số dòng = id, tăng dần, không dùng lại.
// Ảnh Muse tạo nằm ở bảng anh_files (mỗi dòng giữ mọi ảnh, `chosen` = ảnh chính của mặt đó).

export type Side = "truoc" | "sau";
export const SIDES: Side[] = ["truoc", "sau"];
export const SIDE_TEXT: Record<Side, string> = { truoc: "Ảnh mặt trước", sau: "Ảnh quay lưng" };
export const isSide = (s: unknown): s is Side => s === "truoc" || s === "sau";

export interface AnhRow {
  id: number;
  createdAt: string;
  nhanVatId: number | null;
  /** Tên nhân vật; null khi chưa chọn hoặc nhân vật đã bị xoá. */
  nhanVatTen: string | null;
  nhanVatFile: string | null;
  /** Ảnh mặt của nhân vật; null = không có. */
  nhanVatFaceFile: string | null;
  prompt: string;
  /** Tích "Quay lưng" (D33): 1 = tạo thêm ảnh quay lưng. */
  backOn: number;
  exportedBangRowId: number | null;
  /** 1 khi dòng Bảng video đã xuất tới còn (chưa bị xoá). */
  exportedAlive: number;
  /** Số ảnh đang có mỗi mặt. */
  frontCount: number;
  backCount: number;
  /** Lượt gần nhất của dòng; null = chưa chạy lần nào. */
  runState: string | null;
  runError?: string | null;
  runPhase?: string | null;
  museChatUrl?: string | null;
}

export interface AnhFile {
  id: number;
  anhRowId: number;
  side: Side;
  file: string;
  bytes: number;
  chosen: number;
  createdAt: string;
}

export type AnhLabel = "ready" | "missing_data" | "running" | "done" | "review";
export const ANH_LABEL_TEXT: Record<AnhLabel, string> = {
  ready: "Sẵn sàng",
  missing_data: "Thiếu dữ liệu",
  running: "Đang tạo",
  done: "Xong",
  review: "Cần xem",
};

const FINAL = new Set<string>(FINAL_RUN_STATES);
const REVIEW_STATES = ["failed", "needs_review"];

/**
 * Nhãn: đang tạo → xong (có ảnh mặt trước, và có ảnh quay lưng nếu tích Quay lưng) → thiếu dữ liệu → cần xem → sẵn sàng.
 * Thiếu dữ liệu: cần nhân vật (còn trong thư viện) và prompt.
 */
export function labelOf(r: AnhRow): { label: AnhLabel; problems: string[] } {
  if (r.runState && !FINAL.has(r.runState)) return { label: "running", problems: [] };
  if (r.frontCount > 0 && (!r.backOn || r.backCount > 0)) return { label: "done", problems: [] };
  const problems: string[] = [];
  if (!r.nhanVatId) problems.push("Chưa chọn nhân vật");
  else if (!r.nhanVatTen) problems.push("Nhân vật đã bị xoá: chọn nhân vật khác");
  if (!r.prompt.trim()) problems.push("Thiếu prompt");
  if (problems.length) return { label: "missing_data", problems };
  if (r.runState && REVIEW_STATES.includes(r.runState)) return { label: "review", problems: r.runError ? [r.runError] : [] };
  return { label: "ready", problems };
}

const lastRun = (col: string) => `(SELECT ${col} FROM runs WHERE runs.anhRowId = anh_rows.id ORDER BY runs.id DESC LIMIT 1)`;
const LAST_STATE = lastRun("state");
const FINAL_SQL = FINAL_RUN_STATES.map((s) => `'${s}'`).join(", ");
const has = (side: Side) => `EXISTS (SELECT 1 FROM anh_files f WHERE f.anhRowId = anh_rows.id AND f.side = '${side}')`;
const RUNNING_SQL = `(${LAST_STATE} IS NOT NULL AND ${LAST_STATE} NOT IN (${FINAL_SQL}))`;
const DONE_SQL = `(NOT ${RUNNING_SQL} AND ${has("truoc")} AND (backOn = 0 OR ${has("sau")}))`;
const LIVE_NV = "(SELECT n.ten FROM nhan_vat n WHERE n.id = anh_rows.nhanVatId AND n.deletedAt IS NULL)";
const MISSING_DATA_SQL = `(${LIVE_NV} IS NULL OR trim(prompt) = '')`;
const MISSING_SQL = `(${MISSING_DATA_SQL} AND NOT ${RUNNING_SQL} AND NOT ${DONE_SQL})`;
const REVIEW_SQL = `(${LAST_STATE} IN ('failed', 'needs_review') AND NOT ${DONE_SQL} AND NOT ${MISSING_DATA_SQL})`;
const TODO_SQL = `(NOT ${RUNNING_SQL} AND NOT ${DONE_SQL} AND NOT ${MISSING_DATA_SQL})`;

export const FILTERS = ["all", "today", "todo", "missing", "running", "done", "review", "exported"] as const;
export type AnhFilter = (typeof FILTERS)[number];
export const FILTER_TEXT: Record<AnhFilter, string> = {
  all: "Tất cả",
  today: "Hôm nay",
  todo: "Chưa tạo",
  missing: "Thiếu dữ liệu",
  running: "Đang tạo",
  done: "Xong",
  review: "Cần xem",
  exported: "Đã xuất",
};
export const isFilter = (s: unknown): s is AnhFilter => FILTERS.includes(s as AnhFilter);

export const PER_PAGE = 50;

const FILTER_SQL: Record<Exclude<AnhFilter, "all" | "today">, string> = {
  todo: TODO_SQL,
  missing: MISSING_SQL,
  running: RUNNING_SQL,
  done: DONE_SQL,
  review: REVIEW_SQL,
  exported: "exportedBangRowId IS NOT NULL",
};

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function startOfToday(now: Date): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function where(filter: AnhFilter, q: string, now: Date): { sql: string; args: unknown[] } {
  const parts = ["deletedAt IS NULL"];
  const args: unknown[] = [];
  if (filter === "today") {
    parts.push("createdAt >= ?");
    args.push(startOfToday(now));
  } else if (filter !== "all") parts.push(FILTER_SQL[filter]);
  const term = q.trim();
  if (term) {
    if (/^\d+$/.test(term)) {
      parts.push("(id = ? OR prompt LIKE ? ESCAPE '\\')");
      args.push(Number(term), `%${likeEscape(term)}%`);
    } else {
      parts.push(`(prompt LIKE ? ESCAPE '\\' OR coalesce(${LIVE_NV}, '') LIKE ? ESCAPE '\\')`);
      args.push(`%${likeEscape(term)}%`, `%${likeEscape(term)}%`);
    }
  }
  return { sql: parts.join(" AND "), args };
}

const count = (side: Side) => `(SELECT count(*) FROM anh_files f WHERE f.anhRowId = anh_rows.id AND f.side = '${side}')`;
const COLS = `id, createdAt, nhanVatId, ${LIVE_NV} AS nhanVatTen,
  (SELECT n.file FROM nhan_vat n WHERE n.id = anh_rows.nhanVatId AND n.deletedAt IS NULL) AS nhanVatFile,
  (SELECT n.faceFile FROM nhan_vat n WHERE n.id = anh_rows.nhanVatId AND n.deletedAt IS NULL) AS nhanVatFaceFile,
  prompt, backOn, exportedBangRowId,
  (SELECT count(*) FROM bang_rows b WHERE b.id = anh_rows.exportedBangRowId AND b.deletedAt IS NULL) AS exportedAlive, ${count("truoc")} AS frontCount, ${count("sau")} AS backCount,
  ${LAST_STATE} AS runState, ${lastRun("error")} AS runError, ${lastRun("anhPhase")} AS runPhase, ${lastRun("museChatUrl")} AS museChatUrl`;

/** Một trang của Bảng ảnh, dòng mới nhất trước. */
export function listRows(db: DB, o: { filter?: AnhFilter; q?: string; page?: number; now?: Date } = {}) {
  const w = where(o.filter ?? "all", o.q ?? "", o.now ?? new Date());
  const total = (db.prepare(`SELECT count(*) AS n FROM anh_rows WHERE ${w.sql}`).get(...w.args) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(o.page ?? 1)), pages);
  const rows = db
    .prepare(`SELECT ${COLS} FROM anh_rows WHERE ${w.sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...w.args, PER_PAGE, (page - 1) * PER_PAGE) as AnhRow[];
  return { rows, total, page, pages };
}

export function countByFilter(db: DB, now = new Date()): Record<AnhFilter, number> {
  const out = {} as Record<AnhFilter, number>;
  for (const f of FILTERS) {
    const w = where(f, "", now);
    out[f] = (db.prepare(`SELECT count(*) AS n FROM anh_rows WHERE ${w.sql}`).get(...w.args) as { n: number }).n;
  }
  return out;
}

export function getRow(db: DB, id: number): AnhRow | undefined {
  return db.prepare(`SELECT ${COLS} FROM anh_rows WHERE id = ? AND deletedAt IS NULL`).get(id) as AnhRow | undefined;
}

/** Thêm một dòng; trả số dòng mới. */
export function addRow(db: DB, init: { nhanVatId?: number | null; prompt?: string; backOn?: boolean } = {}): number {
  const r = db
    .prepare("INSERT INTO anh_rows (nhanVatId, prompt, backOn) VALUES (?, ?, ?)")
    .run(init.nhanVatId ?? null, (init.prompt ?? "").trim(), init.backOn ? 1 : 0);
  return Number(r.lastInsertRowid);
}

/** Tách đoạn dán thành các prompt: mỗi dòng không trống là một prompt. */
export function splitPrompts(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function setPrompt(db: DB, id: number, prompt: string): void {
  db.prepare("UPDATE anh_rows SET prompt = ? WHERE id = ? AND deletedAt IS NULL").run(prompt.trim(), id);
}

export function setNhanVat(db: DB, id: number, nhanVatId: number): void {
  db.prepare("UPDATE anh_rows SET nhanVatId = ? WHERE id = ? AND deletedAt IS NULL").run(nhanVatId, id);
}

export function setBackOn(db: DB, id: number, on: boolean): void {
  db.prepare("UPDATE anh_rows SET backOn = ? WHERE id = ? AND deletedAt IS NULL").run(on ? 1 : 0, id);
}

// ---------- Ảnh Muse tạo ----------

/** Ảnh của các dòng, ảnh cũ trước (để ◀ ▶ đi theo thứ tự tạo). */
export function filesOf(db: DB, ids: number[]): Map<number, AnhFile[]> {
  const out = new Map<number, AnhFile[]>();
  if (!ids.length) return out;
  const rows = db
    .prepare(`SELECT id, anhRowId, side, file, bytes, chosen, createdAt FROM anh_files WHERE anhRowId IN (${ids.map(() => "?").join(", ")}) ORDER BY id`)
    .all(...ids) as AnhFile[];
  for (const f of rows) {
    const list = out.get(f.anhRowId) ?? [];
    list.push(f);
    out.set(f.anhRowId, list);
  }
  return out;
}

/** Ảnh chính của một mặt: ảnh đang được chọn, không có thì ảnh mới nhất. */
export function mainFile(files: AnhFile[], side: Side): AnhFile | undefined {
  const list = files.filter((f) => f.side === side);
  return list.find((f) => f.chosen) ?? list[list.length - 1];
}

/**
 * Gắn các ảnh vừa tải của một lượt vào dòng (17.13). Ảnh đầu tiên thành ảnh chính của mặt đó (lần tạo mới nhất được
 * ưu tiên); ảnh cũ vẫn giữ đến khi người dùng xoá.
 */
export function addFiles(db: DB, rowId: number, runId: number | null, side: Side, list: { file: string; bytes: number }[]): void {
  if (!list.length) return;
  db.transaction(() => {
    db.prepare("UPDATE anh_files SET chosen = 0 WHERE anhRowId = ? AND side = ?").run(rowId, side);
    const ins = db.prepare("INSERT INTO anh_files (anhRowId, runId, side, file, bytes, chosen) VALUES (?, ?, ?, ?, ?, ?)");
    list.forEach((f, i) => ins.run(rowId, runId, side, f.file, f.bytes, i === 0 ? 1 : 0));
  })();
}

export function getFile(db: DB, fileId: number): AnhFile | undefined {
  return db.prepare("SELECT id, anhRowId, side, file, bytes, chosen, createdAt FROM anh_files WHERE id = ?").get(fileId) as AnhFile | undefined;
}

/** ★ Chọn làm ảnh chính của mặt đó. */
export function chooseFile(db: DB, fileId: number): void {
  const f = getFile(db, fileId);
  if (!f) return;
  db.transaction(() => {
    db.prepare("UPDATE anh_files SET chosen = 0 WHERE anhRowId = ? AND side = ?").run(f.anhRowId, f.side);
    db.prepare("UPDATE anh_files SET chosen = 1 WHERE id = ?").run(fileId);
  })();
}

/** 🗑 Xoá một ảnh; trả tên file để xoá khỏi máy. Xoá ảnh chính thì ảnh mới nhất còn lại thành ảnh chính. */
export function deleteFile(db: DB, fileId: number): string | null {
  const f = getFile(db, fileId);
  if (!f) return null;
  db.transaction(() => {
    db.prepare("DELETE FROM anh_files WHERE id = ?").run(fileId);
    if (f.chosen) {
      db.prepare(
        "UPDATE anh_files SET chosen = 1 WHERE id = (SELECT id FROM anh_files WHERE anhRowId = ? AND side = ? ORDER BY id DESC LIMIT 1)",
      ).run(f.anhRowId, f.side);
    }
  })();
  return f.file;
}

/** Dòng của Bảng ảnh đang trong lô chưa xong: khoá sửa. */
export function lockedAnhRows(db: DB): Set<number> {
  const rows = db
    .prepare(
      `SELECT DISTINCT r.anhRowId AS id FROM runs r JOIN batches b ON b.id = r.batchId
       WHERE r.anhRowId IS NOT NULL AND b.status IN ('queued', 'running', 'paused')
         AND r.state NOT IN (${FINAL_RUN_STATES.map(() => "?").join(", ")})`,
    )
    .all(...FINAL_RUN_STATES) as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

/** Xoá dòng (D26): đánh dấu deletedAt, bỏ mọi ảnh của dòng. Trả các file cần xoá khỏi máy. */
export function deleteRows(db: DB, ids: number[], at = new Date().toISOString()): string[] {
  const files: string[] = [];
  db.transaction(() => {
    for (const id of ids) {
      if (!getRow(db, id)) continue;
      for (const f of filesOf(db, [id]).get(id) ?? []) files.push(f.file);
      db.prepare("DELETE FROM anh_files WHERE anhRowId = ?").run(id);
      db.prepare("UPDATE anh_rows SET deletedAt = ? WHERE id = ?").run(at, id);
    }
  })();
  return files;
}

/** "Dọn tất cả" của Bảng ảnh: các dòng Xong (tích thêm: mọi dòng); không bao giờ dòng đang tạo. */
export function cleanupIds(db: DB, includeTodo: boolean): number[] {
  const cond = includeTodo ? `NOT ${RUNNING_SQL}` : DONE_SQL;
  const locked = lockedAnhRows(db);
  return (db.prepare(`SELECT id FROM anh_rows WHERE deletedAt IS NULL AND ${cond} ORDER BY id`).all() as { id: number }[])
    .map((r) => r.id)
    .filter((id) => !locked.has(id));
}
