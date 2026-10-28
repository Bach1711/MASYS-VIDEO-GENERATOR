import fs from "node:fs";

// Chuyển / xoá thư mục bản mới khi phần mềm diệt virus (Windows Defender…) đang giữ file vừa giải nén (CON-47).
// Lúc đó đổi tên thư mục báo EPERM / EACCES / EBUSY dù không ai làm gì sai: chờ một lúc là được.

const LOCKED = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);
const isLocked = (e: unknown) => LOCKED.has((e as NodeJS.ErrnoException).code ?? "");

export interface DirOps {
  rename(src: string, dest: string): void;
  copy(src: string, dest: string): void;
  remove(dir: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export const realDirOps: DirOps = {
  rename: (src, dest) => fs.renameSync(src, dest),
  copy: (src, dest) => fs.cpSync(src, dest, { recursive: true, errorOnExist: false, force: true }),
  // rm tự thử lại khi gặp EBUSY / EPERM / ENOTEMPTY (file đang bị giữ).
  remove: (dir) => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface MoveOptions {
  ops?: DirOps;
  /** Tổng thời gian chờ để đổi tên trước khi chuyển sang sao chép (mặc định 20 giây). */
  renameWaitMs?: number;
  /** Gọi khi phải chờ hoặc sao chép, để trang cập nhật báo cho người dùng. */
  onSlow?: () => void;
}

/** Xoá thư mục, không ném lỗi; trả false nếu vẫn còn bị giữ (lần sau dọn). */
export async function removeDirQuietly(dir: string, ops: DirOps = realDirOps): Promise<boolean> {
  try {
    await ops.remove(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chuyển thư mục `src` sang `dest` (cùng ổ đĩa). Bị giữ file thì chờ và thử đổi tên lại;
 * quá `renameWaitMs` thì sao chép rồi xoá thư mục tạm (xoá không được thì để lần sau dọn).
 * Lỗi thì `dest` được dọn sạch, ném lỗi tiếng Việt.
 */
export async function moveDir(src: string, dest: string, o: MoveOptions = {}): Promise<"renamed" | "copied"> {
  const ops = o.ops ?? realDirOps;
  const budget = o.renameWaitMs ?? 20_000;
  if (!(await removeDirQuietly(dest, ops))) {
    throw new Error(
      "Thư mục bản mới cũ còn bị một chương trình khác (thường là phần mềm diệt virus) giữ, chưa xoá được. Bản đang dùng giữ nguyên; chờ 1 phút rồi bấm Cập nhật lại.",
    );
  }
  let waited = 0;
  let delay = 250;
  for (;;) {
    try {
      ops.rename(src, dest);
      return "renamed";
    } catch (e) {
      if (!isLocked(e)) throw new Error(`Không chuyển được bản mới vào chỗ (${(e as NodeJS.ErrnoException).code ?? "lỗi lạ"}). Bản đang dùng giữ nguyên.`);
      if (waited >= budget) break;
      o.onSlow?.();
      await ops.sleep(delay);
      waited += delay;
      delay = Math.min(delay * 2, 4_000);
    }
  }
  // Đổi tên mãi không được: sao chép (đọc file vẫn được trong lúc phần mềm diệt virus quét).
  try {
    ops.copy(src, dest);
  } catch {
    await removeDirQuietly(dest, ops);
    throw new Error(
      "Không chép được bản mới vào chỗ vì file đang bị một chương trình khác (thường là phần mềm diệt virus) giữ. Bản đang dùng giữ nguyên; chờ 1 phút rồi bấm Cập nhật lại, hoặc cài tay bằng file zip.",
    );
  }
  await removeDirQuietly(src, ops);
  return "copied";
}
