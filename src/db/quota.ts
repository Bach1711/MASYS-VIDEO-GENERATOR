import type { DB } from "./index.js";

/** Nửa đêm hôm nay và hôm sau theo giờ máy, dạng ISO UTC (cùng định dạng runs.sentAt). */
export function localDayBounds(now: Date): { start: string; end: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export interface DailyQuota {
  used: number;
  limit: number;
  remaining: number;
}

/**
 * D13: đếm các lượt đã gửi Muse trong ngày theo giờ máy, kể cả lượt lỗi
 * (mọi run có sentAt; sentAt ghi bằng Date.toISOString()).
 */
export function getDailyQuota(db: DB, now = new Date()): DailyQuota {
  const { start, end } = localDayBounds(now);
  // Lượt của Bảng ảnh (CON-77, D31) đếm riêng, không trừ vào giới hạn video.
  const { used } = db
    .prepare("SELECT COUNT(*) AS used FROM runs WHERE sentAt IS NOT NULL AND sentAt >= ? AND sentAt < ? AND anhRowId IS NULL")
    .get(start, end) as { used: number };
  const { dailyVideoLimit: limit } = db.prepare("SELECT dailyVideoLimit FROM settings WHERE id = 1").get() as {
    dailyVideoLimit: number;
  };
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Giới hạn ảnh mỗi ngày của Bảng ảnh (CON-77, D31): mỗi lần gửi Muse một tin xin ảnh là một lượt, kể cả tin xin ảnh
 * quay lưng (anhBackAt) và lượt lỗi. Đếm riêng với video.
 */
export function getImageQuota(db: DB, now = new Date()): DailyQuota {
  const { start, end } = localDayBounds(now);
  const { used } = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM runs WHERE anhRowId IS NOT NULL AND sentAt IS NOT NULL AND sentAt >= @start AND sentAt < @end)
            + (SELECT COUNT(*) FROM runs WHERE anhRowId IS NOT NULL AND anhBackAt IS NOT NULL AND anhBackAt >= @start AND anhBackAt < @end) AS used`,
    )
    .get({ start, end }) as { used: number };
  const { dailyImageLimit: limit } = db.prepare("SELECT dailyImageLimit FROM settings WHERE id = 1").get() as { dailyImageLimit: number };
  return { used, limit, remaining: Math.max(0, limit - used) };
}
