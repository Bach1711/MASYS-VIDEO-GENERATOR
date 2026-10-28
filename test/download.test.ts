import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { InstallLayout } from "../src/update/layout.js";
import { ReleaseSource, zipAssetName } from "../src/update/releases.js";
import { Updater } from "../src/update/updater.js";

// Tải bản mới khi mạng chập chờn (CON-45): máy chủ thật trên 127.0.0.1 đứng / ngắt giữa chừng.

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "masys-dl-"));
const FILE = crypto.randomBytes(200_000);

type Behavior = {
  /** Lần gọi thứ i (từ 0): gửi bao nhiêu byte rồi "đứng" (giữ kết nối, không gửi gì) hoặc "ngắt" (đóng kết nối). */
  plan?: Step[] | ((i: number, start: number) => Step | undefined);
  range?: boolean;
  status?: number;
};
type Step = { cut: number; then: "stall" | "drop" } | "ok";

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.closeAllConnections(), s.close();
});

async function serve(b: Behavior, body = FILE) {
  const calls: { range?: string }[] = [];
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith(".sha256")) return res.end(crypto.createHash("sha256").update(body).digest("hex"));
    const i = calls.length;
    calls.push({ range: req.headers.range });
    if (b.status) return res.writeHead(b.status).end();
    let start = 0;
    let end = body.length - 1;
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (m && b.range !== false) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(end, Number(m[2]));
      if (start >= body.length) return res.writeHead(416).end();
      res.writeHead(206, { "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${body.length}` });
    } else {
      res.writeHead(200, { "Content-Length": body.length });
    }
    const step = (typeof b.plan === "function" ? b.plan(i, start) : b.plan?.[i]) ?? "ok";
    const rest = body.subarray(start, end + 1);
    if (step === "ok") return res.end(rest);
    res.write(rest.subarray(0, step.cut));
    if (step.then === "drop") setTimeout(() => res.destroy(), 20);
    // "stall": không gửi gì thêm, để bên tải tự phát hiện.
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dl/`;
  return { base, calls };
}

const source = (base: string, retries = 5) => new ReleaseSource({ downloadPrefix: base, stallMs: 300, retryDelayMs: 10, retries });

describe("tải file bản mới", () => {
  it("kết nối đứng giữa chừng: phát hiện, thử lại, tải tiếp từ chỗ dừng bằng Range", async () => {
    const { base, calls } = await serve({ plan: [{ cut: 50_000, then: "stall" }] });
    const file = path.join(tmp(), "a.part");
    const retries: number[] = [];
    await source(base).downloadToFile(`${base}a.zip`, file, { onRetry: (n) => retries.push(n) });
    expect(fs.readFileSync(file).equals(FILE)).toBe(true);
    expect(retries).toEqual([1]);
    expect(calls.map((c) => c.range)).toEqual([undefined, "bytes=50000-"]);
  });

  it("kết nối bị ngắt nhiều lần nhưng lần nào cũng nhích thêm: tải tới xong", async () => {
    const plan = Array.from({ length: 8 }, () => ({ cut: 20_000, then: "drop" as const }));
    const { base, calls } = await serve({ plan });
    const file = path.join(tmp(), "a.part");
    await source(base).downloadToFile(`${base}a.zip`, file);
    expect(fs.readFileSync(file).equals(FILE)).toBe(true);
    expect(calls.length).toBe(9); // nhiều hơn 5 lần thử, vì mỗi lần đều tải thêm được
  });

  it("máy chủ không hỗ trợ Range: tải lại từ đầu, file vẫn đúng", async () => {
    const { base } = await serve({ range: false, plan: [{ cut: 50_000, then: "drop" }] });
    const file = path.join(tmp(), "a.part");
    await source(base).downloadToFile(`${base}a.zip`, file);
    expect(fs.readFileSync(file).equals(FILE)).toBe(true);
  });

  it("đứng mãi: báo lỗi tiếng Việt, giữ phần đã tải", async () => {
    const plan = [{ cut: 30_000, then: "stall" as const }, ...Array.from({ length: 5 }, () => ({ cut: 0, then: "stall" as const }))];
    const { base } = await serve({ plan });
    const file = path.join(tmp(), "a.part");
    await expect(source(base, 2).downloadToFile(`${base}a.zip`, file)).rejects.toThrow("bấm Cập nhật lần nữa để tải tiếp");
    expect(fs.statSync(file).size).toBe(30_000);
  });

  it("file không có (404): không thử lại, báo lỗi tiếng Việt", async () => {
    const { base, calls } = await serve({ status: 404 });
    await expect(source(base).downloadToFile(`${base}a.zip`, path.join(tmp(), "a.part"))).rejects.toThrow("GitHub trả mã 404");
    expect(calls.length).toBe(1);
  });
});

describe("tải song song nhiều đoạn (GitHub giới hạn tốc độ theo từng kết nối)", () => {
  const BIG = crypto.randomBytes(6 * 1024 * 1024);
  const par = (base: string, retries = 5) =>
    new ReleaseSource({ downloadPrefix: base, stallMs: 300, retryDelayMs: 10, retries, connections: 3 });

  it("chia 3 đoạn tải cùng lúc, một đoạn đứng thì tải tiếp đoạn đó; ghép lại đúng file", async () => {
    let stalled = false;
    const { base, calls } = await serve({
      plan: (_i, start) => (start === 2 * 1024 * 1024 && !stalled ? ((stalled = true), { cut: 100_000, then: "stall" }) : undefined),
    }, BIG);
    const dir = tmp();
    const file = path.join(dir, "a.part");
    const seen: number[] = [];
    await par(base).downloadToFile(`${base}a.zip`, file, { size: BIG.length, onProgress: (n) => seen.push(n) });
    expect(fs.readFileSync(file).equals(BIG)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(["a.part"]);
    expect(calls.map((c) => c.range).sort()).toEqual(
      ["bytes=0-2097151", "bytes=2097152-4194303", "bytes=2197152-4194303", "bytes=4194304-6291455"].sort(),
    );
    expect(seen.at(-1)).toBe(BIG.length);
  });

  it("máy chủ không trả đúng đoạn: chuyển sang tải một luồng", async () => {
    const { base } = await serve({ range: false }, BIG);
    const file = path.join(tmp(), "a.part");
    await par(base).downloadToFile(`${base}a.zip`, file, { size: BIG.length });
    expect(fs.readFileSync(file).equals(BIG)).toBe(true);
  });

  it("một đoạn hỏng hẳn thì dừng cả, giữ các đoạn đã tải; lần sau tải tiếp từng đoạn", async () => {
    let broken = true;
    const { base, calls } = await serve({
      plan: (_i, start) => (broken && start >= 4 * 1024 * 1024 ? { cut: start === 4 * 1024 * 1024 ? 50_000 : 0, then: "stall" } : undefined),
    }, BIG);
    const dir = tmp();
    const file = path.join(dir, "a.part");
    await expect(par(base, 1).downloadToFile(`${base}a.zip`, file, { size: BIG.length })).rejects.toThrow("tải tiếp");
    expect(fs.statSync(`${file}.2`).size).toBe(50_000);
    broken = false;
    calls.length = 0;
    await par(base).downloadToFile(`${base}a.zip`, file, { size: BIG.length });
    expect(fs.readFileSync(file).equals(BIG)).toBe(true);
    expect(calls.map((c) => c.range)).toContain(`bytes=${4 * 1024 * 1024 + 50_000}-6291455`);
  });
});

describe("cập nhật qua mạng chập chờn", () => {
  it("lần bấm đầu hỏng giữa chừng thì giữ phần đã tải; bấm lại thì tải tiếp và cập nhật được", async () => {
    const v = "1.0.2";
    const plan = [{ cut: 80_000, then: "stall" as const }, { cut: 0, then: "stall" as const }];
    const { base, calls } = await serve({ plan });
    const home = tmp();
    const layout = new InstallLayout(home);
    const mk = (dir: string, ver: string) => {
      fs.mkdirSync(path.join(dir, "node"), { recursive: true });
      fs.mkdirSync(path.join(dir, "app", "dist"), { recursive: true });
      fs.writeFileSync(path.join(dir, "node", "node.exe"), "exe");
      fs.writeFileSync(path.join(dir, "app", "dist", "launcher.js"), "//");
      fs.writeFileSync(path.join(dir, "app", "package.json"), JSON.stringify({ version: ver }));
    };
    mk(layout.versionDir("1.0.0"), "1.0.0");
    layout.setCurrent("1.0.0");
    const extract = vi.fn((zip: string, dest: string) => {
      expect(fs.readFileSync(zip).equals(FILE)).toBe(true);
      mk(path.join(dest, "MASYS-Video", "phien-ban", v), v);
    });
    const name = zipAssetName(v);
    const updater = new Updater({
      layout,
      source: source(base, 1),
      db: openDatabase(":memory:"),
      dataDir: tmp(),
      currentVersion: "1.0.0",
      blocker: () => undefined,
      switchVersion: vi.fn(),
      extract,
    });
    updater.latest = { version: v, notes: "", zipUrl: `${base}v${v}/${name}`, sha256Url: `${base}v${v}/${name}.sha256`, zipSize: FILE.length };

    await updater.install();
    expect(updater.job).toMatchObject({ step: "failed", error: expect.stringContaining("tải tiếp") });
    expect(layout.current()).toBe("1.0.0");
    const part = path.join(layout.versionsDir, "_tai-ve", `v${v}.zip.part`);
    expect(fs.statSync(part).size).toBe(80_000);

    await updater.install();
    expect(updater.job?.error).toBeUndefined();
    expect(layout.current()).toBe(v);
    expect(calls.filter((c) => c.range).at(-1)?.range).toBe("bytes=80000-");
    expect(fs.existsSync(path.join(layout.versionsDir, "_tai-ve"))).toBe(false);
  });
});
