// Phát hành bản mới lên GitHub Releases (spec D16). Chạy sau khi PR đã gộp vào main:
//   npm run release
// Số phiên bản đã được nâng trong PR (package.json) và ghi chú tiếng Việt viết trong CHANGELOG.md (mục "## vX.Y.Z").
// Lệnh không sửa code hay commit gì: chỉ đóng gói đúng commit đang ở main rồi đăng zip + SHA-256.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "Bach1711/MASYS-VIDEO-GENERATOR";
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const gh = (...a) => execFileSync("gh", a, { cwd: root, encoding: "utf8" }).trim();
const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const tag = `v${version}`;

// 1. Đúng commit đã gộp: nhánh main, không có thay đổi chưa commit, trùng origin/main.
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("Chỉ phát hành từ nhánh main (sau khi PR đã gộp).");
if (git("status", "--porcelain", "--untracked-files=no")) fail("Còn thay đổi chưa commit trên main.");
git("fetch", "-q", "origin", "main");
const head = git("rev-parse", "HEAD");
if (head !== git("rev-parse", "origin/main")) fail("main trên máy chưa trùng origin/main: chạy git pull trước.");

// 2. Repo phải công khai thì máy người dùng mới tải được không cần token.
const visibility = gh("repo", "view", REPO, "--json", "visibility", "-q", ".visibility");
if (visibility !== "PUBLIC") fail(`Repo đang ${visibility}: máy người dùng không tải được bản mới. Đổi repo sang công khai trước.`);

// 3. Chưa có bản phát hành trùng số.
try {
  gh("release", "view", tag, "--repo", REPO, "--json", "tagName");
  fail(`Đã có bản phát hành ${tag}. Nâng số phiên bản trong package.json (qua PR) rồi chạy lại.`);
} catch {
  // chưa có: đúng
}

// 4. Ghi chú thay đổi lấy từ CHANGELOG.md.
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
const start = changelog.indexOf(`\n## ${tag}`);
if (start < 0) fail(`CHANGELOG.md chưa có mục "## ${tag}".`);
const rest = changelog.slice(start + 1);
const body = rest.slice(rest.indexOf("\n") + 1);
const next = body.search(/^## v/m);
const notes = (next < 0 ? body : body.slice(0, next)).trim();
if (!notes) fail(`Mục ${tag} trong CHANGELOG.md đang trống.`);

// 5. Đóng gói (kèm quét bí mật trong zip) rồi đăng.
execSync("node scripts/package.mjs", { cwd: root, stdio: "inherit" });
const zip = path.join(root, "release", `MASYS-Video-${tag}-win64.zip`);
const notesFile = path.join(root, "release", `ghi-chu-${tag}.md`);
fs.writeFileSync(notesFile, notes + "\n");
console.log(`\n▶ Đăng ${tag} lên GitHub Releases`);
const url = gh(
  "release",
  "create",
  tag,
  zip,
  `${zip}.sha256`,
  "--repo",
  REPO,
  "--target",
  head,
  "--title",
  `MASYS Video ${tag}`,
  "--notes-file",
  notesFile,
);
console.log(`\n✅ Đã phát hành ${tag}: ${url}`);
