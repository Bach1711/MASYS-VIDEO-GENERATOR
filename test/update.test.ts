import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { updateBlocker } from "../src/db/history.js";
import { compareVersions, InstallLayout } from "../src/update/layout.js";
import { ReleaseSource, sourceFromEnv, zipAssetName } from "../src/update/releases.js";
import { type DirOps, realDirOps } from "../src/update/moveDir.js";
import { KEEP_BACKUPS, Updater } from "../src/update/updater.js";
import { createApp } from "../src/web/app.js";
import { FAKE_KEY_ENV } from "./fakeKey.js";

const API = "https://api.github.com/repos/Bach1711/MASYS-VIDEO-GENERATOR/releases/latest";
const DL = "https://github.com/Bach1711/MASYS-VIDEO-GENERATOR/releases/download/";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "masys-update-"));

/** Tạo một thư mục phiên bản đủ thành phần (node.exe, launcher, package.json). */
function makeVersionDir(dir: string, version: string) {
  fs.mkdirSync(path.join(dir, "node"), { recursive: true });
  fs.mkdirSync(path.join(dir, "app", "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node", "node.exe"), "exe");
  fs.writeFileSync(path.join(dir, "app", "dist", "launcher.js"), "// launcher");
  fs.writeFileSync(path.join(dir, "app", "package.json"), JSON.stringify({ version }));
}

function makeHome(versions: string[], current: string) {
  const home = tmp();
  const layout = new InstallLayout(home);
  for (const v of versions) makeVersionDir(layout.versionDir(v), v);
  layout.setCurrent(current);
  return layout;
}

/** GitHub giả: trả bản `version`; zip "giả" là chuỗi byte, phần giải nén do `extract` giả tạo thư mục. */
function fakeGithub(o: { version: string; zip?: Buffer; sha?: string; status?: number; offline?: boolean; zipUrl?: string }) {
  const zip = o.zip ?? Buffer.from("zip-bytes-" + o.version);
  const sha = o.sha ?? crypto.createHash("sha256").update(zip).digest("hex");
  const name = zipAssetName(o.version);
  const fetchFn = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (o.offline) throw new TypeError("fetch failed");
    if (u === API) {
      if (o.status) return new Response("{}", { status: o.status });
      return Response.json({
        tag_name: `v${o.version}`,
        published_at: "2026-10-28T03:00:00Z",
        body: "- Sửa lỗi A\n- Thêm nút B",
        html_url: `https://github.com/Bach1711/MASYS-VIDEO-GENERATOR/releases/tag/v${o.version}`,
        assets: [
          { name, browser_download_url: o.zipUrl ?? `${DL}v${o.version}/${name}`, size: zip.length },
          { name: `${name}.sha256`, browser_download_url: `${DL}v${o.version}/${name}.sha256` },
        ],
      });
    }
    if (u.endsWith(".sha256")) return new Response(`${sha}  ${name}\n`);
    if (u.endsWith(".zip")) return new Response(zip);
    return new Response("not found", { status: 404 });
  });
  return { source: new ReleaseSource({ fetch: fetchFn as unknown as typeof fetch }), fetchFn };
}

function setup(o: { versions?: string[]; current?: string; remote?: string; github?: Parameters<typeof fakeGithub>[0]; db?: DB; noLayout?: boolean; dirOps?: DirOps } = {}) {
  const current = o.current ?? "1.0.0";
  const layout = makeHome(o.versions ?? [current], current);
  const db = o.db ?? openDatabase(":memory:");
  const gh = fakeGithub(o.github ?? { version: o.remote ?? "1.0.1" });
  const switchVersion = vi.fn();
  const dataDir = tmp();
  const extract = vi.fn((_zip: string, dest: string) => {
    const v = (o.github ?? { version: o.remote ?? "1.0.1" }).version;
    makeVersionDir(path.join(dest, "MASYS-Video", "phien-ban", v), v);
  });
  const updater = new Updater({
    layout: o.noLayout ? undefined : layout,
    source: gh.source,
    db,
    dataDir,
    currentVersion: current,
    blocker: () => updateBlocker(db),
    switchVersion,
    extract,
    dirOps: o.dirOps,
    renameWaitMs: 100,
  });
  return { layout, db, updater, switchVersion, extract, dataDir, fetchFn: gh.fetchFn };
}

