import net from "node:net";
import path from "node:path";
import type { DB } from "./index.js";
import { setMuseReady } from "./settings.js";

// Quản lý nhiều tài khoản Muse theo cơ chế Multi-Profile (CON-217).
// Mỗi tài khoản dùng một thư mục hồ sơ Chrome riêng: tài khoản 1 giữ nguyên "bot-profile" để máy nâng cấp từ bản cũ
// không mất phiên đăng nhập Muse hiện tại; các tài khoản thêm mới nằm ở "bot-profiles/acc-<id>".

export interface MuseAccount {
  id: number;
  name: string;
  profileDir: string;
  readyAt: string | null;
  quotaExhaustedAt: string | null;
  maxVideoStreams: number;
  maxImageStreams: number;
  usageText: string | null;
  usageCheckedAt: string | null;
  proxy: string | null;
  createdAt: string;
  deletedAt: string | null;
}

const MAX_NAME_LEN = 60;
const MAX_PROXY_LEN = 200;

export function accountNameProblem(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return "Chưa nhập tên tài khoản.";
  if (s.length > MAX_NAME_LEN) return `Tên tài khoản tối đa ${MAX_NAME_LEN} ký tự.`;
  return undefined;
}

/**
 * Kiểm tra và phân tích chuỗi Proxy cho Playwright (`http://host:port`, `https://host:port`, `socks5://host:port`,
 * hỗ trợ `user:pass@host:port`, `host:port` không tiền tố, và định dạng 4 phần phổ biến ở Việt Nam `host:port:user:pass`
 * hoặc `socks5://host:port:user:pass`).
 * Trả chuỗi chuẩn hoá hoặc lỗi tiếng Việt rõ ràng (CON-221, CON-222).
 */
export function parseProxyConfig(
  raw: string | null | undefined,
): { ok: true; normalized: string | null; playwright?: { server: string; username?: string; password?: string } } | { ok: false; message: string } {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, normalized: null };
  if (s.length > MAX_PROXY_LEN) return { ok: false, message: `Địa chỉ Proxy tối đa ${MAX_PROXY_LEN} ký tự.` };

  let withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
  // Hỗ trợ định dạng 4 phần của các nhà cung cấp Proxy tại Việt Nam: [scheme://]host:port:user:pass
  const colon4 = /^([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):(\d{1,5}):([^:@/\s]+):(.+)$/i.exec(withScheme);
  if (colon4) {
    const [, scheme, host, port, user, pass] = colon4;
    withScheme = `${scheme}${encodeURIComponent(user!)}:${encodeURIComponent(pass!)}@${host}:${port}`;
  }

  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return {
      ok: false,
      message: "Địa chỉ Proxy không hợp lệ (ví dụ đúng: 103.145.22.10:8080:user:pass hoặc http://user:pass@host:8080).",
    };
  }
  const proto = u.protocol.toLowerCase();
  if (proto !== "http:" && proto !== "https:" && proto !== "socks5:" && proto !== "socks4:") {
    return { ok: false, message: "Proxy chỉ hỗ trợ giao thức http://, https://, socks5:// hoặc socks4://." };
  }
  if (!u.hostname || !u.port) {
    return { ok: false, message: "Proxy cần có đủ địa chỉ máy chủ và cổng (ví dụ: 103.145.22.10:8080:user:pass hoặc http://127.0.0.1:8080)." };
  }
  const server = `${proto}//${u.hostname}:${u.port}`;
  const username = u.username ? decodeURIComponent(u.username) : undefined;
  const password = u.password ? decodeURIComponent(u.password) : undefined;
  const authPart = username ? `${encodeURIComponent(username)}${password !== undefined ? `:${encodeURIComponent(password)}` : ""}@` : "";
  const normalized = `${proto}//${authPart}${u.hostname}:${u.port}`;
  return {
    ok: true,
    normalized,
    playwright: { server, ...(username ? { username } : {}), ...(password ? { password } : {}) },
  };
}

/**
 * Kiểm tra kết nối thực tế tới máy chủ Proxy (hỗ trợ cả HTTP/HTTPS Proxy lẫn SOCKS5/SOCKS4 Proxy, kèm xác thực user/pass)
 * để biết Proxy còn sống, đúng tài khoản/mật khẩu hay đã chết trước khi mở Chrome (CON-222).
 */
