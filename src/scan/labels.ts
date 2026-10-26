import type { SheetConfig } from "../db/sheetConfigs.js";
import { columnIndex } from "../google/a1.js";
import { parseDriveLink } from "../google/drive.js";
import { normalizeHeader } from "../google/mapping.js";
import type { Grid } from "../google/sheets.js";

/** Nhãn F3. Thứ tự ưu tiên: Đã có video → Đang chạy → Thiếu dữ liệu → Sẵn sàng. */
export type RowLabel = "has_video" | "running" | "missing_data" | "ready";

export const LABEL_TEXT: Record<RowLabel, string> = {
  has_video: "Đã có video",
  running: "Đang chạy",
  missing_data: "Thiếu dữ liệu",
  ready: "Sẵn sàng",
};

export const STATUS_RUNNING = "Đang chạy";

/** Kết quả kiểm tra file ảnh trên Drive (bằng service account). */
export type ImageCheck = { ok: true } | { ok: false; reason: string };

export interface ScannedRow {
  row: number;
  image: string;
  prompt: string;
  video: string;
  status: string;
  imageFileId?: string;
  label: RowLabel;
  /** Lý do Thiếu dữ liệu; với dòng Đã có video thì là lý do không cho Ghi đè. */
  problems: string[];
  /** Chọn được ngay (Sẵn sàng). */
  selectable: boolean;
  /** Dòng Đã có video, dữ liệu đủ, được phép tích Ghi đè (D10). */
  canOverwrite: boolean;
}

export function isRunningStatus(status: string): boolean {
  return normalizeHeader(status) === normalizeHeader(STATUS_RUNNING);
}

/** File ID ảnh cần kiểm tra trên Drive cho một dòng (nếu link là link file Drive). */
export function imageFileIdOf(image: string): string | undefined {
  const link = parseDriveLink(image);
  return link?.kind === "file" ? link.id : undefined;
}

/**
 * Gắn nhãn mọi dòng dữ liệu phía dưới dòng tiêu đề. Dòng trống cả 4 cột bị bỏ qua.
 * `imageChecks` theo file ID; thiếu kết quả coi như chưa kiểm tra được.
 */
export function labelRows(grid: Grid, cfg: SheetConfig, imageChecks: Map<string, ImageCheck>): ScannedRow[] {
  const ci = {
    image: columnIndex(cfg.colImage),
    prompt: columnIndex(cfg.colPrompt),
    video: columnIndex(cfg.colVideo),
    status: columnIndex(cfg.colStatus),
  };
  const out: ScannedRow[] = [];
  for (let i = cfg.headerRow; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    const get = (c: number) => (cells[c] ?? "").trim();
    const image = get(ci.image);
    const prompt = get(ci.prompt);
    const video = get(ci.video);
    const status = get(ci.status);
    if (!image && !prompt && !video && !status) continue;

    const problems: string[] = [];
    let imageFileId: string | undefined;
    const link = parseDriveLink(image);
    if (!link) problems.push("Thiếu ảnh");
    else if (link.kind === "folder") problems.push("Link ảnh là thư mục, cần link tới file ảnh");
    else if (link.kind === "not_drive") problems.push("Link ảnh không phải link Google Drive");
    else {
      imageFileId = link.id;
      const check = imageChecks.get(link.id);
      if (!check) problems.push("Chưa kiểm tra được ảnh");
      else if (!check.ok) problems.push(check.reason);
    }
    if (!prompt) problems.push("Thiếu prompt");

    // Ô Video có bất kỳ nội dung nào đều coi là đã có video, để không ghi đè nhầm (D10).
    const label: RowLabel = video ? "has_video" : isRunningStatus(status) ? "running" : problems.length ? "missing_data" : "ready";
    out.push({
      row: i + 1,
      image,
      prompt,
      video,
      status,
      imageFileId,
      label,
      problems,
      selectable: label === "ready",
      canOverwrite: label === "has_video" && problems.length === 0 && !isRunningStatus(status),
    });
  }
  return out;
}
