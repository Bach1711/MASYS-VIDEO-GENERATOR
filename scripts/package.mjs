// Đóng gói bản phát hành cho người trong đội (spec D15, D16):
//   release/MASYS-Video-vX.Y.Z-win64.zip
//   └─ MASYS-Video\  Mo-MASYS.bat · HUONG-DAN.txt
//      └─ phien-ban\  hien-tai.txt ("X.Y.Z") · X.Y.Z\node\node.exe · X.Y.Z\app\ (dist + thư viện production)
// Cùng một zip dùng cho cài mới và cho nút Cập nhật trong tool (tool chỉ lấy thư mục phien-ban\X.Y.Z).
// Chạy: npm run package. Không cần op run: gói không chứa khoá, và check-secrets quét lại zip trước khi xong.
// Chỉ để chạy thử: npm run package -- --version 9.9.9 (đóng gói với số phiên bản khác package.json).
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run as checkSecrets } from "./check-secrets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const vArg = process.argv.indexOf("--version");
const version = vArg > 0 ? process.argv[vArg + 1] : pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`Số phiên bản không hợp lệ: ${version}`);
// Node đi kèm phải đúng bản đang chạy lệnh này: better-sqlite3 được cài (bản dựng sẵn) cho đúng ABI của nó.
const nodeVersion = process.version;
const releaseDir = path.join(root, "release");
const cacheDir = path.join(releaseDir, "cache");
const stage = path.join(releaseDir, "stage");
const appRoot = path.join(stage, "MASYS-Video");
const verRoot = path.join(appRoot, "phien-ban", version);
const zipName = `MASYS-Video-v${version}-win64.zip`;
const zipPath = path.join(releaseDir, zipName);
const systemTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");

const step = (msg) => console.log(`\n▶ ${msg}`);
const sh = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

if (process.platform !== "win32") throw new Error("Chỉ đóng gói trên Windows (bản zip dành cho Windows, cần tar.exe của Windows).");

async function nodeExe() {
  const base = `node-${nodeVersion}-win-x64`;
  const zip = path.join(cacheDir, `${base}.zip`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const dist = `https://nodejs.org/dist/${nodeVersion}`;
  const sums = await (await fetch(`${dist}/SHASUMS256.txt`)).text();
  const expected = sums.split("\n").find((l) => l.endsWith(`  ${base}.zip`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`Không tìm thấy mã kiểm tra cho ${base}.zip trên nodejs.org`);
  if (!fs.existsSync(zip) || sha256(zip) !== expected) {
    console.log(`  tải ${base}.zip …`);
    const r = await fetch(`${dist}/${base}.zip`);
    if (!r.ok) throw new Error(`Tải Node lỗi: HTTP ${r.status}`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  }
  if (sha256(zip) !== expected) throw new Error("File Node tải về sai mã kiểm tra SHA-256, dừng đóng gói.");
  const out = path.join(cacheDir, base);
  if (!fs.existsSync(path.join(out, "node.exe"))) execFileSync(systemTar, ["-xf", zip, "-C", cacheDir]);
  return out;
}

step(`Đóng gói MASYS Video v${version} (Node ${nodeVersion})`);
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
fs.mkdirSync(path.join(verRoot, "node"), { recursive: true });
fs.mkdirSync(path.join(verRoot, "app"), { recursive: true });

step("Dựng code (tsc)");
sh("npm run build");
fs.cpSync(path.join(root, "dist"), path.join(verRoot, "app", "dist"), { recursive: true });

step("Cài thư viện production");
// Chỉ giữ phần cần để chạy; bỏ scripts/devDependencies để npm ci không chạy gì của môi trường phát triển.
const appPkg = { name: pkg.name, version, private: true, description: pkg.description, type: pkg.type, engines: pkg.engines, dependencies: pkg.dependencies };
fs.writeFileSync(path.join(verRoot, "app", "package.json"), JSON.stringify(appPkg, null, 2) + "\n");
fs.copyFileSync(path.join(root, "package-lock.json"), path.join(verRoot, "app", "package-lock.json"));
// --ignore-scripts: better-sqlite3 đã kèm bản dựng sẵn (prebuilds/win32-x64.node); không để npm tự gọi node-gyp.
sh("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", path.join(verRoot, "app"));

step("Thêm Node chạy liền");
const nodeDir = await nodeExe();
fs.copyFileSync(path.join(nodeDir, "node.exe"), path.join(verRoot, "node", "node.exe"));
fs.copyFileSync(path.join(nodeDir, "LICENSE"), path.join(verRoot, "node", "LICENSE"));

step("Thêm Mo-MASYS.bat, HUONG-DAN.txt, phien-ban\\hien-tai.txt");
// Không xuống dòng: Mo-MASYS.bat đọc bằng "set /p".
fs.writeFileSync(path.join(appRoot, "phien-ban", "hien-tai.txt"), version);
fs.copyFileSync(path.join(root, "packaging", "Mo-MASYS.bat"), path.join(appRoot, "Mo-MASYS.bat"));
const guide = fs.readFileSync(path.join(root, "packaging", "HUONG-DAN.txt"), "utf8").replaceAll("VERSION", version);
// BOM để Notepad bản cũ hiện đúng tiếng Việt.
fs.writeFileSync(path.join(appRoot, "HUONG-DAN.txt"), "\uFEFF" + guide.replace(/\r?\n/g, "\r\n"));

step("Thử Node đi kèm nạp được better-sqlite3");
execFileSync(path.join(verRoot, "node", "node.exe"), ["-e", "new (require('better-sqlite3'))(':memory:').close()"], {
  cwd: path.join(verRoot, "app"),
  stdio: "inherit",
});

step(`Nén ${zipName}`);
fs.rmSync(zipPath, { force: true });
execFileSync(systemTar, ["-a", "-c", "-f", zipPath, "-C", stage, "MASYS-Video"]);
const hash = sha256(zipPath);
fs.writeFileSync(`${zipPath}.sha256`, `${hash}  ${zipName}\n`);

step("Quét bí mật và file cấm trong zip");
const r = checkSecrets({ root, extra: [zipPath], repo: false, data: false });
if (r.findings.length) {
  for (const f of r.findings) console.log(`❌ ${f.file} — ${f.pattern}`);
  fs.rmSync(zipPath, { force: true });
  fs.rmSync(`${zipPath}.sha256`, { force: true });
  throw new Error("Zip có bí mật hoặc file cấm: đã xoá zip, không phát hành.");
}
console.log(`✅ Đã quét ${r.scanned} file trong zip: sạch.`);

const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n✅ Xong: ${path.relative(root, zipPath)} (${mb} MB)\n   SHA-256: ${hash}`);
