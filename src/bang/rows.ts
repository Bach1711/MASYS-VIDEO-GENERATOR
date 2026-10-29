import { FINAL_RUN_STATES } from "../batch/create.js";
import type { DB } from "../db/index.js";

// Các dòng của Bảng mới (spec v6.0 mục 17.2–17.4, D21). Số dòng = id, tăng dần, không dùng lại.

export const SLOTS = ["modelFront", "shirtFront", "modelBack", "shirtBack"] as const;
export type Slot = (typeof SLOTS)[number];
export const isSlot = (s: unknown): s is Slot => SLOTS.includes(s as Slot);

export const SLOT_TEXT: Record<Slot, string> = { modelFront: "Mẫu trước", shirtFront: "Áo trước", modelBack: "Mẫu sau", shirtBack: "Áo sau" };
/** Phần tên file ảnh theo ô. */
export const SLOT_TAG: Record<Slot, string> = { modelFront: "mau-truoc", shirtFront: "ao-truoc", modelBack: "mau-sau", shirtBack: "ao-sau" };

export interface BangRow {
  id: number;
  createdAt: string;
  prompt: string;
  modelFront: string | null;
  shirtFront: string | null;
  modelBack: string | null;
  shirtBack: string | null;
  videoFile: string | null;
  videoBytes: number | null;
  videoAt: string | null;
  importedFrom: string | null;
  /** Lượt tạo video gần nhất của dòng (CON-52); null = chưa chạy lần nào. */
  runState: string | null;
  runError?: string | null;
  museChatUrl?: string | null;
}

export type BangLabel = "ready" | "missing_data" | "running" | "done" | "review";
export const BANG_LABEL_TEXT: Record<BangLabel, string> = {
  ready: "Sẵn sàng",
  missing_data: "Thiếu dữ liệu",
  running: "Đang chạy",
  done: "Xong",
  review: "Cần xem",
};

const FINAL = new Set<string>(FINAL_RUN_STATES);
const REVIEW_STATES = ["failed", "needs_review"];

/**
 * Nhãn theo bảng 17.4 và lượt gần nhất: đang chạy → xong → thiếu dữ liệu → cần xem → sẵn sàng.
 * Thiếu dữ liệu: cần mẫu trước + prompt; có mặt sau thì cần đủ 4 ảnh.
 */
export function labelOf(r: BangRow): { label: BangLabel; problems: string[] } {
  if (r.runState && !FINAL.has(r.runState)) return { label: "running", problems: [] };
  if (r.videoFile || r.runState === "done") return { label: "done", problems: [] };
  const problems: string[] = [];
  if (!r.modelFront) problems.push("Thiếu ảnh người mẫu mặt trước");
  if (!r.prompt.trim()) problems.push("Thiếu prompt");
  if (r.modelBack || r.shirtBack) {
    const missing = SLOTS.filter((s) => !r[s] && s !== "modelFront").map((s) => SLOT_TEXT[s]);
    if (missing.length) problems.push(`Có mặt sau nên cần đủ 4 ảnh, còn thiếu: ${missing.join(", ")}`);
  }
  if (problems.length) return { label: "missing_data", problems };
  if (r.runState && REVIEW_STATES.includes(r.runState)) return { label: "review", problems: r.runError ? [r.runError] : [] };
  return { label: "ready", problems };
}

/** Một cột của lượt gần nhất của dòng (lượt của Bảng mới gắn qua runs.bangRowId). */
const lastRun = (col: string) => `(SELECT ${col} FROM runs WHERE runs.bangRowId = bang_rows.id ORDER BY runs.id DESC LIMIT 1)`;
const LAST_STATE = lastRun("state");
const FINAL_SQL = FINAL_RUN_STATES.map((s) => `'${s}'`).join(", ");
const RUNNING_SQL = `(${LAST_STATE} IS NOT NULL AND ${LAST_STATE} NOT IN (${FINAL_SQL}))`;
const DONE_SQL = `(videoFile IS NOT NULL OR coalesce(${LAST_STATE}, '') = 'done')`;

