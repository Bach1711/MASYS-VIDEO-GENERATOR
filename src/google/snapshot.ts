import { columnLetter } from "./a1.js";
import type { Grid, SheetsClient } from "./sheets.js";

/** Bản chụp toàn tab, dùng để phát hiện Muse sửa nhầm ô (spec F5 bước 2 và 6, §5.2). */
export interface TabSnapshot {
  spreadsheetId: string;
  tab: string;
  takenAt: string;
  cells: Grid;
}

export async function takeSnapshot(client: SheetsClient, spreadsheetId: string, tab: string): Promise<TabSnapshot> {
  // FORMULA để bắt cả việc đổi công thức, không chỉ đổi giá trị hiển thị.
  const cells = await client.readTab(spreadsheetId, tab, "FORMULA");
  return { spreadsheetId, tab, takenAt: new Date().toISOString(), cells };
}

export interface CellChange {
  cell: string;
  before: string;
  after: string;
}

/** Các ô khác nhau giữa hai bản chụp, theo thứ tự dòng rồi cột. Ô trống và ô không tồn tại coi như nhau. */
export function diffSnapshots(before: Grid | TabSnapshot, after: Grid | TabSnapshot): CellChange[] {
  const a = "cells" in before ? before.cells : before;
  const b = "cells" in after ? after.cells : after;
  const changes: CellChange[] = [];
  const rows = Math.max(a.length, b.length);
  for (let r = 0; r < rows; r++) {
    const ra = a[r] ?? [];
    const rb = b[r] ?? [];
    const cols = Math.max(ra.length, rb.length);
    for (let c = 0; c < cols; c++) {
      const va = ra[c] ?? "";
      const vb = rb[c] ?? "";
      if (va !== vb) changes.push({ cell: `${columnLetter(c)}${r + 1}`, before: va, after: vb });
    }
  }
  return changes;
}

/** Các thay đổi nằm ngoài danh sách ô được phép (ví dụ ô Video và ô Trạng thái dòng N). */
export function unexpectedChanges(changes: CellChange[], allowedCells: string[]): CellChange[] {
  const allowed = new Set(allowedCells);
  return changes.filter((ch) => !allowed.has(ch.cell));
}
