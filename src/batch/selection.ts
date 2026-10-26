import { LABEL_TEXT, type ScannedRow } from "../scan/labels.js";

export interface SelectionCheck {
  accepted: ScannedRow[];
  rejected: { row: number; why: string }[];
}

/**
 * Kiểm tra lại lựa chọn trên kết quả quét mới nhất: chỉ nhận dòng Sẵn sàng,
 * hoặc dòng Đã có video có tích Ghi đè và dữ liệu đủ (D10).
 */
export function checkSelection(scanned: ScannedRow[], rows: number[], overwrite: Set<number>): SelectionCheck {
  const byRow = new Map(scanned.map((r) => [r.row, r]));
  const accepted: ScannedRow[] = [];
  const rejected: { row: number; why: string }[] = [];
  for (const n of [...new Set(rows)].sort((a, b) => a - b)) {
    const r = byRow.get(n);
    if (!r) rejected.push({ row: n, why: "không còn dữ liệu" });
    else if (r.selectable) accepted.push(r);
    else if (r.label === "has_video" && r.canOverwrite && overwrite.has(n)) accepted.push(r);
    else rejected.push({ row: n, why: LABEL_TEXT[r.label] });
  }
  return { accepted, rejected };
}