/** Điều kiện "Thiếu dữ liệu" viết bằng SQL, khớp với labelOf, để lọc và đếm cả bảng. */
const MISSING_DATA_SQL = `(modelFront IS NULL OR trim(prompt) = '' OR
  ((modelBack IS NOT NULL OR shirtBack IS NOT NULL) AND (shirtFront IS NULL OR modelBack IS NULL OR shirtBack IS NULL)))`;
const MISSING_SQL = `(${MISSING_DATA_SQL} AND NOT ${RUNNING_SQL} AND NOT ${DONE_SQL})`;
const REVIEW_SQL = `(${LAST_STATE} IN ('failed', 'needs_review') AND videoFile IS NULL AND NOT ${MISSING_DATA_SQL})`;
const TODO_SQL = `(NOT ${RUNNING_SQL} AND NOT ${DONE_SQL} AND NOT ${MISSING_DATA_SQL})`;

export const FILTERS = ["all", "today", "todo", "missing", "running", "done", "review"] as const;
export type BangFilter = (typeof FILTERS)[number];
export const FILTER_TEXT: Record<BangFilter, string> = {
  all: "Tất cả",
  today: "Hôm nay",
  todo: "Chưa tạo",
  missing: "Thiếu dữ liệu",
  running: "Đang chạy",
  done: "Xong",
  review: "Cần xem",
};
export const isFilter = (s: unknown): s is BangFilter => FILTERS.includes(s as BangFilter);

export const PER_PAGE = 50;

/** Đầu ngày hôm nay theo giờ máy, dạng ISO UTC (so được với createdAt). */
export function startOfToday(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const FILTER_SQL: Record<Exclude<BangFilter, "all" | "today">, string> = {
  todo: TODO_SQL,
  missing: MISSING_SQL,
  running: RUNNING_SQL,
  done: DONE_SQL,
  review: REVIEW_SQL,
};

function where(filter: BangFilter, q: string, now: Date): { sql: string; args: unknown[] } {
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
      parts.push("prompt LIKE ? ESCAPE '\\'");
      args.push(`%${likeEscape(term)}%`);
    }
  }
  return { sql: parts.join(" AND "), args };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const COLS = `id, createdAt, prompt, modelFront, shirtFront, modelBack, shirtBack, videoFile, videoBytes, videoAt, importedFrom,
  ${LAST_STATE} AS runState, ${lastRun("error")} AS runError, ${lastRun("museChatUrl")} AS museChatUrl`;

