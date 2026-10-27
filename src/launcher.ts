import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { HOST } from "./config.js";
import { RESTART_EXIT_CODE } from "./restart.js";
import { APP_NAME, APP_VERSION } from "./version.js";

// Mo-MASYS.bat gọi file này bằng Node đi kèm trong zip (D15):
// - tool đang chạy sẵn thì chỉ mở trình duyệt, không bật bản thứ hai;
// - cổng bị chương trình khác chiếm thì báo rõ;
// - còn lại thì chạy server, tự bật lại khi server thoát với mã RESTART_EXIT_CODE (vd. sau khi lưu khoá mới).

const port = Number(process.env.PORT ?? 4310);
const url = `http://localhost:${port}`;
const serverJs = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.js");

const say = (msg: string) => console.log(msg);

function portOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: HOST, port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(1500, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/** true nếu cổng đang là MASYS Video (trả /health đúng dạng). */
async function isOurTool(): Promise<boolean> {
  try {
    const r = await fetch(`http://${HOST}:${port}/health`, { signal: AbortSignal.timeout(2000) });
    const body = (await r.json()) as { app?: string };
    return body.app === "masys-video";
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.env.MASYS_NO_BROWSER === "1") return; // chạy thử tự động
  spawn(process.env.ComSpec ?? "cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function waitUntilUp(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    if (await isOurTool()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const LEVEL: Record<number, string> = { 40: "Chú ý: ", 50: "LỖI: ", 60: "LỖI NẶNG: " };

/** Đổi dòng log JSON (pino) thành một dòng dễ đọc trên cửa sổ đen. */
function prettyLine(line: string): string {
  try {
    const o = JSON.parse(line) as { level?: number; time?: number; msg?: string; err?: { message?: string } };
    const time = new Date(o.time ?? Date.now()).toLocaleTimeString("vi-VN", { hour12: false });
    const extra = o.err?.message ? ` (${o.err.message})` : "";
    return `${time}  ${LEVEL[o.level ?? 30] ?? ""}${o.msg ?? ""}${extra}`;
  } catch {
    return line;
  }
}

function runServer(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverJs], {
      env: { ...process.env, MASYS_LAUNCHER: "1", NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    readline.createInterface({ input: child.stdout! }).on("line", (l) => say(prettyLine(l)));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  say(`${APP_NAME} v${APP_VERSION}`);
  say("Đừng đóng cửa sổ này khi đang dùng tool. Muốn tắt tool thì đóng cửa sổ này (hoặc bấm Ctrl+C).");
  say("");

  if (await portOpen()) {
    if (await isOurTool()) {
      say(`Tool đã đang chạy. Mở trình duyệt ở ${url}`);
      openBrowser();
      return 0;
    }
    say(`Cổng ${port} đang bị một chương trình khác dùng nên không bật được tool.`);
    say("Tắt chương trình đó (hoặc khởi động lại máy) rồi bấm đúp Mo-MASYS.bat lần nữa.");
    return 1;
  }

  // Ctrl+C gửi tới cả server; launcher đợi server tắt sạch rồi mới thoát.
  process.on("SIGINT", () => {});

  let first = true;
  for (;;) {
    const exited = runServer();
    if (first) {
      first = false;
      const up = await Promise.race([waitUntilUp(), exited.then(() => false)]);
      if (up) {
        say(`Đã mở trình duyệt ở ${url}`);
        openBrowser();
      }
    }
    const code = await exited;
    if (code !== RESTART_EXIT_CODE) {
      if (code !== 0) say(`Tool dừng do lỗi (mã ${code}). Chụp màn hình cửa sổ này gửi người phụ trách.`);
      return code;
    }
    say("Đang khởi động lại tool…");
  }
}

process.exitCode = await main();