describe("phiên bản và thư mục phien-ban", () => {
  it("so số phiên bản đúng thứ tự", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.1.0", "1.0.99")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBeLessThan(0);
  });

  it("biết bản đang dùng, bản trước; dọn chỉ giữ bản được chỉ định", () => {
    const layout = makeHome(["1.0.0", "1.0.1", "1.0.2"], "1.0.2");
    fs.mkdirSync(layout.versionDir("rac"));
    expect(layout.isValid()).toBe(true);
    expect(layout.installed()).toEqual(["1.0.2", "1.0.1", "1.0.0"]);
    expect(layout.previous()).toBe("1.0.1");
    layout.prune(["1.0.2", "1.0.1"]);
    expect(layout.installed()).toEqual(["1.0.2", "1.0.1"]);
    expect(fs.existsSync(layout.versionDir("rac"))).toBe(false);
    expect(fs.readFileSync(path.join(layout.versionsDir, "hien-tai.txt"), "utf8")).toBe("1.0.2");
  });
});

describe("hỏi GitHub bản mới nhất", () => {
  it("có bản mới hơn thì báo, kèm ghi chú và ngày", async () => {
    const { updater } = setup({ remote: "1.0.1" });
    await updater.check();
    expect(updater.hasUpdate()).toBe(true);
    expect(updater.latest).toMatchObject({ version: "1.0.1", notes: expect.stringContaining("Sửa lỗi A") });
  });

  it("đang là bản mới nhất thì không báo", async () => {
    const { updater } = setup({ current: "1.0.1", remote: "1.0.1" });
    await updater.check();
    expect(updater.hasUpdate()).toBe(false);
    expect(updater.checkError).toBeUndefined();
  });

  it("mất mạng hoặc GitHub lỗi thì báo rõ, không ném lỗi", async () => {
    const offline = setup({ github: { version: "1.0.1", offline: true } });
    await offline.updater.check();
    expect(offline.updater.checkError).toContain("Không kết nối được GitHub");
    const notFound = setup({ github: { version: "1.0.1", status: 404 } });
    await notFound.updater.check();
    expect(notFound.updater.checkError).toContain("Chưa có bản phát hành");
  });

  it("không nhận địa chỉ tải ngoài repo phát hành", async () => {
    const { updater } = setup({ github: { version: "1.0.1", zipUrl: "https://evil.example.com/x.zip" } });
    await updater.check();
    expect(updater.hasUpdate()).toBe(false);
    expect(updater.checkError).toContain("không thuộc repo");
    await expect(new ReleaseSource().download("https://evil.example.com/x.zip")).rejects.toThrow("không thuộc repo");
  });

  it("địa chỉ thay thế từ biến môi trường chỉ nhận localhost", () => {
    expect(sourceFromEnv({ MASYS_RELEASES_API: "http://127.0.0.1:9/api", MASYS_RELEASES_DOWNLOAD: "http://127.0.0.1:9/dl/" })).toEqual({
      apiUrl: "http://127.0.0.1:9/api",
      downloadPrefix: "http://127.0.0.1:9/dl/",
    });
    expect(sourceFromEnv({ MASYS_RELEASES_API: "https://evil.example.com/api", MASYS_RELEASES_DOWNLOAD: "https://evil.example.com/" })).toEqual({});
  });
});