/** Một trang của Bảng, dòng mới nhất trước. */
export function listRows(db: DB, o: { filter?: BangFilter; q?: string; page?: number; now?: Date } = {}) {
  const w = where(o.filter ?? "all", o.q ?? "", o.now ?? new Date());
  const total = (db.prepare(`SELECT count(*) AS n FROM bang_rows WHERE ${w.sql}`).get(...w.args) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(o.page ?? 1)), pages);
  const rows = db
    .prepare(`SELECT ${COLS} FROM bang_rows WHERE ${w.sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...w.args, PER_PAGE, (page - 1) * PER_PAGE) as BangRow[];
  return { rows, total, page, pages };
}

/** Số dòng theo từng bộ lọc (chữ trên các nút lọc). */
export function countByFilter(db: DB, now = new Date()): Record<BangFilter, number> {
  const out = {} as Record<BangFilter, number>;
  for (const f of FILTERS) {
    const w = where(f, "", now);
    out[f] = (db.prepare(`SELECT count(*) AS n FROM bang_rows WHERE ${w.sql}`).get(...w.args) as { n: number }).n;
  }
  return out;
}

export function getRow(db: DB, id: number): BangRow | undefined {
  return db.prepare(`SELECT ${COLS} FROM bang_rows WHERE id = ? AND deletedAt IS NULL`).get(id) as BangRow | undefined;
}

/** Thêm một dòng; trả số dòng mới. */
export function addRow(db: DB, init: { prompt?: string; importedFrom?: string } & Partial<Record<Slot, string | null>> = {}): number {
  const r = db
    .prepare("INSERT INTO bang_rows (prompt, modelFront, shirtFront, modelBack, shirtBack, importedFrom) VALUES (?, ?, ?, ?, ?, ?)")
    .run(init.prompt ?? "", init.modelFront ?? null, init.shirtFront ?? null, init.modelBack ?? null, init.shirtBack ?? null, init.importedFrom ?? null);
  return Number(r.lastInsertRowid);
}

export function setPrompt(db: DB, id: number, prompt: string): void {
  db.prepare("UPDATE bang_rows SET prompt = ? WHERE id = ? AND deletedAt IS NULL").run(prompt, id);
}

/** Đặt / bỏ ảnh của một ô; trả tên file cũ (để xoá file). */
export function setSlot(db: DB, id: number, slot: Slot, name: string | null): string | null {
  const old = (db.prepare(`SELECT ${slot} AS f FROM bang_rows WHERE id = ?`).get(id) as { f: string | null } | undefined)?.f ?? null;
  db.prepare(`UPDATE bang_rows SET ${slot} = ? WHERE id = ? AND deletedAt IS NULL`).run(name, id);
  return old;
}

export function importedKeys(db: DB, prefix: string): Set<string> {
  const rows = db.prepare("SELECT importedFrom AS k FROM bang_rows WHERE importedFrom LIKE ? ESCAPE '\\'").all(`${likeEscape(prefix)}%`) as { k: string }[];
  return new Set(rows.map((r) => r.k));
}

/** Dòng của Bảng mới đang trong lô chưa xong (CON-52 trở đi): khoá sửa. */
export function lockedBangRows(db: DB): Set<number> {
  const rows = db
    .prepare(
      `SELECT DISTINCT r.bangRowId AS id FROM runs r JOIN batches b ON b.id = r.batchId
       WHERE r.bangRowId IS NOT NULL AND b.status IN ('queued', 'running', 'paused')
         AND r.state NOT IN (${FINAL_RUN_STATES.map(() => "?").join(", ")})`,
    )
    .all(...FINAL_RUN_STATES) as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

export interface BangFillPlan {
  prompt: string;
  targets: number[];
  skipped: { id: number; why: string }[];
}

/**
 * Dải prompt trên Bảng mới (như v5.0 16.3): chép prompt của dòng nguồn sang các dòng chọn.
 * Bỏ qua dòng đang tạo video, dòng đã có video (trừ khi tích), dòng đã cùng prompt, dòng không có.
 */
export function planBangFill(db: DB, source: number, ids: number[], includeVideo: boolean): BangFillPlan | { error: string } {
  const src = getRow(db, source);
  if (!src) return { error: `Không có dòng ${source}.` };
  if (!src.prompt.trim()) return { error: `Dòng ${source} chưa có prompt.` };
  const locked = lockedBangRows(db);
  const targets: number[] = [];
  const skipped: { id: number; why: string }[] = [];
  for (const id of ids) {
    if (id === source) continue;
    const r = getRow(db, id);
    if (!r) skipped.push({ id, why: "không có dòng này" });
    else if (locked.has(id)) skipped.push({ id, why: "đang tạo video" });
    else if (labelOf(r).label === "done" && !includeVideo) skipped.push({ id, why: "đã có video" });
    else if (r.prompt === src.prompt) skipped.push({ id, why: "đã cùng prompt" });
    else targets.push(id);
  }
  return { prompt: src.prompt, targets, skipped };
}

export function applyBangFill(db: DB, plan: BangFillPlan): void {
  const stmt = db.prepare("UPDATE bang_rows SET prompt = ? WHERE id = ? AND deletedAt IS NULL");
  db.transaction(() => plan.targets.forEach((id) => stmt.run(plan.prompt, id)))();
}

/** Mọi số dòng còn trên Bảng (để "Dải xuống" / chọn tất cả). */
export function allRowIds(db: DB): number[] {
  return (db.prepare("SELECT id FROM bang_rows WHERE deletedAt IS NULL ORDER BY id").all() as { id: number }[]).map((r) => r.id);
}
