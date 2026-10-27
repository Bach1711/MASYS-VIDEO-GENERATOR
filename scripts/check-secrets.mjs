// Tiêu chí §12.11: repo, log, SQLite không chứa khoá service account hay cookie Meta.
// Chạy: op run --env-file=.env -- npm run check-secrets [-- file-log-khác ... | file.zip ...]
// File .zip (bản phát hành, D15) được giải nén ra thư mục tạm rồi quét từng file, kèm kiểm tra tên file cấm.
// Có khoá thật trong biến môi trường thì so cả nguyên văn khoá. Không bao giờ in giá trị tìm thấy, chỉ in tên file và dòng.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Mẫu tìm bí mật. PEM thật có thân base64 dài; khoá giả ngắn trong test không bị tính. */
export const PATTERNS = [
  { name: "khoá riêng PEM (service account)", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=\\\s]{200,}/ },
  { name: "token truy cập Google", re: /\bya29\.[0-9A-Za-z_-]{20,}/ },
  { name: "cookie Meta", re: /\b(?:c_user|xs|datr)=[A-Za-z0-9%:._-]{10,}/ },
  { name: "cookie Meta (dạng JSON)", re: /"name"\s*:\s*"(?:c_user|xs|datr)"/ },
];

/** Các đoạn của khoá thật (nếu chạy qua op run) để so nguyên văn. */
export function secretsFromEnv(env = process.env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.trim().startsWith("op://")) return [];
  try {
    const sa = JSON.parse(raw);
    const out = [];
    if (typeof sa.private_key_id === "string" && sa.private_key_id.length >= 16) out.push({ name: "mã khoá service account", value: sa.private_key_id });
    if (typeof sa.private_key === "string") {
      const body = sa.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
      if (body.length >= 120) out.push({ name: "khoá service account thật", value: body.slice(60, 120) });
    }
    return out;
  } catch {
    return [];
  }
}

/** Trả về danh sách {pattern, line} tìm thấy trong một đoạn văn bản. */
export function findSecrets(text, literals = []) {
  const hits = [];
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m) hits.push({ pattern: p.name, line: lineOf(m.index) });
  }
  for (const s of literals) {
    const i = text.indexOf(s.value);
    if (i >= 0) hits.push({ pattern: s.name, line: lineOf(i) });
  }
  return hits;
}

function dataDir(env = process.env) {
  if (env.MASYS_DATA_DIR) return path.resolve(env.MASYS_DATA_DIR);
  return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share"), "masys-video");
}

/** Mọi file trong thư mục dữ liệu trừ hồ sơ bot (chứa phiên Muse theo thiết kế) và ảnh chụp. */
function dataFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "bot-profile" || e.name === "screenshots") continue;
      out.push(...dataFiles(path.join(dir, e.name)));
    } else out.push(path.join(dir, e.name));
  }
  return out;
}

/** File không bao giờ được nằm trong zip phát hành (D15). Đường dẫn dùng dấu /. */
export const FORBIDDEN_IN_ZIP = [
  { name: "file .env", re: /(^|\/)\.env(\.|$)/ },
  { name: "cơ sở dữ liệu SQLite", re: /\.(db|sqlite3?)(-wal|-shm|-journal)?$/ },
  { name: "khoá Google đã lưu", re: /google-key\.dpapi/ },
  { name: "file khoá", re: /\.(pem|p12|pfx|key)$|(^|\/)(credentials|client_secret|token)[^/]*\.json$/ },
  { name: "hồ sơ bot / ảnh chụp", re: /(^|\/)(bot-profile|screenshots)\// },
  { name: "mã nguồn TypeScript", re: /^(?!.*\/node_modules\/).*(?<!\.d)\.tsx?$/ },
  { name: "thư mục test", re: /^[^/]+\/app\/test\// },
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Giải nén zip bằng tar có sẵn của Windows (bsdtar đọc được zip). */
function extractZip(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-zip-"));
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-xf", path.resolve(zip), "-C", dir]);
  return dir;
}

export function run({ root, env = process.env, extra = [], repo = true, data = true }) {
  const literals = secretsFromEnv(env);
  const files = [];
  const findings = [];
  const tmpDirs = [];
  for (const zip of extra.filter((f) => f.toLowerCase().endsWith(".zip"))) {
    const dir = extractZip(zip);
    tmpDirs.push(dir);
    for (const f of walk(dir)) {
      const rel = path.relative(dir, f).split(path.sep).join("/");
      for (const bad of FORBIDDEN_IN_ZIP) {
        if (bad.re.test(rel)) findings.push({ group: "zip", file: `${path.basename(zip)}!${rel}`, line: 0, pattern: bad.name });
      }
      files.push({ group: "zip", file: f, label: `${path.basename(zip)}!${rel}` });
    }
  }
  extra = extra.filter((f) => !f.toLowerCase().endsWith(".zip"));
  if (repo) {
    const list = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
    for (const f of list.split("\0").filter(Boolean)) files.push({ group: "repo", file: path.join(root, f) });
  }
  if (data) for (const f of dataFiles(dataDir(env))) files.push({ group: "dữ liệu", file: f });
  for (const f of extra) files.push({ group: "log", file: path.resolve(f) });

  for (const { group, file, label } of files) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    // latin1 giữ nguyên từng byte: đọc được cả file SQLite nhị phân.
    const text = fs.readFileSync(file).toString("latin1");
    for (const h of findSecrets(text, literals)) findings.push({ group, file: label ?? file, ...h });
  }
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  return { scanned: files.length, findings, comparedRealKey: literals.length > 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = run({ root, extra: process.argv.slice(2) });
  console.log(`Đã quét ${r.scanned} file (repo, thư mục dữ liệu ${dataDir()}${process.argv.length > 2 ? ", log/zip" : ""}).`);
  console.log(r.comparedRealKey ? "Có so nguyên văn với khoá thật (chạy qua op run)." : "Không có khoá thật trong biến môi trường: chỉ dò theo mẫu.");
  if (r.findings.length === 0) {
    console.log("✅ Không thấy khoá service account hay cookie Meta.");
  } else {
    for (const f of r.findings) console.log(`❌ [${f.group}] ${f.group === "zip" ? f.file : path.relative(root, f.file) || f.file}${f.line ? `:${f.line}` : ""} — ${f.pattern}`);
    process.exitCode = 1;
  }
}
