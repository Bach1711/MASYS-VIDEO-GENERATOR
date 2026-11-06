/**
 * Chạy thật CON-99 (tốn lượt Muse, chỉ chạy khi người phụ trách đồng ý và không dùng tool):
 *   npx tsx test/live/mat-anh.live.ts <số lô> <số ảnh mỗi lô>
 * Tạo Bảng ảnh trong một thư mục tạm, dùng hồ sơ bot thật qua junction, ảnh nhân vật chép từ dữ liệu thật. Không ghi gì vào
 * dữ liệu thật của tool. In kết quả từng lượt.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { addNhanVat } from "../../src/anh/nhanVat.js";
import { addRow } from "../../src/anh/rows.js";
import { insertAnhBatch, planAnhBatch } from "../../src/anh/run.js";
import { BangFiles } from "../../src/bang/files.js";
import { MuseBot } from "../../src/bot/museBot.js";
import { DEFAULT_MUSE_URL } from "../../src/bot/museSelectors.js";
import { openDatabase } from "../../src/db/index.js";
import { getImageQuota } from "../../src/db/quota.js";
import { getSettings } from "../../src/db/settings.js";
import { BatchRunner } from "../../src/queue/runner.js";

const lots = Number(process.argv[2] ?? 3);
const perLot = Number(process.argv[3] ?? 4);
const real = path.join(process.env.LOCALAPPDATA!, "masys-video");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "masys-live-"));
const profile = path.join(tmp, "bot-profile");
execFileSync("cmd", ["/c", "mklink", "/J", profile, path.join(real, "bot-profile")], { stdio: "ignore" });

const source = new Database(path.join(real, "data.db"), { readonly: true });
if (source.prepare("SELECT id FROM batches WHERE status = 'running'").all().length) throw new Error("Tool đang chạy một lô");
const nvs = source.prepare("SELECT ten, file, faceFile FROM nhan_vat WHERE faceFile IS NOT NULL AND deletedAt IS NULL ORDER BY id DESC LIMIT 3").all() as { ten: string; file: string; faceFile: string }[];
source.close();

const db = openDatabase(":memory:");
const files = new BangFiles(tmp);
const read = (f: string) => new Uint8Array(fs.readFileSync(path.join(real, "tep", "nhan-vat", f)));
const ids = nvs.map((n) => addNhanVat(db, n.ten, (id) => ({ file: files.saveNhanVat(id, read(n.file)), bytes: 1, faceFile: files.saveNhanVat(id, read(n.faceFile)), faceBytes: 1 })));

const bot = new MuseBot({ profileDir: profile, screenshotDir: path.join(tmp, "screenshots"), museUrl: () => DEFAULT_MUSE_URL });
const runner = new BatchRunner(db, undefined, undefined, bot, { bangFiles: files });
db.prepare("UPDATE settings SET parallelVideos = 3, pauseMinSec = 20, pauseMaxSec = 40, timeoutMinutes = 8 WHERE id = 1").run();

const SCENES = ["đứng trước bức tường màu xanh và cười nhẹ", "ngồi trên ghế gỗ trong phòng sáng", "đi dạo trên phố vào buổi sáng", "đứng cạnh cửa sổ lớn nhìn ra ngoài"];
try {
  for (let lot = 1; lot <= lots; lot++) {
    const rows = Array.from({ length: perLot }, (_, i) => addRow(db, { nhanVatId: ids[i % ids.length]!, prompt: SCENES[i % SCENES.length]! }));
    const batchId = insertAnhBatch(db, "", planAnhBatch(db, rows, getSettings(db), "").runs);
    const started = Date.now();
    runner.start(batchId);
    await runner.idle();
    const runs = db.prepare("SELECT id, state, attempt, anhBaseline, error FROM runs WHERE batchId = ? ORDER BY id").all(batchId);
    console.log(`LÔ ${lot}: ${Math.round((Date.now() - started) / 1000)} giây`, JSON.stringify(db.prepare("SELECT status, pauseReason FROM batches WHERE id = ?").get(batchId)));
    console.table(runs);
  }
  console.log("Lượt ảnh đã dùng:", getImageQuota(db).used);
  const notes = db.prepare("SELECT runId, message FROM run_events WHERE message LIKE 'Tab %' OR message LIKE 'Thất bại%' ORDER BY id").all();
  console.log("Sự kiện đáng chú ý:", notes.length ? notes : "không có");
} finally {
  await bot.close();
  fs.rmdirSync(profile); // Junction: chỉ gỡ liên kết, không đụng hồ sơ thật.
  fs.rmSync(tmp, { recursive: true, force: true });
}
