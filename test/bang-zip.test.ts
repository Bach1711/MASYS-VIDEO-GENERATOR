import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { Window, type HTMLInputElement } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BangFiles } from "../src/bang/files.js";
import { addRow, setHookVideo, setRowVideo } from "../src/bang/rows.js";
import { insertBangBatch, planBangBatch } from "../src/bang/run.js";
import { planZip, zipName, zipStream, type ZipEntry } from "../src/bang/zip.js";
import { getSettings } from "../src/db/settings.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { createApp } from "../src/web/app.js";

// CON-112: Bỏ chọn, giữ dòng đã chọn khi đổi trang, tải các dòng đã chọn thành một file zip.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const mp4 = (tag: string) => new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from(tag)]);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "masys-zip-"));
  dirs.push(d);
  return d;
};

/** Đọc file zip theo mục lục ở cuối file (như Explorer / 7-Zip), kiểm tra CRC từng file. */
function readZip(buf: Buffer): { name: string; data: Buffer; flags: number }[] {
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer; flags: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const flags = buf.readUInt16LE(p + 8);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    expect(buf.readUInt32LE(local + 14)).toBe(crc);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    expect(zlib.crc32(data) >>> 0).toBe(crc);
    out.push({ name, data, flags });
    p += 46 + nameLen + extraLen;
  }
  return out;
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

describe("file zip (STORE)", () => {
  it("gom nhiều file, tên tiếng Việt UTF-8, CRC đúng, dung lượng biết trước khớp với file thật", async () => {
    const d = tmp();
    const entries: ZipEntry[] = ["a", "bb", "ccc"].map((t, i) => {
      const p = path.join(d, `${t}.mp4`);
      fs.writeFileSync(p, Buffer.alloc(1000 * (i + 1), t));
      return { name: i === 2 ? "Người mẫu 03.mp4" : `MASYS_${i + 1}.mp4`, path: p, size: 1000 * (i + 1), mtime: new Date(2026, 10, 9, 15, 30, 10) };
    });
    const { stream, size } = zipStream(entries);
    const buf = await collect(stream);
    expect(buf.length).toBe(size);
    const files = readZip(buf);
    expect(files.map((f) => f.name)).toEqual(["MASYS_1.mp4", "MASYS_2.mp4", "Người mẫu 03.mp4"]);
    expect(files.every((f) => f.flags & 0x0800)).toBe(true);
    expect(files[2]!.data.equals(Buffer.alloc(3000, "ccc"))).toBe(true);
  });

  it("tổng trên 4 GB: thêm bản ghi ZIP64 (chỉ tính chỗ, không đọc file)", () => {
    const e = (i: number): ZipEntry => ({ name: `v${i}.mp4`, path: "x", size: 1_500_000_000, mtime: new Date() });
    const small = planZip([e(1), e(2)]);
    const big = planZip([e(1), e(2), e(3), e(4)]);
    // 2 file: không cần ZIP64 → mục lục 2 × (46 + 6), cuối file 22 byte.
    expect(small.total).toBe(2 * (30 + 6 + 1_500_000_000) + 2 * 52 + 22);
    // File thứ 4 nằm sau mốc 4 GB → mục lục của nó có thêm 12 byte ZIP64; cuối file thêm 56 + 20 byte.
    expect(big.total).toBe(4 * (30 + 6 + 1_500_000_000) + 4 * 52 + 12 + 56 + 20 + 22);
  });

  it("tên file zip: Video nguoi mau <ngày> <giờ>.zip", () => {
    expect(zipName(new Date(2026, 10, 9, 15, 30))).toBe("Video nguoi mau 09-11-2026 1530.zip");
  });
});

function setupApp(rows: number) {
  const dataDir = tmp();
  const files = new BangFiles(dataDir);
  const db = openDatabase(":memory:");
  for (let i = 1; i <= rows; i++) addRow(db, { prompt: `dòng ${i}`, modelFront: files.saveImage(`${i}-mau-truoc`, PNG) });
  const app = createApp(loadConfig({ MASYS_DATA_DIR: dataDir }), db);
  const giveVideo = (id: number) => {
    const name = files.saveVideo(id, mp4(`row${id}`));
    setRowVideo(db, id, name, 30, "2026-11-09T08:30:00Z");
    return name;
  };
  return { app, db, files, giveVideo };
}

