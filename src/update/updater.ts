import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "../db/index.js";
import { logger } from "../logger.js";
import { compareVersions, type InstallLayout, isCompleteVersion } from "./layout.js";
import type { ReleaseInfo, ReleaseSource } from "./releases.js";

// Kiểm tra / cập nhật / quay về phiên bản (D16). Chỉ chạy khi người dùng bấm; không bao giờ tự cập nhật.

export const BACKUP_DIR = "sao-luu";
export const KEEP_BACKUPS = 3;

export type UpdateStep = "downloading" | "verifying" | "extracting" | "backing_up" | "switching" | "failed";

export interface UpdateJob {
  target: string;
  step: UpdateStep;
  bytes: number;
  total?: number;
  /** Tốc độ tải (byte/giây) trong vài giây gần nhất. */
  speed?: number;
  /** Đang thử lại sau khi mạng đứng / ngắt. */
  retry?: { attempt: number; max: number };
  error?: string;
}

/** Cập nhật số byte, tốc độ (đo trong ~5 giây gần nhất) và bỏ dòng "đang thử lại" khi tải nhích lên. */
function speedMeter(job: UpdateJob) {
  const samples: { t: number; bytes: number }[] = [];
  return (bytes: number, total?: number) => {
    const t = Date.now();
    if (bytes > job.bytes) job.retry = undefined;
    job.bytes = bytes;
    if (total) job.total = total;
    samples.push({ t, bytes });
    while (samples.length > 2 && t - samples[0]!.t > 5_000) samples.shift();
    const first = samples[0]!;
    if (t - first.t >= 1_000) job.speed = ((bytes - first.bytes) * 1000) / (t - first.t);
  };
}

export interface UpdaterOptions {
  /** undefined khi không chạy từ bản zip (máy phát triển): chỉ kiểm tra, không cập nhật được. */
  layout?: InstallLayout;
  source: ReleaseSource;
  db: DB;
  dataDir: string;
  currentVersion: string;
  /** Lý do không được cập nhật / quay về lúc này (lô đang chạy, dòng đang chờ Muse…). */
  blocker: () => string | undefined;
  /** Tắt tool để Mo-MASYS.bat chạy bản trong hien-tai.txt. */
  switchVersion: () => void;
  extract?: (zipFile: string, destDir: string) => void;
}

const sha256File = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function systemTarExtract(zipFile: string, destDir: string) {
  // tar.exe có sẵn trên Windows 10+ đọc được zip; không cần thư viện giải nén.
  const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  execFileSync(tar, ["-xf", zipFile, "-C", destDir], { windowsHide: true });
}

export class Updater {
  latest?: ReleaseInfo;
  checkedAt?: Date;
  checkError?: string;
  job?: UpdateJob;
  /** Thông báo một lần sau khi mở tool: vừa cập nhật / vừa quay về / bản mới lỗi đã tự quay về. */
  notice?: { kind: "ok" | "warn"; text: string };

  constructor(private readonly o: UpdaterOptions) {}

  get currentVersion() {
    return this.o.currentVersion;
  }
  get canInstall() {
    return !!this.o.layout;
  }

  /** Gọi một lần khi khởi động: so phiên bản lần chạy trước, đọc ghi chú lỗi cập nhật của launcher. */
  startup(): void {
    const row = this.o.db.prepare("SELECT lastRunVersion FROM settings WHERE id = 1").get() as { lastRunVersion: string | null } | undefined;
    const last = row?.lastRunVersion;
    const cur = this.o.currentVersion;
    const failed = this.o.layout?.failedUpdate();
    if (failed) {
      this.notice = { kind: "warn", text: `Bản v${failed} không khởi động được nên tool đã tự quay về v${cur}. Dữ liệu không bị ảnh hưởng.` };
      this.o.layout!.clearFailedUpdate();
      logger.warn({ failed, current: cur }, "Bản mới không khởi động được, đã quay về");
    } else if (last && last !== cur) {
      this.notice =
        compareVersions(cur, last) > 0
          ? { kind: "ok", text: `Đã cập nhật lên v${cur} (từ v${last}).` }
          : { kind: "ok", text: `Đã quay về v${cur} (từ v${last}).` };
    }
    this.o.db.prepare("UPDATE settings SET lastRunVersion = ? WHERE id = 1").run(cur);
  }

  hasUpdate(): boolean {
    return !!this.latest && compareVersions(this.latest.version, this.o.currentVersion) > 0;
  }

  get busy(): boolean {
    return !!this.job && this.job.step !== "failed";
  }

  async check(): Promise<void> {
    try {
      this.latest = await this.o.source.latest();
      this.checkError = undefined;
    } catch (e) {
      this.checkError = (e as Error).message;
    }
    this.checkedAt = new Date();
  }

  /** Lý do chưa cập nhật được; undefined = được. */
  installBlocker(): string | undefined {
    if (!this.o.layout) return "Chỉ bản zip (mở bằng Mo-MASYS.bat) mới cập nhật trong tool được.";
    if (this.busy) return "Đang cập nhật.";
    return this.o.blocker();
  }

  previousVersion(): string | undefined {
    return this.o.layout?.previous();
  }