export async function testProxyConnection(
  rawProxy: string | null | undefined,
  timeoutMs = 5000,
): Promise<{ ok: true; host: string; port: number; latencyMs: number; message: string } | { ok: false; message: string }> {
  const parsed = parseProxyConfig(rawProxy);
  if (!parsed.ok) return parsed;
  if (!parsed.normalized || !parsed.playwright) {
    return { ok: false, message: "Tài khoản này đang để Không proxy (chưa nhập địa chỉ Proxy để thử)." };
  }
  const u = new URL(parsed.playwright.server);
  const host = u.hostname;
  const port = Number(u.port);
  const proto = u.protocol.toLowerCase();
  const username = parsed.playwright.username;
  const password = parsed.playwright.password ?? "";
  const started = Date.now();

  return await new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    const finish = (res: { ok: true; host: string; port: number; latencyMs: number; message: string } | { ok: false; message: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(res);
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish({ ok: false, message: `Proxy ${host}:${port} quá thời gian chờ (${timeoutMs}ms) — kiểm tra lại IP/Port hoặc Proxy đã hết hạn.` }));
    socket.once("error", (err) => finish({ ok: false, message: `Không kết nối được tới Proxy ${host}:${port} (${err.message}).` }));

    socket.connect(port, host, () => {
      const latencyMs = Math.max(1, Date.now() - started);
      if (proto === "socks5:") {
        // Gửi gói chào SOCKS5 (hỗ trợ No-Auth 0x00 và User/Pass 0x02)
        const methods = username ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
        socket.once("data", (chunk) => {
          if (chunk.length < 2 || chunk[0] !== 0x05) {
            return finish({ ok: false, message: `Proxy ${host}:${port} không phản hồi đúng giao thức SOCKS5.` });
          }
          if (chunk[1] === 0xff) {
            return finish({ ok: false, message: `Proxy SOCKS5 ${host}:${port} từ chối phương thức đăng nhập (kiểm tra lại User/Pass).` });
          }
          if (chunk[1] === 0x02) {
            const uBuf = Buffer.from(username ?? "", "utf8");
            const pBuf = Buffer.from(password, "utf8");
            const authReq = Buffer.concat([Buffer.from([0x01, uBuf.length]), uBuf, Buffer.from([pBuf.length]), pBuf]);
            socket.once("data", (authRes) => {
              if (authRes.length >= 2 && authRes[1] === 0x00) {
                return finish({
                  ok: true,
                  host,
                  port,
                  latencyMs: Math.max(1, Date.now() - started),
                  message: `Proxy SOCKS5 ${host}:${port} hoạt động tốt (xác thực thành công · ${Math.max(1, Date.now() - started)}ms).`,
                });
              }
              return finish({ ok: false, message: `Proxy SOCKS5 ${host}:${port} báo sai tài khoản hoặc mật khẩu Proxy.` });
            });
            socket.write(authReq);
            return;
          }
          return finish({
            ok: true,
            host,
            port,
            latencyMs,
            message: `Proxy SOCKS5 ${host}:${port} hoạt động tốt (${latencyMs}ms).`,
          });
        });
        socket.write(methods);
        return;
      }

      if (proto === "http:" || proto === "https:") {
        // Gửi thử HTTP request nhẹ qua Proxy để kiểm tra xác thực Proxy-Authorization (407 vs 200/301/302/400/405)
        const authHeader = username
          ? `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}\r\n`
          : "";
        const req = `HEAD http://muse.ai/ HTTP/1.1\r\nHost: muse.ai\r\n${authHeader}Connection: close\r\n\r\n`;
        socket.once("data", (chunk) => {
          const firstLine = chunk.toString("latin1").split("\r\n")[0] ?? "";
          if (/\b407\b/.test(firstLine)) {
            return finish({ ok: false, message: `Proxy ${host}:${port} báo lỗi 407: cần hoặc sai tài khoản / mật khẩu Proxy.` });
          }
          if (/^HTTP\/1\.[01]\s+\d{3}/i.test(firstLine)) {
            return finish({
              ok: true,
              host,
              port,
              latencyMs: Math.max(1, Date.now() - started),
              message: `Proxy HTTP ${host}:${port} hoạt động tốt (${Math.max(1, Date.now() - started)}ms).`,
            });
          }
          return finish({
            ok: true,
            host,
            port,
            latencyMs,
            message: `Đã kết nối được tới Proxy ${host}:${port} (${latencyMs}ms).`,
          });
        });
        socket.write(req);
        return;
      }

      finish({
        ok: true,
        host,
        port,
        latencyMs,
        message: `Đã kết nối được tới Proxy ${host}:${port} (${latencyMs}ms).`,
      });
    });
  });
}

const ACCOUNT_COLS =
  "id, name, profileDir, readyAt, quotaExhaustedAt, maxVideoStreams, maxImageStreams, usageText, usageCheckedAt, proxy, createdAt, deletedAt";

export function listMuseAccounts(db: DB): MuseAccount[] {
  return db
    .prepare(`SELECT ${ACCOUNT_COLS} FROM muse_accounts WHERE deletedAt IS NULL ORDER BY id`)
    .all() as MuseAccount[];
}

