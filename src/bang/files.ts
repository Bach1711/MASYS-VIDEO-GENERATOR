import fs from "node:fs";
import path from "node:path";

// File của Bảng mới (spec v6.0 mục 17.3, D22): tool chép ảnh người dùng chọn vào thư mục dữ liệu,
// đặt tên riêng (không dùng tên gốc). Trong SQLite chỉ lưu tên file, không lưu đường dẫn tuyệt đối.

export const IMAGE_DIR = path.join("tep", "anh");
export const VIDEO_DIR = path.join("tep", "video");

/** Mỗi ảnh tối đa 20 MB (17.2). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ImageExt = "jpg" | "png" | "webp";

export const IMAGE_TYPE: Record<ImageExt, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Nhận dạng ảnh theo vài byte đầu, không tin đuôi file hay loại trình duyệt báo. */
export function sniffImage(data: Uint8Array): ImageExt | null {
  const b = data;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  return null;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Video MP4 / MOV: hộp `ftyp` ở byte 4–8 (17.5 bước 7). */
export function sniffVideo(data: Uint8Array): boolean {
  return data.length >= 12 && ascii(data, 4, 8) === "ftyp";
}

/** Lý do không nhận ảnh; null = nhận được. */
export function imageProblem(data: Uint8Array): string | null {
  if (data.length === 0) return "File trống.";
  if (data.length > MAX_IMAGE_BYTES) return `Ảnh quá lớn (${(data.length / 1024 / 1024).toFixed(1)} MB), tối đa 20 MB.`;
  if (!sniffImage(data)) return "Chỉ nhận ảnh JPG, PNG hoặc WEBP.";
  return null;
}

/** Tên file trong SQLite: chỉ chữ thường, số, gạch; không có thư mục. */
const SAFE_NAME = /^[a-z0-9-]+\.(jpg|png|webp|mp4)$/;
export const isSafeName = (name: string) => SAFE_NAME.test(name);

export class BangFiles {
  constructor(private readonly dataDir: string) {}

  private dir(sub: string) {
    const d = path.join(this.dataDir, sub);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /** Lưu ảnh đã kiểm tra; trả tên file. `tag` ví dụ "12-mau-truoc". */
  saveImage(tag: string, data: Uint8Array, now = new Date()): string {
    const ext = sniffImage(data);
    if (!ext) throw new Error("Không phải ảnh JPG / PNG / WEBP");
    const name = `${tag}-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    fs.writeFileSync(path.join(this.dir(IMAGE_DIR), name), data);
    return name;
  }

  /** Đường dẫn tuyệt đối của ảnh; undefined khi tên lạ hoặc file không còn. */
  imagePath(name: string): string | undefined {
    if (!isSafeName(name)) return undefined;
    const p = path.join(this.dataDir, IMAGE_DIR, name);
    return fs.existsSync(p) ? p : undefined;
  }

  removeImage(name: string | null | undefined): void {
    if (!name || !isSafeName(name)) return;
    fs.rmSync(path.join(this.dataDir, IMAGE_DIR, name), { force: true });
  }

  /** Lưu video bot tải từ Muse (17.5 bước 6–7); trả tên file. Không phải video hoặc trống thì báo lỗi. */
  saveVideo(rowId: number, data: Uint8Array, now = new Date()): string {
    if (data.length === 0) throw new Error("file video trống");
    if (!sniffVideo(data)) throw new Error("file tải về không phải video MP4");
    const name = `${rowId}-video-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}.mp4`;
    fs.writeFileSync(path.join(this.dir(VIDEO_DIR), name), data);
    return name;
  }

  /** Đường dẫn tuyệt đối của video; undefined khi tên lạ hoặc file không còn. */
  videoPath(name: string): string | undefined {
    if (!isSafeName(name) || !name.endsWith(".mp4")) return undefined;
    const p = path.join(this.dataDir, VIDEO_DIR, name);
    return fs.existsSync(p) ? p : undefined;
  }

  removeVideo(name: string | null | undefined): void {
    if (!name || !isSafeName(name) || !name.endsWith(".mp4")) return;
    fs.rmSync(path.join(this.dataDir, VIDEO_DIR, name), { force: true });
  }

  /** Dung lượng một file ảnh / video (byte); 0 khi không còn. */
  fileBytes(name: string | null | undefined): number {
    if (!name || !isSafeName(name)) return 0;
    const p = path.join(this.dataDir, name.endsWith(".mp4") ? VIDEO_DIR : IMAGE_DIR, name);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  }

  /** Tổng dung lượng ảnh + video (byte), để hiện "Đang dùng" (17.9). */
  usedBytes(): number {
    let total = 0;
    for (const sub of [IMAGE_DIR, VIDEO_DIR]) {
      const d = path.join(this.dataDir, sub);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) total += fs.statSync(path.join(d, f)).size;
    }
    return total;
  }
}

export function typeOf(name: string): string {
  const ext = name.split(".").pop() as ImageExt | "mp4";
  return ext === "mp4" ? "video/mp4" : IMAGE_TYPE[ext] ?? "application/octet-stream";
}

/** 1,4 GB / 350 MB / 12 KB. */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
