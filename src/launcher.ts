import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { HOST } from "./config.js";
import { RESTART_EXIT_CODE, SWITCH_EXIT_CODE } from "./restart.js";
import { InstallLayout } from "./update/layout.js";
import { APP_NAME, APP_VERSION } from "./version.js";

// Mo-MASYS.bat gọi file này bằng Node đi kèm trong zip (D15):
// - tool đang chạy sẵn thì chỉ mở trình duyệt, không bật bản thứ hai;
// - cổng bị chương trình khác chiếm thì báo rõ;
// - còn lại thì chạy server, tự bật lại khi server thoát với mã RESTART_EXIT_CODE (vd. sau khi lưu khoá mới);
// - server thoát với SWITCH_EXIT_CODE (cập nhật / quay về, D16) thì launcher thoát cùng mã để Mo-MASYS.bat chạy bản mới;
// - bản vừa cập nhật (có phien-bandang-thu.txt) mà không lên trong 60 giây thì tự quay về bản cũ.

/** Thời gian chờ bản vừa cập nhật khởi động xong trước khi tự quay về. */
const TRIAL_TIMEOUT_MS = 60_000;

const port = Number(process.env.PORT ?? 4310);
const url = `http://localhost:${port}`;
const serverJs = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.js");

const say = (msg: string) => console.log(msg);
const layout = process.env.MASYS_HOME ? new InstallLayout(process.env.MASYS_HOME) : undefined;

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
  if (process.env.MASYS_SWITCHED === "1") return; // vừa đổi bản: trang cũ tự tải lại, không mở thêm tab
  if (process.env.MASYS_NO_BROWSER === "1") return; // chạy thử tự động
  spawn(process.env.ComSpec ?? "cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function waitUntilUp(timeoutMs = 30_000): Promise<boolean> {
  for (let i = 0; i < timeoutMs / 500; i++) {
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

function runServer(): { exited: Promise<number>; kill: () => void } {
  let child!: ReturnType<typeof spawn>;
  const exited = new Promise<number>((resolve) => {
    child = spawn(process.execPath, [serverJs], {
      env: { ...process.env, MASYS_LAUNCHER: "1", NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    readline.createInterface({ input: child.stdout! }).on("line", (l) => say(prettyLine(l)));
    child.on("exit", (code) => resolve(code ?? 1));
  });
  return { exited, kill: () => child.kill() };
}

/** Bản vừa cập nhật không lên được: ghi lại, trỏ về bản cũ để Mo-MASYS.bat chạy bản cũ. */
function revertTrial(previous: string) {
  layout!.recordFailedUpdate(APP_VERSION);
  layout!.setCurrent(previous);
  layout!.endTrial();
  say(`Bản v${APP_VERSION} không khởi động được. Đang quay về v${previous}…`);
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
    const { exited, kill } = runServer();
    if (first) {
      first = false;
      const trialPrevious = layout?.trialPrevious();
      const up = await Promise.race([waitUntilUp(trialPrevious ? TRIAL_TIMEOUT_MS : undefined), exited.then(() => false)]);
      if (trialPrevious) {
        if (!up) {
          kill();
          await exited;
          revertTrial(trialPrevious);
          return SWITCH_EXIT_CODE;
        }
        layout!.endTrial();
        say(`Đã chạy bản v${APP_VERSION}.`);
      }
      if (up && process.env.MASYS_SWITCHED !== "1") {
        say(`Đã mở trình duyệt ở ${url}`);
        openBrowser();
      }
    }
    const code = await exited;
    if (code === SWITCH_EXIT_CODE) {
      say("Đang chuyển phiên bản…");
      return code;
    }
    if (code !== RESTART_EXIT_CODE) {
      if (code !== 0) say(`Tool dừng do lỗi (mã ${code}). Chụp màn hình cửa sổ này gửi người phụ trách.`);
      return code;
    }
    say("Đang khởi động lại tool…");
  }
}

process.exitCode = await main();
