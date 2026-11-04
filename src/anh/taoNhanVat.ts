import { FINAL_RUN_STATES } from "../batch/create.js";
import type { DB } from "../db/index.js";

// Tạo nhân vật ngay trong app (CON-81, spec 17.14, D35), đúng quy trình người phụ trách dùng trên Flow:
// 12 tiêu chí → mô tả nhân vật → ảnh master (không kèm ảnh) → đính kèm master tạo ảnh turnaround và ảnh face.
// Bản nháp nằm ở nv_drafts, ảnh Muse tạo ở nv_draft_files (tep\anh-tao); bấm Lưu mới chép sang thư viện Nhân vật.

export const REGIONS = ["Western European", "American", "East Asian", "Vietnamese"] as const;
export const GENDERS = ["woman", "man"] as const;
export const MIN_AGE = 18;
export const MAX_AGE = 80;

export const CRITERIA = [
  { key: "tuoi", label: "Tuổi", example: "24" },
  { key: "khuVuc", label: "Khu vực", example: "Western European" },
  { key: "gioiTinh", label: "Giới tính", example: "woman" },
  { key: "vocDang", label: "Vóc dáng", example: "tall slim build" },
  { key: "da", label: "Da", example: "fair skin with light freckles across the nose" },
  { key: "khuonMat", label: "Khuôn mặt", example: "oval face" },
  { key: "mat", label: "Mắt", example: "grey-blue eyes" },
  { key: "toc", label: "Tóc", example: "shoulder-length wavy chestnut brown hair parted in the center" },
  { key: "phuKien", label: "Phụ kiện", example: "small silver hoop earrings" },
  { key: "ao", label: "Áo", example: "cream cropped knit sweater" },
  { key: "quan", label: "Quần", example: "light blue wide-leg jeans" },
  { key: "giay", label: "Giày", example: "white canvas sneakers" },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];
export type Criteria = Record<CriterionKey, string>;

const MAX_VALUE = 200;
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Lấy 12 tiêu chí từ dữ liệu trang gửi lên (khoá lạ bị bỏ, chữ gọn lại một dòng). */
export function readCriteria(body: Record<string, unknown>): Criteria {
  return Object.fromEntries(CRITERIA.map((c) => [c.key, clean(body[c.key]).slice(0, MAX_VALUE)])) as Criteria;
}

const validAge = (s: string) => /^\d+$/.test(s) && Number(s) >= MIN_AGE && Number(s) <= MAX_AGE;

/** Các lỗi của tiêu chí; rỗng = dùng được. Chỉ Phụ kiện được để trống. */
export function criteriaProblems(c: Criteria): string[] {
  const out: string[] = [];
  if (!c.tuoi) out.push("Chưa điền Tuổi.");
  else if (!validAge(c.tuoi)) out.push(`Tuổi phải là số từ ${MIN_AGE} đến ${MAX_AGE}.`);
  if (!REGIONS.includes(c.khuVuc as (typeof REGIONS)[number])) out.push("Chưa chọn Khu vực.");
  if (!GENDERS.includes(c.gioiTinh as (typeof GENDERS)[number])) out.push("Chưa chọn Giới tính.");
  for (const f of CRITERIA) {
    if (["tuoi", "khuVuc", "gioiTinh", "phuKien"].includes(f.key)) continue;
    if (!c[f.key]) out.push(`Chưa điền ${f.label}.`);
  }
  return out;
}

/** Mô tả nhân vật ([PROMPT_CORE]), luôn có chữ adult. */
export function buildCore(c: Criteria): string {
  const head = `${c.tuoi}-year-old adult ${c.khuVuc} ${c.gioiTinh}`;
  return [head, c.vocDang, c.da, c.khuonMat, c.mat, c.toc, c.phuKien, c.ao, c.quan, c.giay].filter(Boolean).join(", ");
}

// ---------- Prompt gửi Muse (nguyên văn của người phụ trách; dòng cuối thêm cho Muse vì đây là khung chat) ----------

const IN_CHAT = "Send the finished image directly in this chat.";