export function getMuseAccount(db: DB, id: number): MuseAccount | undefined {
  return db
    .prepare(`SELECT ${ACCOUNT_COLS} FROM muse_accounts WHERE id = ? AND deletedAt IS NULL`)
    .get(id) as MuseAccount | undefined;
}

/**
 * Tài khoản Muse đang được chọn làm tài khoản chạy chính. Nếu activeAccountId bị xoá hoặc chưa đặt thì tự chọn tài khoản
 * đầu tiên còn sống; nếu bảng trống thì tự tạo lại "Tài khoản 1" trỏ vào "bot-profile".
 */
export function getActiveMuseAccount(db: DB): MuseAccount {
  const row = db.prepare("SELECT activeAccountId, museReadyAt FROM settings WHERE id = 1").get() as {
    activeAccountId: number | null;
    museReadyAt: string | null;
  };
  if (row?.activeAccountId) {
    const found = getMuseAccount(db, row.activeAccountId);
    if (found) return found;
  }
  const list = listMuseAccounts(db);
  if (list.length > 0) {
    const first = list[0]!;
    db.prepare("UPDATE settings SET activeAccountId = ?, museReadyAt = ? WHERE id = 1").run(first.id, first.readyAt);
    return first;
  }
  const info = db
    .prepare("INSERT INTO muse_accounts (name, profileDir, readyAt) VALUES ('Tài khoản 1', 'bot-profile', ?)")
    .run(row?.museReadyAt ?? null);
  const id = Number(info.lastInsertRowid);
  db.prepare("UPDATE settings SET activeAccountId = ? WHERE id = 1").run(id);
  return getMuseAccount(db, id)!;
}

/** Đường dẫn thư mục hồ sơ Chrome tuyệt đối của một tài khoản. */
export function resolveAccountProfileDir(dataDir: string, profileDir: string): string {
  return path.isAbsolute(profileDir) ? profileDir : path.join(dataDir, profileDir);
}

/** Đường dẫn thư mục hồ sơ Chrome của tài khoản đang dùng. */
export function activeProfileDir(db: DB, dataDir: string): string {
  return resolveAccountProfileDir(dataDir, getActiveMuseAccount(db).profileDir);
}

export function addMuseAccount(
  db: DB,
  rawName: string,
  rawProxy?: string,
): { ok: true; account: MuseAccount } | { ok: false; message: string } {
  const problem = accountNameProblem(rawName);
  if (problem) return { ok: false, message: problem };
  const proxyParsed = parseProxyConfig(rawProxy);
  if (!proxyParsed.ok) return proxyParsed;
  const name = rawName.trim();
  const dup = db
    .prepare("SELECT id FROM muse_accounts WHERE deletedAt IS NULL AND lower(name) = lower(?)")
    .get(name) as { id: number } | undefined;
  if (dup) return { ok: false, message: `Đã có tài khoản tên "${name}".` };
  const account = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO muse_accounts (name, profileDir, proxy) VALUES (?, '', ?)")
      .run(name, proxyParsed.normalized);
    const id = Number(info.lastInsertRowid);
    const rel = path.join("bot-profiles", `acc-${id}`);
    db.prepare("UPDATE muse_accounts SET profileDir = ? WHERE id = ?").run(rel, id);
    return getMuseAccount(db, id)!;
  })();
  return { ok: true, account };
}

export function renameMuseAccount(
  db: DB,
  id: number,
  rawName: string,
): { ok: true; account: MuseAccount } | { ok: false; message: string } {
  const acc = getMuseAccount(db, id);
  if (!acc) return { ok: false, message: "Không tìm thấy tài khoản này." };
  const problem = accountNameProblem(rawName);
  if (problem) return { ok: false, message: problem };
  const name = rawName.trim();
  const dup = db
    .prepare("SELECT id FROM muse_accounts WHERE deletedAt IS NULL AND lower(name) = lower(?) AND id != ?")
    .get(name, id) as { id: number } | undefined;
  if (dup) return { ok: false, message: `Đã có tài khoản tên "${name}".` };
  db.prepare("UPDATE muse_accounts SET name = ? WHERE id = ?").run(name, id);
  return { ok: true, account: getMuseAccount(db, id)! };
}

export function setActiveMuseAccount(db: DB, id: number): { ok: true; account: MuseAccount } | { ok: false; message: string } {
  const acc = getMuseAccount(db, id);
  if (!acc) return { ok: false, message: "Không tìm thấy tài khoản này." };
  db.prepare("UPDATE settings SET activeAccountId = ?, museReadyAt = ? WHERE id = 1").run(acc.id, acc.readyAt);
  return { ok: true, account: acc };
}

