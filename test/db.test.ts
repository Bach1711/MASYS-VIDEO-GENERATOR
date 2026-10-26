import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/index.js";
import { MIGRATIONS } from "../src/db/schema.js";

describe("SQLite schema §9", () => {
  it("có đủ 5 bảng và settings mặc định", () => {
    const db = openDatabase(":memory:");
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {
      name: string;
    }[]).map((t) => t.name);
    expect(tables.sort()).toEqual(["batches", "run_events", "runs", "settings", "sheet_configs"]);

    const s = db.prepare("SELECT * FROM settings").all() as Record<string, unknown>[];
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ dailyVideoLimit: 5, timeoutMinutes: 20, pauseMinSec: 20, pauseMaxSec: 60 });
  });

  it("migration chạy lại không lỗi và không nhân đôi settings", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT COUNT(*) n FROM settings").get()).toEqual({ n: 1 });
  });

  it("runs có đủ cột theo §9", () => {
    const db = openDatabase(":memory:");
    const cols = (db.pragma("table_info(runs)") as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "batchId", "rowNumber", "inputSnapshot", "promptSent", "requestText", "overwrite", "state",
        "error", "sentAt", "doneAt", "videoLink", "driveFileId", "museChatUrl",
      ]),
    );
  });
});
