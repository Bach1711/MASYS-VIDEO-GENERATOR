import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type DirOps, moveDir, realDirOps } from "../src/update/moveDir.js";

// Chuyển thư mục bản mới khi phần mềm diệt virus giữ file (CON-47).

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "masys-move-"));
const locked = (code = "EPERM") => Object.assign(new Error(`${code}: operation not permitted`), { code });

function makeSrc() {
  const root = tmp();
  const src = path.join(root, "_tai-ve", "1.1.1");
  fs.mkdirSync(path.join(src, "node"), { recursive: true });
  fs.writeFileSync(path.join(src, "node", "node.exe"), "exe");
  return { root, src, dest: path.join(root, "1.1.1") };
}

describe("moveDir", () => {
  it("bị giữ file vài lần rồi nhả: chờ tăng dần rồi đổi tên được, không sao chép", async () => {
    const { src, dest } = makeSrc();
    let fails = 3;
    const sleeps: number[] = [];
    const onSlow = vi.fn();
    const ops: DirOps = {
      ...realDirOps,
      rename: (a, b) => {
        if (fails-- > 0) throw locked(fails % 2 ? "EBUSY" : "EPERM");
        fs.renameSync(a, b);
      },
      copy: () => {
        throw new Error("không được sao chép");
      },
      sleep: async (ms) => void sleeps.push(ms),
    };
    expect(await moveDir(src, dest, { ops, onSlow })).toBe("renamed");
    expect(sleeps).toEqual([250, 500, 1000]);
    expect(onSlow).toHaveBeenCalled();
    expect(fs.readFileSync(path.join(dest, "node", "node.exe"), "utf8")).toBe("exe");
    expect(fs.existsSync(src)).toBe(false);
  });

  it("bị giữ mãi: hết thời gian chờ thì sao chép rồi xoá thư mục tạm", async () => {
    const { src, dest } = makeSrc();
    const sleeps: number[] = [];
    const ops: DirOps = { ...realDirOps, rename: () => { throw locked(); }, sleep: async (ms) => void sleeps.push(ms) };
    expect(await moveDir(src, dest, { ops, renameWaitMs: 5_000 })).toBe("copied");
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5_000);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(4_000);
    expect(fs.readFileSync(path.join(dest, "node", "node.exe"), "utf8")).toBe("exe");
    expect(fs.existsSync(src)).toBe(false);
  });

  it("thư mục tạm không xoá được sau khi chép: vẫn coi là xong (lần sau dọn)", async () => {
    const { src, dest } = makeSrc();
    const ops: DirOps = {
      ...realDirOps,
      rename: () => { throw locked(); },
      remove: async (dir) => {
        if (dir === src) throw locked();
        await realDirOps.remove(dir);
      },
      sleep: async () => {},
    };
    expect(await moveDir(src, dest, { ops, renameWaitMs: 0 })).toBe("copied");
    expect(fs.existsSync(path.join(dest, "node", "node.exe"))).toBe(true);
  });

  it("thư mục đích cũ còn bị giữ, không xoá được: báo tiếng Việt, không đụng gì", async () => {
    const { src, dest } = makeSrc();
    fs.mkdirSync(dest);
    const ops: DirOps = { ...realDirOps, remove: async () => { throw locked(); }, sleep: async () => {} };
    await expect(moveDir(src, dest, { ops })).rejects.toThrow("chưa xoá được");
    expect(fs.existsSync(src)).toBe(true);
  });

  it("lỗi khác (không phải bị giữ file): không chờ, báo ngay bằng tiếng Việt", async () => {
    const { src, dest } = makeSrc();
    const sleep = vi.fn(async () => {});
    const ops: DirOps = { ...realDirOps, rename: () => { throw locked("ENOSPC"); }, sleep };
    await expect(moveDir(src, dest, { ops })).rejects.toThrow("Không chuyển được bản mới vào chỗ (ENOSPC)");
    expect(sleep).not.toHaveBeenCalled();
  });
});
