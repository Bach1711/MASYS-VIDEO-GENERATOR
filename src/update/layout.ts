import fs from "node:fs";
import path from "node:path";

// Thư mục bản zip từ CON-44 (D16):
//   MASYS-Video\                 ← MASYS_HOME, Mo-MASYS.bat đặt biến này
//   ├─ Mo-MASYS.bat              ← đọc phien-ban\hien-tai.txt rồi chạy bản đó
//   └─ phien-ban\
//      ├─ hien-tai.txt           ← bản đang dùng, ví dụ "1.0.1"
//      ├─ dang-thu.txt           ← có khi vừa cập nhật: chứa bản cũ để quay về nếu bản mới không lên
//      ├─ loi-cap-nhat.txt       ← bản mới không lên được, đã tự quay về (tool đọc rồi xoá)
//      ├─ 1.0.0\ node\ app\      ← bản trước (giữ để bấm Quay về)
//      └─ 1.0.1\ node\ app\

export const VERSIONS_DIR = "phien-ban";
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export class InstallLayout {
  readonly versionsDir: string;
  constructor(readonly home: string) {
    this.versionsDir = path.join(home, VERSIONS_DIR);
  }

  private file(name: string) {
    return path.join(this.versionsDir, name);
  }
  private read(name: string): string | undefined {
    try {
      return fs.readFileSync(this.file(name), "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  }
  private write(name: string, value: string) {
    // Không xuống dòng: Mo-MASYS.bat đọc bằng "set /p".
    fs.writeFileSync(this.file(name), value);
  }
  private remove(name: string) {
    fs.rmSync(this.file(name), { force: true });
  }

  /** true khi tool chạy từ bản zip có thư mục phien-ban (cập nhật được). */
  isValid(): boolean {
    return !!this.current() && fs.existsSync(this.versionDir(this.current()!));
  }

  current(): string | undefined {
    return this.read("hien-tai.txt");
  }
  setCurrent(v: string) {
    this.write("hien-tai.txt", v);
  }

  /** Bản đang thử sau khi cập nhật: trả về bản cũ để quay về. */
  trialPrevious(): string | undefined {
    return this.read("dang-thu.txt");
  }
  startTrial(previous: string) {
    this.write("dang-thu.txt", previous);
  }
  endTrial() {
    this.remove("dang-thu.txt");
  }

  failedUpdate(): string | undefined {
    return this.read("loi-cap-nhat.txt");
  }
  recordFailedUpdate(v: string) {
    this.write("loi-cap-nhat.txt", v);
  }
  clearFailedUpdate() {
    this.remove("loi-cap-nhat.txt");
  }

  versionDir(v: string) {
    return path.join(this.versionsDir, v);
  }

  /** Các bản đã cài (thư mục có node.exe và launcher), mới nhất trước. */
  installed(): string[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.versionsDir);
    } catch {
      return [];
    }
    return names
      .filter((n) => VERSION_RE.test(n) && isCompleteVersion(this.versionDir(n)))
      .sort((a, b) => compareVersions(b, a));
  }

  /** Bản để bấm Quay về: bản đã cài gần nhất cũ hơn bản đang dùng. */
  previous(): string | undefined {
    const cur = this.current();
    return cur ? this.installed().find((v) => compareVersions(v, cur) < 0) : undefined;
  }

  /** Giữ bản đang dùng và đúng một bản trước; xoá các bản cũ hơn và thư mục tải dở. */
  prune(keep: string[]) {
    for (const n of fs.existsSync(this.versionsDir) ? fs.readdirSync(this.versionsDir) : []) {
      const full = this.versionDir(n);
      if (!fs.statSync(full).isDirectory() || keep.includes(n)) continue;
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
}

export function isCompleteVersion(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "node", "node.exe")) &&
    fs.existsSync(path.join(dir, "app", "dist", "launcher.js")) &&
    fs.existsSync(path.join(dir, "app", "package.json"))
  );
}

/** So hai số phiên bản dạng X.Y.Z: âm nếu a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function isVersion(v: string): boolean {
  return VERSION_RE.test(v);
}