export function masterPrompt(core: string): string {
  return `Full-body character design of ${core}.
Standing straight facing the camera, neutral expression, arms relaxed at the sides, hands empty.
Plain light grey background, flat even studio lighting, no harsh shadows.
Photorealistic.
No text, no logo, no extra people, no props.
${IN_CHAT}`;
}

export const TURNAROUND_PROMPT = `Using the attached image as the exact reference, create a character turnaround sheet of the same character.
Show four full-body views side by side, left to right: front, three-quarter, side profile, back.
Keep the face, hair, body proportions, outfit and colors identical to the reference.
All views at the same scale and height, feet on the same baseline, neutral pose, hands empty.
Plain light grey background, flat even lighting, wide 16:9 layout.
Do not redesign the character. No text, no labels, no extra people.
${IN_CHAT}`;

export const FACE_PROMPT = `Using the attached image as the exact reference, create a close-up portrait of the same character, head and shoulders, facing the camera, neutral expression.
Keep the face shape, eyes, skin tone, hair and distinctive marks identical to the reference.
Plain light grey background, soft even lighting, sharp focus on the face.
No text, no extra people.
${IN_CHAT}`;

// ---------- Nhờ AI khác điền tiêu chí còn trống ----------

const askLine = (f: (typeof CRITERIA)[number]) => {
  if (f.key === "tuoi") return `(cần điền: một số từ ${MIN_AGE} đến ${MAX_AGE})`;
  if (f.key === "khuVuc") return `(cần điền: chọn đúng một trong ${REGIONS.join(" / ")})`;
  if (f.key === "gioiTinh") return `(cần điền: chọn đúng một trong ${GENDERS.join(" / ")})`;
  return `(cần điền, ví dụ: ${f.example})`;
};

/** Prompt để người dùng sao chép sang AI khác: giữ ô đã điền, nhờ điền ô trống, trả về đúng 12 dòng để dán lại app. */
export function buildFillPrompt(c: Criteria): string {
  const lines = CRITERIA.map((f) => `${f.label}: ${c[f.key] || askLine(f)}`);
  return `Tôi đang thiết kế một nhân vật hư cấu là người trưởng thành, để làm người mẫu trong ảnh thời trang chân thực.
Hãy điền các tiêu chí đang ghi "cần điền" sao cho cả nhân vật hài hoà, tự nhiên và hợp với khu vực của nhân vật. Trang phục đơn giản, dễ phối đồ.
Giữ nguyên các tiêu chí tôi đã điền. Giá trị viết bằng tiếng Anh, ngắn gọn như ví dụ; ví dụ chỉ minh hoạ cách viết, đừng chép lại. Không tả người thật hay người nổi tiếng. Nếu không cần phụ kiện thì ghi none.

${lines.join("\n")}

Chỉ trả lời đúng 12 dòng theo dạng "Tên tiêu chí: giá trị", giữ nguyên tên tiêu chí tiếng Việt, không thêm gì khác.`;
}

const fold = (s: string) => s.normalize("NFC").toLowerCase();

