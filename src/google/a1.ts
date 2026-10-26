// Ký hiệu A1 và link Google Sheet. Dòng N luôn là số dòng hiển thị trong sheet (bắt đầu từ 1).

const SHEET_URL = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/;
const BARE_ID = /^[A-Za-z0-9_-]{20,}$/;

/** Lấy spreadsheetId từ link sheet hoặc từ chính ID. Trả về null nếu không nhận ra. */
export function parseSpreadsheetId(input: string): string | null {
  const s = input.trim();
  const m = SHEET_URL.exec(s);
  if (m) return m[1]!;
  return BARE_ID.test(s) ? s : null;
}

export function isColumn(col: string): boolean {
  return /^[A-Z]{1,3}$/.test(col);
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function columnIndex(col: string): number {
  if (!isColumn(col)) throw new Error(`Cột không hợp lệ: ${col}`);
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 → "A", 26 → "AA". */
export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`Chỉ số cột không hợp lệ: ${index}`);
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Tên tab luôn đặt trong nháy đơn; nháy đơn bên trong nhân đôi. */
export function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

export function assertRow(row: number): void {
  if (!Number.isInteger(row) || row < 1) throw new Error(`Số dòng không hợp lệ: ${row}`);
}

export function cellRange(tab: string, col: string, row: number): string {
  columnIndex(col);
  assertRow(row);
  return `${quoteTab(tab)}!${col}${row}`;
}

export function rowRange(tab: string, row: number): string {
  assertRow(row);
  return `${quoteTab(tab)}!${row}:${row}`;
}
