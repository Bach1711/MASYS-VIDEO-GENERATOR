import { describe, expect, it } from "vitest";
import { getBatch } from "../src/batch/create.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { updateBlocker } from "../src/db/history.js";
import { BatchRunner, type MuseDriver } from "../src/queue/runner.js";

// CON-79 (v2.3.1): huỷ lô đang tạm dừng khi một dòng đã gửi Muse và đang chờ → dòng đó từng kẹt "đang chờ" mãi
// và chặn nút Cập nhật phiên bản.

const noBot = { isOpen: false } as unknown as MuseDriver;

function batchWith(db: DB, status: string, states: string[]): number {
  const id = Number(
    db.prepare("INSERT INTO batches (spreadsheetId, tab, driveFolderId, status, source) VALUES ('', 'Bảng mới', '', ?, 'bang')").run(status).lastInsertRowid,
  );
  states.forEach((s, i) =>
    db
      .prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, state, sentAt) VALUES (?, ?, '{}', ?, ?)")
      .run(id, i + 1, s, s === "queued" ? null : new Date().toISOString()),
  );
  return id;
}
const states = (db: DB, batchId: number) =>
  (db.prepare("SELECT state, error FROM runs WHERE batchId = ? ORDER BY rowNumber").all(batchId) as { state: string; error: string | null }[]);

describe("huỷ lô đang tạm dừng (CON-79)", () => {
  it("dòng đã gửi Muse → Cần xem, dòng chưa gửi → Đã huỷ; không còn chặn cập nhật", () => {
    const db = openDatabase(":memory:");
    const id = batchWith(db, "paused", ["waiting", "sending", "queued", "checking_row", "done"]);
    expect(updateBlocker(db)).toBe(`Lô #${id} còn dòng đang gửi hoặc đang chờ Muse; chờ dòng đó xong.`);
    const runner = new BatchRunner(db, undefined, undefined, noBot);
    expect(runner.cancel(id)).toEqual({ ok: true, immediate: true });
    expect(getBatch(db, id)!.status).toBe("canceled");
    expect(states(db, id)).toEqual([
      { state: "needs_review", error: "lô đã huỷ khi dòng đang chờ Muse" },
      { state: "needs_review", error: "lô đã huỷ khi dòng đang chờ Muse" },
      { state: "canceled", error: null },
      { state: "canceled", error: null },
      { state: "done", error: null },
    ]);
    expect(updateBlocker(db)).toBeUndefined();
  });

  it("dữ liệu đã kẹt từ bản cũ: không chặn cập nhật, và được gỡ khi tool mở lại", () => {
    const db = openDatabase(":memory:");
    const old = batchWith(db, "canceled", ["waiting", "canceled"]);
    expect(updateBlocker(db)).toBeUndefined();
    new BatchRunner(db, undefined, undefined, noBot).recover();
    expect(states(db, old).map((r) => r.state)).toEqual(["needs_review", "canceled"]);
  });

  it("lô đang tạm dừng (chưa huỷ) vẫn chặn cập nhật như trước, để không mất video đang làm", () => {
    const db = openDatabase(":memory:");
    const id = batchWith(db, "paused", ["waiting"]);
    new BatchRunner(db, undefined, undefined, noBot).recover();
    expect(states(db, id)[0]!.state).toBe("waiting");
    expect(updateBlocker(db)).toContain(`Lô #${id}`);
  });
});
