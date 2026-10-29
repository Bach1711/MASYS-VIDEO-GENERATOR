import { columnIndex } from "../google/a1.js";
import type { DB } from "../db/index.js";
import type { SheetConfig } from "../db/sheetConfigs.js";
import { parseDriveLink, type DriveClient } from "../google/drive.js";
import type { Grid } from "../google/sheets.js";
import { describeGoogleError } from "../google/errors.js";
import { imageProblem, MAX_IMAGE_BYTES, type BangFiles } from "./files.js";
import { addRow, setSlot, SLOT_TAG, SLOT_TEXT, type Slot } from "./rows.js";

// Nhập từ Google Sheet (spec v6.0 mục 17.6): chỉ đọc sheet, tải ảnh từ link Drive về máy,
// mỗi dòng sheet thành một dòng mới trên Bảng. Không ghi gì lên sheet.

export interface ImportCandidate {
  /** Dòng N trên sheet. */
  row: number;
  key: string;
  prompt: string;
  image: string;
  shirt: string;
  hasVideo: boolean;
}

export interface ImportPlan {
  add: ImportCandidate[];
  skipped: { row: number; why: string }[];
}

export const importKey = (cfg: Pick<SheetConfig, "spreadsheetId" | "tab">, row: number) => `${cfg.spreadsheetId}|${cfg.tab}|${row}`;

/** Chọn dòng sẽ nhập: bỏ dòng trống, dòng đã nhập, dòng đã có video (trừ khi tích). */
export function planImport(grid: Grid, cfg: SheetConfig, alreadyImported: Set<string>, includeVideo: boolean): ImportPlan {
  const cell = (r: string[], col: string | null | undefined) => (col ? (r[columnIndex(col)] ?? "").trim() : "");
  const add: ImportCandidate[] = [];
  const skipped: { row: number; why: string }[] = [];
  for (let i = cfg.headerRow; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const row = i + 1;
    const c = { image: cell(r, cfg.colImage), prompt: cell(r, cfg.colPrompt), shirt: cell(r, cfg.colShirt), video: cell(r, cfg.colVideo) };
    if (!c.image && !c.prompt && !c.shirt) continue;
    const key = importKey(cfg, row);
    if (alreadyImported.has(key)) skipped.push({ row, why: "đã nhập lần trước" });
    else if (c.video && !includeVideo) skipped.push({ row, why: "đã có video" });
    else add.push({ row, key, prompt: c.prompt, image: c.image, shirt: c.shirt, hasVideo: !!c.video });
  }
  return { add, skipped };
}

export interface ImportResult {
  added: { row: number; id: number }[];
  /** Ảnh không tải được: dòng vẫn được thêm, ô ảnh để trống. */
  problems: string[];
}

/** Thêm từng dòng rồi tải ảnh của dòng đó; một ảnh lỗi không làm hỏng cả lần nhập. */
export async function runImport(db: DB, files: BangFiles, drive: DriveClient, plan: ImportPlan, clientEmail: string): Promise<ImportResult> {
  const result: ImportResult = { added: [], problems: [] };
  for (const c of plan.add) {
    const id = addRow(db, { prompt: c.prompt, importedFrom: c.key });
    result.added.push({ row: c.row, id });
    const images: [Slot, string][] = [["modelFront", c.image], ["shirtFront", c.shirt]];
    for (const [slot, link] of images) {
      if (!link) continue;
      const why = await fetchImage(drive, link, clientEmail).then(
        (data) => {
          if (typeof data === "string") return data;
          setSlot(db, id, slot, files.saveImage(`${id}-${SLOT_TAG[slot]}`, data));
          return null;
        },
        (e: unknown) => describeGoogleError(e, clientEmail),
      );
      if (why) result.problems.push(`Dòng sheet ${c.row} → dòng ${id}, ${SLOT_TEXT[slot]}: ${why}`);
    }
  }
  return result;
}

/** Ảnh tải được, hoặc lý do không dùng được. */
async function fetchImage(drive: DriveClient, link: string, clientEmail: string): Promise<Uint8Array | string> {
  const parsed = parseDriveLink(link);
  if (!parsed || parsed.kind === "not_drive") return "link không phải Google Drive";
  if (parsed.kind === "folder") return "link là thư mục, cần link tới file ảnh";
  try {
    const { data } = await drive.download(parsed.id, MAX_IMAGE_BYTES);
    return imageProblem(data) ?? data;
  } catch (e) {
    return describeGoogleError(e, clientEmail);
  }
}
