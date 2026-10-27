import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Số phiên bản lấy từ package.json (D15). Cùng đường dẫn tương đối cho src/ (tsx) và dist/ (bản zip).
function readVersion(): string {
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return (JSON.parse(fs.readFileSync(file, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const APP_VERSION = readVersion();
export const APP_NAME = "MASYS Video";
