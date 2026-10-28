import type { SheetConfig } from "../db/sheetConfigs.js";
import { columnIndex } from "../google/a1.js";
import type { DriveClient, DriveFile } from "../google/drive.js";
import { GoogleApiError } from "../google/http.js";
import type { SheetsClient } from "../google/sheets.js";
import { imageFileIdOf, labelRows, type ImageCheck, type ScannedRow } from "./labels.js";

export interface ScanResult {
  scannedAt: string;
  rows: ScannedRow[];
  /** File ảnh đã kiểm tra được, để phục vụ ảnh thu nhỏ. */
  images: DriveFile[];
}

const CONCURRENCY = 5;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function checkImageFile(file: DriveFile): ImageCheck {
  if (file.trashed) return { ok: false, reason: "Ảnh đã nằm trong thùng rác Drive" };
  if (!file.mimeType.startsWith("image/")) return { ok: false, reason: `File không phải ảnh (${file.mimeType})` };
  return { ok: true };
}

function describeDriveError(e: unknown): string {
  if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
    return "Không mở được ảnh: chưa chia sẻ cho service account hoặc đã bị xoá";
  }
  return `Không kiểm tra được ảnh: ${(e as Error).message}`;
}

/** F3: đọc toàn tab, kiểm tra từng file ảnh (người mẫu và ảnh áo) trên Drive (D14), gắn nhãn từng dòng. */
export async function scanTab(sheets: SheetsClient, drive: DriveClient, cfg: SheetConfig): Promise<ScanResult> {
  const grid = await sheets.readTab(cfg.spreadsheetId, cfg.tab);
  const imageCols = [cfg.colImage, cfg.colShirt].filter((c): c is string => !!c).map(columnIndex);
  const ids = new Set<string>();
  for (let i = cfg.headerRow; i < grid.length; i++) {
    for (const col of imageCols) {
      const id = imageFileIdOf((grid[i]?.[col] ?? "").trim());
      if (id) ids.add(id);
    }
  }

  const checks = new Map<string, ImageCheck>();
  const images: DriveFile[] = [];
  await mapLimit([...ids], CONCURRENCY, async (id) => {
    try {
      const file = await drive.getFile(id);
      const check = checkImageFile(file);
      checks.set(id, check);
      if (check.ok) images.push(file);
    } catch (e) {
      checks.set(id, { ok: false, reason: describeDriveError(e) });
    }
  });

  return { scannedAt: new Date().toISOString(), rows: labelRows(grid, cfg, checks), images };
}

