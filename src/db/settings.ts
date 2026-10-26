import type { DB } from "./index.js";

/** Bảng settings §9 (một dòng). */
export interface Settings {
  driveRootFolderId: string | null;
  timeoutMinutes: number;
  pauseMinSec: number;
  pauseMaxSec: number;
  dailyVideoLimit: number;
  museUrl: string | null;
  /** null = dùng mẫu mặc định §8.2. */
  requestTemplate: string | null;
}

export function getSettings(db: DB): Settings {
  return db
    .prepare(
      "SELECT driveRootFolderId, timeoutMinutes, pauseMinSec, pauseMaxSec, dailyVideoLimit, museUrl, requestTemplate FROM settings WHERE id = 1",
    )
    .get() as Settings;
}

export function setDriveRootFolder(db: DB, folderId: string | null): void {
  db.prepare("UPDATE settings SET driveRootFolderId = ? WHERE id = 1").run(folderId);
}

export function setRequestTemplate(db: DB, template: string | null): void {
  db.prepare("UPDATE settings SET requestTemplate = ? WHERE id = 1").run(template);
}
