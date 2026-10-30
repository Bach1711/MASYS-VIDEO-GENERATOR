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
  /** Đoạn ghép áo (v4.4); null = dùng đoạn mặc định §8.2. */
  shirtTemplate: string | null;
  /** Lần gần nhất thấy Muse đã đăng nhập (CON-51); null = chưa biết hoặc vừa cần đăng nhập lại. */
  museReadyAt: string | null;
  /** Mẫu yêu cầu của Bảng mới (spec v6.0 mục 17.4): thường, đoạn ghép áo, hai mặt; null = mặc định. */
  bangTemplate: string | null;
  bangShirtTemplate: string | null;
  twoSidedTemplate: string | null;
  /** Số video chờ Muse cùng lúc ở Bảng (D28): 1 = lần lượt từng dòng như trước. */
  parallelVideos: number;
}

export function getSettings(db: DB): Settings {
  return db
    .prepare(
      "SELECT driveRootFolderId, timeoutMinutes, pauseMinSec, pauseMaxSec, dailyVideoLimit, museUrl, requestTemplate, shirtTemplate, museReadyAt, bangTemplate, bangShirtTemplate, twoSidedTemplate, parallelVideos FROM settings WHERE id = 1",
    )
    .get() as Settings;
}

/** Ghi nhớ Muse đã đăng nhập (lúc `at`), hoặc quên đi (null) khi Muse đòi đăng nhập lại. */
export function setMuseReady(db: DB, at: string | null): void {
  db.prepare("UPDATE settings SET museReadyAt = ? WHERE id = 1").run(at);
}

/** Sau một lần xem trang Muse: sẵn sàng thì nhớ, cần đăng nhập / kiểm tra bảo mật thì quên; trạng thái khác giữ nguyên. */
export function rememberMuseCheck(db: DB, state: string): void {
  if (state === "ready") setMuseReady(db, new Date().toISOString());
  else if (state === "login" || state === "challenge") setMuseReady(db, null);
}

export function setDriveRootFolder(db: DB, folderId: string | null): void {
  db.prepare("UPDATE settings SET driveRootFolderId = ? WHERE id = 1").run(folderId);
}

export function setRequestTemplate(db: DB, template: string | null): void {
  db.prepare("UPDATE settings SET requestTemplate = ? WHERE id = 1").run(template);
}

export function setShirtTemplate(db: DB, template: string | null): void {
  db.prepare("UPDATE settings SET shirtTemplate = ? WHERE id = 1").run(template);
}

export type BangTemplateKind = "bangTemplate" | "bangShirtTemplate" | "twoSidedTemplate";

export function setBangTemplate(db: DB, kind: BangTemplateKind, template: string | null): void {
  db.prepare(`UPDATE settings SET ${kind} = ? WHERE id = 1`).run(template);
}

/** Các cài đặt chạy lô của trang Cài đặt (F7). */
export type RunSettings = Pick<Settings, "timeoutMinutes" | "pauseMinSec" | "pauseMaxSec" | "dailyVideoLimit" | "museUrl" | "parallelVideos">;

/** Giới hạn ngày mặc định (D25, v6.0; trước là 5 theo D13) và mức cao nhất cho đặt. */
export const DEFAULT_DAILY_LIMIT = 100;
export const MAX_DAILY_LIMIT = 150;
/** Đặt cao hơn mức này thì trang Cài đặt nhắc rủi ro hạn mức / tài khoản Muse (17.9). */
export const RECOMMENDED_DAILY_LIMIT = 50;
/** Số video chạy cùng lúc (D28): mặc định và mức cao nhất. */
export const DEFAULT_PARALLEL_VIDEOS = 3;
export const MAX_PARALLEL_VIDEOS = 6;

const int = (v: unknown) => (typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN);

/** Đọc và kiểm tra form Cài đặt. museUrl trống = dùng trang Muse mặc định. */
export function parseRunSettings(form: Record<string, unknown>): { ok: true; value: RunSettings } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const timeoutMinutes = int(form.timeoutMinutes);
  const pauseMinSec = int(form.pauseMinSec);
  const pauseMaxSec = int(form.pauseMaxSec);
  const dailyVideoLimit = int(form.dailyVideoLimit);
  // Form cũ không có ô này: giữ mặc định.
  const parallelVideos = form.parallelVideos === undefined ? DEFAULT_PARALLEL_VIDEOS : int(form.parallelVideos);
  if (!(timeoutMinutes >= 1 && timeoutMinutes <= 120)) errors.push("Thời gian chờ phải là số phút từ 1 đến 120.");
  if (!(pauseMinSec >= 0 && pauseMinSec <= 600)) errors.push("Nghỉ ít nhất phải là số giây từ 0 đến 600.");
  if (!(pauseMaxSec >= 0 && pauseMaxSec <= 600)) errors.push("Nghỉ nhiều nhất phải là số giây từ 0 đến 600.");
  else if (pauseMaxSec < pauseMinSec) errors.push("Nghỉ nhiều nhất phải lớn hơn hoặc bằng nghỉ ít nhất.");
  if (!(dailyVideoLimit >= 1 && dailyVideoLimit <= MAX_DAILY_LIMIT)) errors.push(`Giới hạn video mỗi ngày phải là số từ 1 đến ${MAX_DAILY_LIMIT}.`);
  if (!(parallelVideos >= 1 && parallelVideos <= MAX_PARALLEL_VIDEOS)) errors.push(`Số video chạy cùng lúc phải là số từ 1 đến ${MAX_PARALLEL_VIDEOS}.`);

  let museUrl: string | null = null;
  const rawUrl = String(form.museUrl ?? "").trim();
  if (rawUrl) {
    let u: URL | undefined;
    try {
      u = new URL(rawUrl);
    } catch {
      /* báo lỗi bên dưới */
    }
    if (!u || u.protocol !== "https:" || !(u.hostname === "muse.ai" || u.hostname.endsWith(".muse.ai"))) {
      errors.push("Địa chỉ trang Muse phải bắt đầu bằng https:// và thuộc muse.ai.");
    } else museUrl = u.href;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { timeoutMinutes, pauseMinSec, pauseMaxSec, dailyVideoLimit, museUrl, parallelVideos } };
}

export function saveRunSettings(db: DB, s: RunSettings): void {
  db.prepare(
    "UPDATE settings SET timeoutMinutes = ?, pauseMinSec = ?, pauseMaxSec = ?, dailyVideoLimit = ?, museUrl = ?, parallelVideos = ? WHERE id = 1",
  ).run(s.timeoutMinutes, s.pauseMinSec, s.pauseMaxSec, s.dailyVideoLimit, s.museUrl, s.parallelVideos);
}
