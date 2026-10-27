import os from "node:os";
import path from "node:path";

// Spec §10: giao diện chỉ nghe 127.0.0.1. Cố định trong code, không đọc từ env.
export const HOST = "127.0.0.1";

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

// `credentials` chỉ để đưa vào src/google/auth.ts; tên trường khớp bộ che của logger.
export type ServiceAccountStatus =
  | { ok: true; clientEmail: string; credentials: ServiceAccountCredentials }
  | { ok: false; problem: string };

export interface AppConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  /** Hồ sơ Chrome của bot: giữ phiên đăng nhập Muse, coi như bí mật (spec §10). */
  botProfileDir: string;
  screenshotDir: string;
  serviceAccount: ServiceAccountStatus;
  /** Khoá lấy từ đâu (D15): biến môi trường (op run), file đã mã hoá DPAPI, hay chưa có. */
  keySource: KeySource;
}

export type KeySource = "env" | "file" | "none";

export const NO_KEY_PROBLEM = "Chưa cài khoá Google. Mở trang Cài khoá Google và chọn file khoá .json do người phụ trách gửi.";

const RUN_HINT = "Chạy tool bằng: op run --env-file=.env -- npm run dev";

/**
 * Kiểm tra khoá service account (D5) mà không bao giờ trả về hay in nội dung khoá.
 * Chỉ giữ lại email service account để hiển thị hướng dẫn chia sẻ sheet.
 */
export function checkServiceAccount(raw: string | undefined, from: "env" | "file" = "env"): ServiceAccountStatus {
  if (from === "file") return checkKeyFile(raw ?? "");
  if (raw === undefined || raw.trim() === "") {
    return { ok: false, problem: `Thiếu biến GOOGLE_SERVICE_ACCOUNT_JSON. ${RUN_HINT}` };
  }
  if (raw.trim().startsWith("op://")) {
    return {
      ok: false,
      problem: `GOOGLE_SERVICE_ACCOUNT_JSON vẫn là địa chỉ op://, chưa được 1Password giải mã. ${RUN_HINT}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: "GOOGLE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ. Kiểm tra lại item trong 1Password." };
  }
  const sa = parsed as Record<string, unknown>;
  if (sa?.type !== "service_account" || typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    return {
      ok: false,
      problem: "GOOGLE_SERVICE_ACCOUNT_JSON không phải khoá service account (thiếu type/client_email/private_key).",
    };
  }
  return {
    ok: true,
    clientEmail: sa.client_email,
    credentials: { client_email: sa.client_email, private_key: sa.private_key },
  };
}

/** Kiểm tra file khoá người dùng chọn ở trang Cài khoá Google; lời báo nói về file, không nói về 1Password. */
function checkKeyFile(raw: string): ServiceAccountStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim() /* trim() bỏ cả BOM đầu file */);
  } catch {
    return { ok: false, problem: "File đã chọn không phải file khoá .json hợp lệ." };
  }
  const sa = parsed as Record<string, unknown>;
  if (sa?.type !== "service_account" || typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    return { ok: false, problem: "File đã chọn không phải khoá service account Google (thiếu type/client_email/private_key)." };
  }
  return {
    ok: true,
    clientEmail: sa.client_email,
    credentials: { client_email: sa.client_email, private_key: sa.private_key },
  };
}

/** Thư mục dữ liệu nằm ngoài repo: %LOCALAPPDATA%\masys-video (spec §8.3, §9). */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MASYS_DATA_DIR) return path.resolve(env.MASYS_DATA_DIR);
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "masys-video");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 4310);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT không hợp lệ: ${env.PORT}`);
  }
  const dataDir = resolveDataDir(env);
  return {
    port,
    dataDir,
    dbPath: path.join(dataDir, "data.db"),
    botProfileDir: path.join(dataDir, "bot-profile"),
    screenshotDir: path.join(dataDir, "screenshots"),
    // Biến môi trường (op run) luôn được ưu tiên; không có thì server.ts nạp file khoá đã mã hoá (D15).
    ...(env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
      ? { serviceAccount: checkServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON), keySource: "env" as const }
      : { serviceAccount: { ok: false as const, problem: NO_KEY_PROBLEM }, keySource: "none" as const }),
  };
}