describe("cập nhật", () => {
  it("tải, kiểm tra SHA-256, giải nén cạnh bản cũ, sao lưu dữ liệu, chuyển bản và giữ đúng một bản trước", async () => {
    const { updater, layout, switchVersion, dataDir } = setup({ versions: ["0.9.0", "1.0.0"], current: "1.0.0", remote: "1.0.1" });
    await updater.check();
    await updater.install();
    expect(updater.job?.error).toBeUndefined();
    expect(updater.job?.step).toBe("switching");
    expect(layout.current()).toBe("1.0.1");
    expect(layout.trialPrevious()).toBe("1.0.0");
    expect(layout.installed()).toEqual(["1.0.1", "1.0.0"]);
    expect(fs.existsSync(path.join(layout.versionsDir, "_tai-ve"))).toBe(false);
    expect(fs.readdirSync(path.join(dataDir, "sao-luu"))).toHaveLength(1);
    expect(switchVersion).toHaveBeenCalledOnce();
  });

  it("phần mềm diệt virus giữ file mới (EPERM khi đổi tên): chờ, rồi sao chép; vẫn cập nhật được (CON-47)", async () => {
    const eperm = () => Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
    const dirOps: DirOps = { ...realDirOps, rename: () => { throw eperm(); }, sleep: async () => {} };
    const { updater, layout, switchVersion } = setup({ dirOps });
    await updater.check();
    await updater.install();
    expect(updater.job?.error).toBeUndefined();
    expect(updater.job?.slow).toBe(true);
    expect(layout.current()).toBe("1.0.1");
    expect(layout.installed()).toEqual(["1.0.1", "1.0.0"]);
    expect(fs.existsSync(path.join(layout.versionsDir, "_tai-ve"))).toBe(false);
    expect(switchVersion).toHaveBeenCalledOnce();
  });

  it("đổi tên lẫn sao chép đều bị chặn: báo tiếng Việt, dọn phần chép dở, bản đang dùng giữ nguyên", async () => {
    const eperm = () => Object.assign(new Error("EPERM"), { code: "EPERM" });
    const dirOps: DirOps = {
      ...realDirOps,
      rename: () => { throw eperm(); },
      copy: (src, dest) => {
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "chep-do.txt"), "x");
        throw eperm();
      },
      sleep: async () => {},
    };
    const { updater, layout, switchVersion } = setup({ dirOps });
    await updater.check();
    await updater.install();
    expect(updater.job).toMatchObject({ step: "failed", error: expect.stringContaining("phần mềm diệt virus") });
    expect(updater.job?.error).not.toContain("EPERM");
    expect(layout.current()).toBe("1.0.0");
    expect(fs.existsSync(layout.versionDir("1.0.1"))).toBe(false);
    expect(switchVersion).not.toHaveBeenCalled();
  });

  it("SHA-256 sai thì huỷ, bản đang dùng giữ nguyên, không chuyển", async () => {
    const { updater, layout, switchVersion } = setup({ github: { version: "1.0.1", sha: "0".repeat(64) } });
    await updater.check();
    await updater.install();
    expect(updater.job).toMatchObject({ step: "failed", error: expect.stringContaining("sai mã SHA-256") });
    expect(layout.current()).toBe("1.0.0");
    expect(layout.trialPrevious()).toBeUndefined();
    expect(fs.existsSync(layout.versionDir("1.0.1"))).toBe(false);
    expect(switchVersion).not.toHaveBeenCalled();
  });

  it("zip thiếu thành phần thì huỷ", async () => {
    const s = setup();
    s.extract.mockImplementation(() => {});
    await s.updater.check();
    await s.updater.install();
    expect(s.updater.job?.error).toContain("thiếu thành phần");
    expect(s.layout.current()).toBe("1.0.0");
  });

  it("không cho cập nhật khi lô đang chạy hoặc có dòng đang chờ Muse", async () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (5, 'S', 'T', 'F', 'running')").run();
    const s = setup({ db });
    await s.updater.check();
    expect(s.updater.installBlocker()).toBe("Chờ lô #5 xong hoặc bấm Tạm dừng.");
    await expect(s.updater.install()).rejects.toThrow("Chờ lô #5");
    expect(s.updater.rollback()).toEqual({ ok: false, message: "Không còn bản trước để quay về." });

    db.prepare("UPDATE batches SET status = 'paused' WHERE id = 5").run();
    db.prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, state) VALUES (5, 3, '{}', 'waiting')").run();
    expect(s.updater.installBlocker()).toContain("Lô #5 còn dòng đang gửi hoặc đang chờ Muse");
    db.prepare("UPDATE runs SET state = 'done'").run();
    expect(s.updater.installBlocker()).toBeUndefined();
  });

  it("máy phát triển (không có thư mục phien-ban) chỉ kiểm tra, không cập nhật", async () => {
    const s = setup({ noLayout: true });
    await s.updater.check();
    expect(s.updater.hasUpdate()).toBe(true);
    expect(s.updater.installBlocker()).toContain("Chỉ bản zip");
  });

  it("sao lưu chỉ giữ 3 bản mới nhất", async () => {
    const s = setup();
    for (let i = 0; i < KEEP_BACKUPS + 2; i++) await s.updater.backup(`thu-${i}`);
    const files = fs.readdirSync(path.join(s.dataDir, "sao-luu"));
    expect(files).toHaveLength(KEEP_BACKUPS);
    expect(files.some((f) => f.includes("thu-0"))).toBe(false);
  });
});