/** Đọc câu trả lời của AI thành các tiêu chí; dòng không nhận ra hoặc giá trị không hợp lệ thì bỏ qua. */
export function parseFillAnswer(answer: string): Partial<Criteria> {
  const out: Partial<Criteria> = {};
  for (const raw of answer.split(/\r?\n/)) {
    const line = raw.replace(/[*_`]/g, "").replace(/^\s*(?:[-•]|\d+[.)])\s*/, "");
    const at = line.indexOf(":");
    if (at < 0) continue;
    const name = fold(line.slice(0, at).trim());
    const f = CRITERIA.find((x) => fold(x.label) === name);
    const value = clean(line.slice(at + 1)).slice(0, MAX_VALUE);
    if (!f || !value || value.startsWith("(")) continue;
    if (f.key === "tuoi") {
      const age = /\d+/.exec(value)?.[0];
      if (age && validAge(age)) out.tuoi = age;
    } else if (f.key === "khuVuc") {
      const hit = REGIONS.find((r) => fold(value).includes(fold(r)));
      if (hit) out.khuVuc = hit;
    } else if (f.key === "gioiTinh") {
      const hit = GENDERS.find((g) => fold(value) === g);
      if (hit) out.gioiTinh = hit;
    } else if (f.key === "phuKien") {
      if (!/^(none|không|khong)\.?$/i.test(value)) out.phuKien = value;
    } else out[f.key] = value;
  }
  return out;
}

// ---------- Bản nháp ----------

export const NV_KINDS = ["master", "turnaround", "face"] as const;
export type NvKind = (typeof NV_KINDS)[number];
export const isNvKind = (s: unknown): s is NvKind => NV_KINDS.includes(s as NvKind);
export const NV_KIND_TEXT: Record<NvKind, string> = { master: "Ảnh master", turnaround: "Ảnh turnaround", face: "Ảnh face" };

export const NV_BATCH_TAB = "Tạo nhân vật";

export interface NvDraft {
  id: number;
  ten: string;
  criteria: string;
  core: string;
  createdAt: string;
  /** Nhân vật đã lưu từ bản nháp này; null = chưa lưu. */
  nhanVatId: number | null;
}

export interface NvDraftFile {
  id: number;
  draftId: number;
  kind: NvKind;
  file: string;
  bytes: number;
  chosen: number;
  createdAt: string;
}

/** Dữ liệu lượt lúc bấm tạo (runs.inputSnapshot): ảnh master đính kèm; null = lượt tạo master, không kèm ảnh. */
export interface NvSnapshot {
  draftId: number;
  kind: NvKind;
  masterFile: string | null;
}

export interface NvRunInfo {
  batchId: number;
  state: string;
  error: string | null;
  museChatUrl: string | null;
}

export function addDraft(db: DB, ten: string, criteria: Criteria): number {
  const r = db.prepare("INSERT INTO nv_drafts (ten, criteria, core) VALUES (?, ?, ?)").run(ten.trim(), JSON.stringify(criteria), buildCore(criteria));
  return Number(r.lastInsertRowid);
}

export function getDraft(db: DB, id: number): NvDraft | undefined {
  return db.prepare("SELECT id, ten, criteria, core, createdAt, nhanVatId FROM nv_drafts WHERE id = ? AND deletedAt IS NULL").get(id) as NvDraft | undefined;
}

export function listDrafts(db: DB): NvDraft[] {
  return db.prepare("SELECT id, ten, criteria, core, createdAt, nhanVatId FROM nv_drafts WHERE deletedAt IS NULL ORDER BY id DESC").all() as NvDraft[];
}

export function draftFiles(db: DB, draftId: number): NvDraftFile[] {
  return db.prepare("SELECT id, draftId, kind, file, bytes, chosen, createdAt FROM nv_draft_files WHERE draftId = ? ORDER BY id").all(draftId) as NvDraftFile[];
}

export function getDraftFile(db: DB, id: number): NvDraftFile | undefined {
  return db.prepare("SELECT id, draftId, kind, file, bytes, chosen, createdAt FROM nv_draft_files WHERE id = ?").get(id) as NvDraftFile | undefined;
}

/** Ảnh đang chọn của một loại, không có thì ảnh mới nhất. */
export function chosenFile(files: NvDraftFile[], kind: NvKind): NvDraftFile | undefined {
  const list = files.filter((f) => f.kind === kind);
  return list.find((f) => f.chosen) ?? list[list.length - 1];
}

/** Gắn ảnh vừa tải vào bản nháp: ảnh đầu của lần tạo mới nhất được chọn, ảnh cũ vẫn giữ. */
export function addDraftFiles(db: DB, draftId: number, runId: number, kind: NvKind, list: { file: string; bytes: number }[]): void {
  if (!list.length) return;
  db.transaction(() => {
    db.prepare("UPDATE nv_draft_files SET chosen = 0 WHERE draftId = ? AND kind = ?").run(draftId, kind);
    const ins = db.prepare("INSERT INTO nv_draft_files (draftId, runId, kind, file, bytes, chosen) VALUES (?, ?, ?, ?, ?, ?)");
    list.forEach((f, i) => ins.run(draftId, runId, kind, f.file, f.bytes, i === 0 ? 1 : 0));
  })();
}

export function chooseDraftFile(db: DB, fileId: number): void {
  const f = getDraftFile(db, fileId);
  if (!f) return;
  db.transaction(() => {
    db.prepare("UPDATE nv_draft_files SET chosen = 0 WHERE draftId = ? AND kind = ?").run(f.draftId, f.kind);
    db.prepare("UPDATE nv_draft_files SET chosen = 1 WHERE id = ?").run(fileId);
  })();
}

/** Lượt gần nhất của từng loại ảnh trong bản nháp. */
export function draftRuns(db: DB, draftId: number): Partial<Record<NvKind, NvRunInfo>> {
  const rows = db
    .prepare("SELECT batchId, state, error, museChatUrl, json_extract(inputSnapshot, '$.kind') AS kind FROM runs WHERE nvDraftId = ? ORDER BY id")
    .all(draftId) as (NvRunInfo & { kind: NvKind })[];
  const out: Partial<Record<NvKind, NvRunInfo>> = {};
  for (const { kind, ...info } of rows) out[kind] = info;
  return out;
}

/** Bản nháp còn lượt chưa xong trong lô chưa kết thúc: chưa sửa, chưa xoá được. */
export function draftBusy(db: DB, draftId: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM runs r JOIN batches b ON b.id = r.batchId
       WHERE r.nvDraftId = ? AND b.status IN ('queued', 'running', 'paused')
         AND r.state NOT IN (${FINAL_RUN_STATES.map(() => "?").join(", ")}) LIMIT 1`,
    )
    .get(draftId, ...FINAL_RUN_STATES);
  return !!row;
}

/** Ghi lô + các lượt (queued) trong một transaction. Mỗi loại ảnh một lượt, một cuộc trò chuyện mới (D7). */
export function insertNvBatch(db: DB, draft: NvDraft, kinds: NvKind[], masterFile: string | null): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO batches (spreadsheetId, tab, driveFolderId, status, source) VALUES ('', ?, '', 'queued', 'nv')")
      .run(NV_BATCH_TAB);
    const batchId = Number(lastInsertRowid);
    const insertRun = db.prepare(
      `INSERT INTO runs (batchId, rowNumber, nvDraftId, inputSnapshot, promptSent, requestText, overwrite, state)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'queued')`,
    );
    const insertEvent = db.prepare("INSERT INTO run_events (runId, fromState, toState, message) VALUES (?, NULL, 'queued', ?)");
    for (const kind of kinds) {
      const snap: NvSnapshot = { draftId: draft.id, kind, masterFile: kind === "master" ? null : masterFile };
      const text = kind === "master" ? masterPrompt(draft.core) : kind === "turnaround" ? TURNAROUND_PROMPT : FACE_PROMPT;
      const { lastInsertRowid: runId } = insertRun.run(batchId, draft.id, draft.id, JSON.stringify(snap), `${NV_KIND_TEXT[kind]} · ${draft.ten}`, text);
      insertEvent.run(runId, `Tạo lô #${batchId}: ${NV_KIND_TEXT[kind].toLowerCase()} của nhân vật ${draft.ten}`);
    }
    return batchId;
  })();
}

export function markDraftSaved(db: DB, draftId: number, nhanVatId: number): void {
  db.prepare("UPDATE nv_drafts SET nhanVatId = ? WHERE id = ?").run(nhanVatId, draftId);
}

/** Xoá bản nháp (người dùng bấm, D26); trả các file cần xoá khỏi máy. Nhân vật đã lưu có file riêng, không ảnh hưởng. */
export function deleteDraft(db: DB, draftId: number, at = new Date().toISOString()): string[] {
  const list = draftFiles(db, draftId).map((f) => f.file);
  db.transaction(() => {
    db.prepare("DELETE FROM nv_draft_files WHERE draftId = ?").run(draftId);
    db.prepare("UPDATE nv_drafts SET deletedAt = ? WHERE id = ?").run(at, draftId);
  })();
  return list;
}
