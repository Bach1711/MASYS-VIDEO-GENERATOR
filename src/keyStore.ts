import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkServiceAccount, type AppConfig } from "./config.js";

// Khoá Google trên máy người dùng (D15): mã hoá bằng Windows DPAPI theo tài khoản Windows đang đăng nhập.
// File copy sang máy hoặc tài khoản khác thì không giải mã được. Nội dung khoá chỉ đi qua stdin/stdout của
// PowerShell, không bao giờ nằm trên dòng lệnh, trong log hay SQLite.

export const KEY_FILE_NAME = "google-key.dpapi";

/** Hai thao tác mã hoá/giải mã; test thay bằng bản giả để chạy không cần Windows. */
export interface Protector {
  protect(plain: string): Promise<Buffer>;
  unprotect(data: Buffer): Promise<string>;
}

// Entropy cố định: thêm một lớp để chương trình khác cùng tài khoản không giải mã nhầm bằng lời gọi mặc định.
const ENTROPY = "masys-video/google-key/v1";

// Đường dẫn đầy đủ: không phụ thuộc PATH của máy người dùng.
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function powershell(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      POWERSHELL,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => (err ? reject(new Error("Không mã hoá/giải mã được khoá bằng Windows DPAPI.")) : resolve(stdout.trim())),
    );
    child.stdin?.end(input);
  });
}

const PS_PREFIX =
  "Add-Type -AssemblyName System.Security; " +
  `$e = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}'); ` +
  "$in = [Console]::In.ReadToEnd().Trim(); ";

export const dpapi: Protector = {
  async protect(plain) {
    // Đưa base64 qua stdin để không vướng mã hoá ký tự của console.
    const out = await powershell(
      PS_PREFIX +
        "$b = [Convert]::FromBase64String($in); " +
        "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $e, 'CurrentUser'))",
      Buffer.from(plain, "utf8").toString("base64"),
    );
    return Buffer.from(out, "base64");
  },
  async unprotect(data) {
    const out = await powershell(
      PS_PREFIX +
        "$b = [Convert]::FromBase64String($in); " +
        "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b, $e, 'CurrentUser'))",
      data.toString("base64"),
    );
    return Buffer.from(out, "base64").toString("utf8");
  },
};

export class KeyStore {
  readonly file: string;
  constructor(
    dataDir: string,
    private readonly protector: Protector = dpapi,
  ) {
    this.file = path.join(dataDir, KEY_FILE_NAME);
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  /** Nội dung khoá JSON, hoặc undefined nếu chưa cài. Lỗi giải mã (file từ máy khác) thì ném lỗi. */
  async load(): Promise<string | undefined> {
    if (!this.exists()) return undefined;
    return this.protector.unprotect(fs.readFileSync(this.file));
  }

  /** Ghi qua file tạm rồi đổi tên: tắt máy giữa chừng không để lại khoá hỏng. */
  async save(json: string): Promise<void> {
    const data = await this.protector.protect(json);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, this.file);
  }
}

export const UNREADABLE_KEY_PROBLEM =
  "File khoá đã lưu không mở được trên tài khoản Windows này (có thể được chép từ máy khác). Chọn lại file khoá .json.";

/** Không có biến môi trường thì nạp khoá đã mã hoá (D15). Không bao giờ ném lỗi: tool vẫn mở được trang Cài khoá. */
export async function applyStoredKey(config: AppConfig, store: KeyStore): Promise<void> {
  if (config.keySource === "env" || !store.exists()) return;
  try {
    const status = checkServiceAccount(await store.load(), "file");
    config.serviceAccount = status;
    if (status.ok) config.keySource = "file";
  } catch {
    config.serviceAccount = { ok: false, problem: UNREADABLE_KEY_PROBLEM };
  }
}

/** Chỉ giữ các trường cần để xác thực và để check-secrets so nguyên văn; bỏ phần còn lại của file Google. */
export function minimalKeyJson(raw: string): string {
  const sa = JSON.parse(raw.trim() /* trim() bỏ cả BOM đầu file */) as Record<string, unknown>;
  const { type, project_id, private_key_id, private_key, client_email } = sa;
  return JSON.stringify({ type, project_id, private_key_id, private_key, client_email });
}
