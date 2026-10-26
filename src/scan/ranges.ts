/**
 * Đọc chuỗi chọn dòng kiểu "2-5, 8" (F3). Trả về các dòng đã sắp xếp, không trùng, và các phần gõ sai.
 * Hàm tự chứa (không import) vì trang Quét nhúng nguyên mã của nó vào trình duyệt.
 */
export function parseRowRanges(input: string): { rows: number[]; errors: string[] } {
  const MAX_SPAN = 5000;
  const rows = new Set<number>();
  const errors: string[] = [];
  for (const part of input.replace(/\s*[-–]\s*/g, "-").split(/[,;\s]+/)) {
    if (!part) continue;
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) {
      errors.push(part);
      continue;
    }
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < a || b - a > MAX_SPAN) {
      errors.push(part);
      continue;
    }
    for (let r = a; r <= b; r++) rows.add(r);
  }
  return { rows: [...rows].sort((x, y) => x - y), errors };
}
