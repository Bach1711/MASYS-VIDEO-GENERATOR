import fs from "node:fs";
import { Readable } from "node:stream";
import zlib from "node:zlib";

// File zip "lưu nguyên" (STORE, không nén lại) cho "Tải các dòng đã chọn" (CON-112). Video MP4 đã nén sẵn nên nén thêm
// chỉ tốn thời gian. Viết dần ra luồng: không giữ cả file trong bộ nhớ. Tên file UTF-8 (cờ bit 11) để tên tiếng Việt
// đúng trong Windows. Tổng trên 4 GB thì dùng ZIP64. CRC tính trước khi viết từng file nên header có đủ kích thước:
// Explorer, 7-Zip, WinRAR đều mở được, và biết trước tổng dung lượng (Content-Length) để Chrome hiện tiến độ.

export interface ZipEntry {
  /** Tên trong zip, ví dụ "MASYS_12_20261109-1530.mp4". */
  name: string;
  /** Đường dẫn file trên máy. */
  path: string;
  size: number;
  mtime: Date;
}

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

interface Placed extends ZipEntry {
  nameBuf: Buffer;
  offset: number;
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const localSize = (p: { nameBuf: Buffer }) => 30 + p.nameBuf.length;
const needs64 = (p: Placed) => p.size >= MAX32 || p.offset >= MAX32;
/** Trường ZIP64 trong mục lục: chỉ các giá trị bị tràn, theo thứ tự kích thước gốc, kích thước nén, vị trí. */
function zip64Extra(p: Placed): Buffer {
  const vals: number[] = [];
  if (p.size >= MAX32) vals.push(p.size, p.size);
  if (p.offset >= MAX32) vals.push(p.offset);
  if (!vals.length) return Buffer.alloc(0);
  const b = Buffer.alloc(4 + vals.length * 8);
  b.writeUInt16LE(0x0001, 0);
  b.writeUInt16LE(vals.length * 8, 2);
  vals.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 4 + i * 8));
  return b;
}

function localHeader(p: Placed, crc: number): Buffer {
  const { time, date } = dosTime(p.mtime);
  const big = p.size >= MAX32;
  const b = Buffer.alloc(30);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(big ? 45 : 20, 4);
  b.writeUInt16LE(0x0800, 6); // tên UTF-8
  b.writeUInt16LE(0, 8); // STORE
  b.writeUInt16LE(time, 10);
  b.writeUInt16LE(date, 12);
  b.writeUInt32LE(crc >>> 0, 14);
  b.writeUInt32LE(big ? MAX32 : p.size, 18);
  b.writeUInt32LE(big ? MAX32 : p.size, 22);
  b.writeUInt16LE(p.nameBuf.length, 26);
  b.writeUInt16LE(0, 28);
  // Một video không bao giờ tới 4 GB; nếu có, mục lục (ZIP64) vẫn ghi đúng kích thước.
  return Buffer.concat([b, p.nameBuf]);
}

function centralHeader(p: Placed, crc: number): Buffer {
  const { time, date } = dosTime(p.mtime);
  const extra = zip64Extra(p);
  const b = Buffer.alloc(46);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(45, 4);
  b.writeUInt16LE(needs64(p) ? 45 : 20, 6);
  b.writeUInt16LE(0x0800, 8);
  b.writeUInt16LE(0, 10);
  b.writeUInt16LE(time, 12);
  b.writeUInt16LE(date, 14);
  b.writeUInt32LE(crc >>> 0, 16);
  b.writeUInt32LE(p.size >= MAX32 ? MAX32 : p.size, 20);
  b.writeUInt32LE(p.size >= MAX32 ? MAX32 : p.size, 24);
  b.writeUInt16LE(p.nameBuf.length, 28);
  b.writeUInt16LE(extra.length, 30);
  b.writeUInt16LE(0, 32);
  b.writeUInt16LE(0, 34);
  b.writeUInt16LE(0, 36);
  b.writeUInt32LE(0, 38);
  b.writeUInt32LE(p.offset >= MAX32 ? MAX32 : p.offset, 42);
  return Buffer.concat([b, p.nameBuf, extra]);
}