export function deleteMuseAccount(
  db: DB,
  id: number,
): { ok: true; removed: MuseAccount; switchedTo?: MuseAccount } | { ok: false; message: string } {
  const acc = getMuseAccount(db, id);
  if (!acc) return { ok: false, message: "Không tìm thấy tài khoản này." };
  const list = listMuseAccounts(db);
  if (list.length <= 1) return { ok: false, message: "Phải giữ lại ít nhất 1 tài khoản Muse." };
  const active = getActiveMuseAccount(db);
  let switchedTo: MuseAccount | undefined;
  db.transaction(() => {
    db.prepare("UPDATE muse_accounts SET deletedAt = ? WHERE id = ?").run(new Date().toISOString(), id);
    if (active.id === id) {
      const next = listMuseAccounts(db)[0]!;
      db.prepare("UPDATE settings SET activeAccountId = ?, museReadyAt = ? WHERE id = 1").run(next.id, next.readyAt);
      switchedTo = next;
    }
  })();
  return { ok: true, removed: acc, switchedTo };
}

/** Ghi nhớ trạng thái đã đăng nhập của tài khoản đang dùng (hoặc tài khoản chỉ định). */
export function setAccountReady(db: DB, at: string | null, accountId?: number): void {
  const active = getActiveMuseAccount(db);
  const id = accountId ?? active.id;
  db.prepare("UPDATE muse_accounts SET readyAt = ? WHERE id = ?").run(at, id);
  if (id === active.id) setMuseReady(db, at);
}

/** Đánh dấu hoặc gỡ đánh dấu tài khoản hết token. */
export function setAccountQuotaExhausted(db: DB, at: string | null, accountId?: number): void {
  const id = accountId ?? getActiveMuseAccount(db).id;
  db.prepare("UPDATE muse_accounts SET quotaExhaustedAt = ? WHERE id = ?").run(at, id);
}

/** Cập nhật số luồng video (1–6) và số luồng ảnh (1–6) của một tài khoản Muse (CON-220). */
export function setAccountStreams(
  db: DB,
  id: number,
  maxVideoStreams: number,
  maxImageStreams: number,
): { ok: true; account: MuseAccount } | { ok: false; message: string } {
  const acc = getMuseAccount(db, id);
  if (!acc) return { ok: false, message: "Không tìm thấy tài khoản này." };
  const v = Math.min(6, Math.max(1, Math.floor(maxVideoStreams) || 3));
  const img = Math.min(6, Math.max(1, Math.floor(maxImageStreams) || 2));
  db.prepare("UPDATE muse_accounts SET maxVideoStreams = ?, maxImageStreams = ? WHERE id = ?").run(v, img, id);
  return { ok: true, account: getMuseAccount(db, id)! };
}

/** Cập nhật thông tin hạn mức / % token còn lại đọc được từ trang Muse (CON-221). */
export function setAccountUsage(db: DB, usageText: string | null, accountId?: number): void {
  const id = accountId ?? getActiveMuseAccount(db).id;
  const now = usageText ? new Date().toISOString() : null;
  db.prepare("UPDATE muse_accounts SET usageText = ?, usageCheckedAt = ? WHERE id = ?").run(usageText, now, id);
}

/** Cập nhật cấu hình Proxy riêng cho một tài khoản Muse (CON-221). Chuỗi rỗng = xoá Proxy (Không proxy). */
export function setAccountProxy(
  db: DB,
  id: number,
  rawProxy: string,
): { ok: true; account: MuseAccount } | { ok: false; message: string } {
  const acc = getMuseAccount(db, id);
  if (!acc) return { ok: false, message: "Không tìm thấy tài khoản này." };
  const parsed = parseProxyConfig(rawProxy);
  if (!parsed.ok) return parsed;
  db.prepare("UPDATE muse_accounts SET proxy = ? WHERE id = ?").run(parsed.normalized, id);
  return { ok: true, account: getMuseAccount(db, id)! };
}

/**
 * Tìm tài khoản Muse tiếp theo chưa bị báo hết token (CON-218).
 * Tìm theo vòng tròn bắt đầu từ tài khoản có `id > fromId`, rồi quay lại từ đầu danh sách.
 * Nếu chỉ có 1 tài khoản hoặc mọi tài khoản khác đều đã hết token thì trả `undefined`.
 */
export function findNextAvailableAccount(db: DB, fromId?: number): MuseAccount | undefined {
  const curId = fromId ?? getActiveMuseAccount(db).id;
  const list = listMuseAccounts(db).filter((a) => a.id !== curId && !a.quotaExhaustedAt);
  if (!list.length) return undefined;
  return list.find((a) => a.id > curId) ?? list[0];
}