describe("quay về và thông báo sau khi mở tool", () => {
  it("Quay về chuyển hien-tai.txt sang bản trước và khởi động lại", () => {
    const s = setup({ versions: ["1.0.0", "1.0.1"], current: "1.0.1" });
    expect(s.updater.previousVersion()).toBe("1.0.0");
    expect(s.updater.rollback()).toEqual({ ok: true, version: "1.0.0" });
    expect(s.layout.current()).toBe("1.0.0");
    expect(s.switchVersion).toHaveBeenCalledOnce();
  });

  it("báo Đã cập nhật / Đã quay về theo phiên bản lần chạy trước; bản mới lỗi đã tự quay về thì báo lỗi", () => {
    const db = openDatabase(":memory:");
    db.prepare("UPDATE settings SET lastRunVersion = '1.0.0' WHERE id = 1").run();
    const up = setup({ db, current: "1.0.1", versions: ["1.0.1"] });
    up.updater.startup();
    expect(up.updater.notice).toEqual({ kind: "ok", text: "Đã cập nhật lên v1.0.1 (từ v1.0.0)." });

    const down = setup({ db, current: "1.0.0", versions: ["1.0.0"] });
    down.updater.startup();
    expect(down.updater.notice?.text).toBe("Đã quay về v1.0.0 (từ v1.0.1).");

    const failed = setup({ db, current: "1.0.0", versions: ["1.0.0"] });
    failed.layout.recordFailedUpdate("1.0.1");
    failed.updater.startup();
    expect(failed.updater.notice).toMatchObject({ kind: "warn", text: expect.stringContaining("Bản v1.0.1 không khởi động được") });
    expect(failed.layout.failedUpdate()).toBeUndefined();

    const same = setup({ db, current: "1.0.0", versions: ["1.0.0"] });
    same.updater.startup();
    expect(same.updater.notice).toBeUndefined();
  });
});

describe("giao diện phiên bản", () => {
  async function appWith(o: Parameters<typeof setup>[0] = {}) {
    const s = setup(o);
    await s.updater.check();
    const app = createApp(loadConfig(FAKE_KEY_ENV), s.db, { updater: s.updater });
    return { ...s, app };
  }

  it("Cài đặt hiện bản đang dùng, bản mới, ghi chú, nút Cập nhật; mọi trang có dải báo bản mới", async () => {
    const { app } = await appWith({ versions: ["0.9.0", "1.0.0"] });
    const page = await (await app.request("/settings")).text();
    expect(page).toContain("Đang dùng: <strong>v1.0.0</strong>");
    expect(page).toContain("Cập nhật lên v1.0.1");
    expect(page).toContain("Sửa lỗi A");
    expect(page).toContain("Quay về v0.9.0");
    expect(await (await app.request("/batches")).text()).toContain("Có bản mới v1.0.1");
  });

  it("đang bận thì nút Cập nhật mờ, ghi lý do; bấm cũng không chạy", async () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (8, 'S', 'T', 'F', 'running')").run();
    const { app, switchVersion } = await appWith({ db });
    const page = await (await app.request("/settings")).text();
    expect(page).toMatch(/<button type="submit" disabled="">\s*Cập nhật lên v1.0.1/);
    expect(page).toContain("Chờ lô #8 xong hoặc bấm Tạm dừng.");
    const r = await app.request("/update/install", { method: "POST" });
    expect(r.headers.get("location")).toBe("/settings#phien-ban");
    expect(switchVersion).not.toHaveBeenCalled();
  });

  it("bấm Cập nhật thì chuyển sang trang tiến trình, xong thì chờ bản mới lên", async () => {
    const { app, updater } = await appWith();
    const r = await app.request("/update/install", { method: "POST" });
    expect(r.headers.get("location")).toBe("/update");
    await vi.waitFor(() => expect(updater.job?.step).toBe("switching"));
    const page = await (await app.request("/update")).text();
    expect(page).toContain("Đang khởi động lại bằng bản mới");
    expect(page).toContain('"1.0.1"');
  });

  it("trang tiến trình hiện tốc độ tải; mạng đứng thì báo đang thử lại", async () => {
    const { app, updater } = await appWith();
    updater.job = { target: "1.0.1", step: "downloading", bytes: 4.5 * 1024 * 1024, total: 50.1 * 1024 * 1024, speed: 2.5 * 1024 * 1024 };
    let page = await (await app.request("/update")).text();
    expect(page).toContain("4.5 MB / 50.1 MB · 2.5 MB/giây");
    updater.job.retry = { attempt: 2, max: 5 };
    page = await (await app.request("/update")).text();
    expect(page).toContain("Mạng chập chờn, đang thử lại (lần 2/5)");
    expect(page).not.toContain("MB/giây");
  });

  it("thông báo sau khi mở tool hiện trên mọi trang tới khi bấm Đã hiểu", async () => {
    const { app, updater } = await appWith({ current: "1.0.1", remote: "1.0.1" });
    updater.notice = { kind: "ok", text: "Đã cập nhật lên v1.0.1 (từ v1.0.0)." };
    expect(await (await app.request("/logs")).text()).toContain("Đã cập nhật lên v1.0.1");
    const r = await app.request("/update/dismiss", { method: "POST", headers: { referer: "http://localhost:4310/logs" } });
    expect(r.headers.get("location")).toBe("/logs");
    expect(await (await app.request("/logs")).text()).not.toContain("Đã cập nhật lên v1.0.1");
  });
});
