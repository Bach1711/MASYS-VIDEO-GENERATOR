import fs from "node:fs";
import path from "node:path";

// Bot dùng Chrome đã cài sẵn (channel "chrome"); bản zip không kèm trình duyệt (D15).
// Cùng các chỗ Playwright tìm Chrome trên Windows.
export function chromeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]]
    .filter((d): d is string => !!d)
    .map((d) => path.join(d, "Google", "Chrome", "Application", "chrome.exe"));
}

/** undefined trên hệ điều hành khác Windows (không kiểm tra được theo cách này). */
export function isChromeInstalled(env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  if (process.platform !== "win32") return undefined;
  return chromeCandidates(env).some((p) => fs.existsSync(p));
}