  /** Chạy cả quá trình cập nhật; lỗi ở bất kỳ bước nào trước khi chuyển bản thì bản đang dùng giữ nguyên. */
  async install(): Promise<void> {
    const release = this.latest;
    const layout = this.o.layout;
    const blocked = this.installBlocker();
    if (blocked) throw new Error(blocked);
    if (!release || !this.hasUpdate() || !layout) throw new Error("Không có bản mới hơn để cập nhật.");

    const job: UpdateJob = { target: release.version, step: "downloading", bytes: 0, total: release.zipSize };
    this.job = job;
    const tmp = path.join(layout.versionsDir, "_tai-ve");
    const dest = layout.versionDir(release.version);
    const zipFile = path.join(tmp, `v${release.version}.zip`);
    // Phần zip tải dở của đúng bản này (lần bấm trước bị ngắt: `.part` và các đoạn `.part.N`) được giữ để tải tiếp; còn lại dọn đi.
    const part = `${zipFile}.part`;
    const cleanTmp = (keepPart: boolean) => {
      if (!fs.existsSync(tmp)) return;
      for (const f of fs.readdirSync(tmp)) {
        if (!keepPart || !f.startsWith(path.basename(part))) fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
      }
      if (!keepPart) fs.rmSync(tmp, { recursive: true, force: true });
    };
    cleanTmp(true);
    fs.mkdirSync(tmp, { recursive: true });
    let placed = false;
    try {
      const shaText = (await this.o.source.download(release.sha256Url)).toString("utf8");
      const expected = shaText.trim().split(/\s+/)[0]?.toLowerCase();
      if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Error("File SHA-256 trên GitHub không hợp lệ; đã huỷ.");
      await this.o.source.downloadToFile(release.zipUrl, part, {
        size: release.zipSize,
        onProgress: speedMeter(job),
        onRetry: (attempt, max) => (job.retry = { attempt, max }),
      });
      job.retry = undefined;

      job.step = "verifying";
      if (sha256File(part) !== expected) {
        fs.rmSync(part, { force: true }); // hỏng thì lần sau tải lại từ đầu
        throw new Error("File tải về bị hỏng (sai mã SHA-256); đã huỷ, bản đang dùng giữ nguyên. Bấm Cập nhật để tải lại.");
      }
      fs.renameSync(part, zipFile);

      job.step = "extracting";
      fs.mkdirSync(path.join(tmp, "x"), { recursive: true });
      try {
        (this.o.extract ?? systemTarExtract)(zipFile, path.join(tmp, "x"));
      } catch {
        throw new Error("Giải nén bản mới không được (ổ đĩa đầy hoặc file zip hỏng); đã huỷ, bản đang dùng giữ nguyên.");
      }
      const src = path.join(tmp, "x", "MASYS-Video", "phien-ban", release.version);
      if (!isCompleteVersion(src)) throw new Error("File zip bản mới thiếu thành phần; đã huỷ.");
      const pkg = JSON.parse(fs.readFileSync(path.join(src, "app", "package.json"), "utf8")) as { version?: string };
      if (pkg.version !== release.version) throw new Error("Số phiên bản trong zip không khớp; đã huỷ.");
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(src, dest);
      placed = true;
      fs.rmSync(tmp, { recursive: true, force: true });

      job.step = "backing_up";
      try {
        await this.backup(`v${this.o.currentVersion}-sang-v${release.version}`);
      } catch {
        throw new Error("Không sao lưu được dữ liệu (ổ đĩa đầy?); đã huỷ, bản đang dùng giữ nguyên.");
      }

      // Trong lúc tải có thể đã bấm chạy lô: kiểm tra lại ngay trước khi chuyển.
      const late = this.o.blocker();
      if (late) throw new Error(`${late} Bản mới đã tải xong; bấm Cập nhật lại khi rảnh.`);

      job.step = "switching";
      const current = layout.current()!;
      layout.prune([current, release.version]);
      layout.startTrial(current);
      layout.setCurrent(release.version);
      logger.info({ from: current, to: release.version }, "Chuyển sang bản mới");
      this.o.switchVersion();
    } catch (e) {
      // Lỗi lúc tải: giữ phần đã tải để lần bấm sau tải tiếp.
      const keepPart = job.step === "downloading";
      job.step = "failed";
      job.retry = undefined;
      job.error = (e as Error).message;
      cleanTmp(keepPart);
      // Bản mới đã giải nén nhưng chưa chuyển thì giữ lại cũng vô hại; chỉ xoá khi lỗi trước bước đó.
      if (!placed) fs.rmSync(dest, { recursive: true, force: true });
      logger.warn({ target: release.version, problem: job.error }, "Cập nhật không thành công");
    }
  }

  /** Quay về bản trước (chỉ khi người dùng bấm). */
  rollback(): { ok: true; version: string } | { ok: false; message: string } {
    const layout = this.o.layout;
    if (!layout) return { ok: false, message: "Chỉ bản zip mới quay về được." };
    const prev = layout.previous();
    if (!prev) return { ok: false, message: "Không còn bản trước để quay về." };
    const blocked = this.o.blocker() ?? (this.busy ? "Đang cập nhật." : undefined);
    if (blocked) return { ok: false, message: blocked };
    layout.endTrial();
    layout.setCurrent(prev);
    logger.info({ from: this.o.currentVersion, to: prev }, "Quay về bản trước");
    this.o.switchVersion();
    return { ok: true, version: prev };
  }

  /** Sao lưu data.db bằng API backup của SQLite (an toàn khi đang mở); giữ KEEP_BACKUPS bản mới nhất. */
  async backup(label: string): Promise<string> {
    const dir = path.join(this.o.dataDir, BACKUP_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `data-${stamp}-${label}.db`);
    await this.o.db.backup(file);
    const old = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("data-") && f.endsWith(".db"))
      .sort()
      .reverse()
      .slice(KEEP_BACKUPS);
    for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
    return file;
  }
}
