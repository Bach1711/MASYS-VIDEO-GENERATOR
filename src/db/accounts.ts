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
  createdAt: string;
  deletedAt: string | null;
}

const MAX_NAME_LEN = 60;

export function accountNameProblem(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return "Chưa nhập tên tài khoản.";
  if (s.length > MAX_NAME_LEN) return `Tên tài khoản tối đa ${MAX_NAME_LEN} ký tự.`;
  return undefined;
}

export function listMuseAccounts(db: DB): MuseAccount[] {
  return db
    .prepare(
      "SELECT id, name, profileDir, readyAt, quotaExhaustedAt, createdAt, deletedAt FROM muse_accounts WHERE deletedAt IS NULL ORDER BY id",
    )
    .all() as MuseAccount[];
}

export function getMuseAccount(db: DB, id: number): MuseAccount | undefined {
  return db
    .prepare(
      "SELECT id, name, profileDir, readyAt, quotaExhaustedAt, createdAt, deletedAt FROM muse_accounts WHERE id = ? AND deletedAt IS NULL",
    )
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

export function addMuseAccount(db: DB, rawName: string): { ok: true; account: MuseAccount } | { ok: false; message: string } {
  const problem = accountNameProblem(rawName);
  if (problem) return { ok: false, message: problem };
  const name = rawName.trim();
  const dup = db
    .prepare("SELECT id FROM muse_accounts WHERE deletedAt IS NULL AND lower(name) = lower(?)")
    .get(name) as { id: number } | undefined;
  if (dup) return { ok: false, message: `Đã có tài khoản tên "${name}".` };
  const account = db.transaction(() => {
    const info = db.prepare("INSERT INTO muse_accounts (name, profileDir) VALUES (?, '')").run(name);
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