describe("Tải các dòng đã chọn thành một file zip (CON-112)", () => {
  it("xem trước: đếm video, bỏ qua dòng chưa có video hoặc không còn; cần header riêng", async () => {
    const { app, giveVideo } = setupApp(3);
    giveVideo(1);
    giveVideo(3);
    const H = { "X-Masys": "1", "Content-Type": "application/json" };
    expect((await app.request("/bang-moi/tai-zip/xem", { method: "POST", body: JSON.stringify({ rows: [1] }) })).status).toBe(403);
    const r = await (await app.request("/bang-moi/tai-zip/xem", { method: "POST", headers: H, body: JSON.stringify({ rows: [3, 2, 1, 99] }) })).json();
    expect(r).toMatchObject({ ok: true, count: 2, skipped: [2, 99] });
  });

  it("một file zip có đủ video đúng tên; dòng có hook lấy bản có hook; trang khác gửi tới bị chặn", async () => {
    const { app, db, files, giveVideo } = setupApp(3);
    giveVideo(1);
    giveVideo(2);
    const hook = files.newHookVideo(2);
    fs.writeFileSync(hook.path, mp4("hook2"));
    setHookVideo(db, 2, hook.name, 30);
    const form = (site: string) =>
      app.request("/bang-moi/tai-zip", { method: "POST", headers: { "Sec-Fetch-Site": site }, body: new URLSearchParams({ ids: "1,2,3" }) });
    expect((await form("cross-site")).status).toBe(403);
    const res = await form("same-origin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="Video nguoi mau \d\d-\d\d-\d{4} \d{4}\.zip"/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(Number(res.headers.get("content-length"))).toBe(buf.length);
    const list = readZip(buf);
    expect(list.map((f) => f.name)).toEqual(["Video 01.mp4", "Video 02.mp4"]);
    expect(list[0]!.data.equals(Buffer.from(mp4("row1")))).toBe(true);
    expect(list[1]!.data.equals(Buffer.from(mp4("hook2")))).toBe(true);
  });

  it("không dòng nào có video: báo rõ, không trả file", async () => {
    const { app } = setupApp(2);
    const res = await app.request("/bang-moi/tai-zip", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" }, body: new URLSearchParams({ ids: "1,2" }) });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("chưa có video");
  });
});

/** Mở trang Bảng trong trình duyệt giả; `stored` = sessionStorage của tab (giữ qua các lần đổi trang). */
async function openBoard(html: string, stored: string | null) {
  const window = new Window({ url: "http://localhost:4310/bang-moi", settings: { enableJavaScriptEvaluation: true } });
  if (stored != null) window.sessionStorage.setItem("bangMoiChon", stored);
  const document = window.document;
  document.write(html);
  await window.happyDOM.waitUntilComplete();
  const box = (id: number) => document.querySelector(`input.pick-row[value="${id}"]`) as unknown as HTMLInputElement;
  const $ = (id: string) => document.getElementById(id) as unknown as HTMLInputElement;
  const tick = (id: number, on = true) => {
    box(id).checked = on;
    box(id).dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  const click = (id: string) => $(id).dispatchEvent(new window.Event("click", { bubbles: true }));
  const stored_ = () => window.sessionStorage.getItem("bangMoiChon");
  const ticked = () => Array.from(document.querySelectorAll("input.pick-row")).filter((c) => (c as unknown as HTMLInputElement).checked).map((c) => Number((c as unknown as HTMLInputElement).value));
  return { window, box, $, tick, click, stored: stored_, ticked };
}

describe("Giữ dòng đã chọn khi đổi trang, Bỏ chọn (CON-112)", () => {
  it("tích ở trang 2, sang trang 1 tích thêm, quay lại trang 2 vẫn còn; Bỏ chọn bỏ hết mọi trang", async () => {
    const { app } = setupApp(60); // 50 dòng / trang: trang 1 = dòng 60…11, trang 2 = dòng 10…1
    const page1 = await (await app.request("/bang-moi")).text();
    const page2 = await (await app.request("/bang-moi?trang=2")).text();
    expect(page1).toContain('id="selNone"');

    const a = await openBoard(page2, null);
    expect(a.$("selNone").disabled).toBe(true);
    a.tick(3);
    a.tick(5);
    expect(a.$("selCount").textContent).toBe("Đã chọn 2 dòng.");
    expect(a.$("selNone").disabled).toBe(false);

    const b = await openBoard(page1, a.stored());
    expect(b.ticked()).toEqual([]);
    b.tick(40);
    expect(b.$("selCount").textContent).toBe("Đã chọn 3 dòng (gồm 2 dòng ở trang khác).");
    expect(b.$("dlBtn").disabled).toBe(false);

    const c = await openBoard(page2, b.stored());
    expect(c.ticked().sort((x, y) => x - y)).toEqual([3, 5]);
    expect(JSON.parse(c.stored()!).sort((x: number, y: number) => x - y)).toEqual([3, 5, 40]);

    // Chọn tất cả (trang này) chỉ thêm dòng của trang này, không bỏ dòng ở trang khác.
    c.click("selAll");
    expect(JSON.parse(c.stored()!).length).toBe(11);
    c.click("selNone");
    expect(c.ticked()).toEqual([]);
    expect(c.stored()).toBe("[]");
    expect(c.$("selNone").disabled).toBe(true);
    expect(c.$("dlBtn").disabled).toBe(true);

    const d = await openBoard(page1, c.stored());
    expect(d.ticked()).toEqual([]);
  });

  it("dòng đang tạo video tự rời danh sách đã chọn", async () => {
    const { app, db } = setupApp(3);
    insertBangBatch(db, "", planBangBatch(db, [2], getSettings(db), "").runs);
    const html = await (await app.request("/bang-moi")).text();
    const p = await openBoard(html, "[1,2]");
    expect(p.ticked()).toEqual([1]);
    expect(p.stored()).toBe("[1]");
  });
});