function centralSize(p: Placed): number {
  return 46 + p.nameBuf.length + zip64Extra(p).length;
}

function endRecords(count: number, cdOffset: number, cdSize: number): Buffer {
  const big = count >= MAX16 || cdOffset >= MAX32 || cdSize >= MAX32;
  const parts: Buffer[] = [];
  if (big) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(44n, 4);
    z.writeUInt16LE(45, 12);
    z.writeUInt16LE(45, 14);
    z.writeUInt32LE(0, 16);
    z.writeUInt32LE(0, 20);
    z.writeBigUInt64LE(BigInt(count), 24);
    z.writeBigUInt64LE(BigInt(count), 32);
    z.writeBigUInt64LE(BigInt(cdSize), 40);
    z.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeUInt32LE(0, 4);
    loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    loc.writeUInt32LE(1, 16);
    parts.push(z, loc);
  }
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(0, 4);
  e.writeUInt16LE(0, 6);
  e.writeUInt16LE(big ? MAX16 : count, 8);
  e.writeUInt16LE(big ? MAX16 : count, 10);
  e.writeUInt32LE(big ? MAX32 : cdSize, 12);
  e.writeUInt32LE(big ? MAX32 : cdOffset, 16);
  e.writeUInt16LE(0, 20);
  parts.push(e);
  return Buffer.concat(parts);
}

async function crcOf(file: string): Promise<number> {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) crc = zlib.crc32(chunk as Buffer, crc);
  return crc;
}

/** Xếp chỗ các file trong zip; trả tổng số byte của file zip (biết trước, không cần đọc file). */
export function planZip(entries: ZipEntry[]): { placed: Placed[]; total: number; cdOffset: number; cdSize: number } {
  let offset = 0;
  const placed = entries.map((e) => {
    const p: Placed = { ...e, nameBuf: Buffer.from(e.name, "utf8"), offset };
    offset += localSize(p) + e.size;
    return p;
  });
  const cdSize = placed.reduce((n, p) => n + centralSize(p), 0);
  const total = offset + cdSize + endRecords(placed.length, offset, cdSize).length;
  return { placed, total, cdOffset: offset, cdSize };
}

async function* zipChunks(entries: ZipEntry[]): AsyncGenerator<Buffer> {
  const { placed, cdOffset, cdSize } = planZip(entries);
  const crcs: number[] = [];
  for (const p of placed) {
    const crc = await crcOf(p.path);
    crcs.push(crc);
    yield localHeader(p, crc);
    let written = 0;
    for await (const chunk of fs.createReadStream(p.path, { highWaterMark: 1 << 20 })) {
      const buf = chunk as Buffer;
      // File bị đổi giữa chừng: cắt / không viết quá kích thước đã báo, để zip không hỏng cấu trúc.
      const room = p.size - written;
      if (room <= 0) break;
      const part = buf.length > room ? buf.subarray(0, room) : buf;
      written += part.length;
      yield part;
    }
    if (written < p.size) throw new Error(`File ${p.name} ngắn hơn lúc bắt đầu tải`);
  }
  yield Buffer.concat(placed.map((p, i) => centralHeader(p, crcs[i] ?? 0)));
  yield endRecords(placed.length, cdOffset, cdSize);
}

/** Luồng file zip (Node Readable) và tổng dung lượng. */
export function zipStream(entries: ZipEntry[]): { stream: Readable; size: number } {
  return { stream: Readable.from(zipChunks(entries)), size: planZip(entries).total };
}

/** Tên file zip (người phụ trách chọn 09/11/2026): "Video nguoi mau <dd-mm-yyyy> <HHmm>.zip", theo giờ máy. */
export function zipName(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `Video nguoi mau ${two(now.getDate())}-${two(now.getMonth() + 1)}-${now.getFullYear()} ${two(now.getHours())}${two(now.getMinutes())}.zip`;
}
