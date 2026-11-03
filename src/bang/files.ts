import fs from "node:fs";
import path from "node:path";

// File của Bảng mới (spec v6.0 mục 17.3, D22): tool chép ảnh người dùng chọn vào thư mục dữ liệu,
// đặt tên riêng (không dùng tên gốc). Trong SQLite chỉ lưu tên file, không lưu đường dẫn tuyệt đối.

export const IMAGE_DIR = path.join("tep", "anh");
export const VIDEO_DIR = path.join("tep", "video");
/** Clip hook người dùng chọn (CON-74, D30). */
export const HOOK_DIR = path.join("tep", "hook");
/** Character sheet của các nhân vật (CON-77, D32): người dùng tự thêm, không đóng gói vào app. */
export const NHAN_VAT_DIR = path.join("tep", "nhan-vat");
/** Ảnh Muse tạo cho Bảng ảnh (CON-77, D31). */
export const ANH_TAO_DIR = path.join("tep", "anh-tao");

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

/** Clip hook tối đa 300 MB (D30). */
export const MAX_CLIP_BYTES = 300 * 1024 * 1024;

export type ClipExt = "mp4" | "mov" | "webm" | "mkv";

/** Nhận dạng clip hook theo vài byte đầu: MP4 / MOV (hộp ftyp), WEBM / MKV (EBML). */
export function sniffClip(data: Uint8Array): ClipExt | null {
  if (sniffVideo(data)) return ascii(data, 8, 12) === "qt  " ? "mov" : "mp4";
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return ascii(data, 0, Math.min(data.length, 64)).includes("webm") ? "webm" : "mkv";
  }
  return null;
}

/** Lý do không nhận clip hook; null = nhận được. */
export function clipProblem(data: Uint8Array): string | null {
  if (data.length === 0) return "File trống.";
  if (data.length > MAX_CLIP_BYTES) return `Clip quá lớn (${Math.round(data.length / 1024 / 1024)} MB), tối đa 300 MB. Cắt ngắn clip rồi chọn lại.`;
  if (!sniffClip(data)) return "Chỉ nhận clip MP4, MOV, WEBM hoặc MKV.";
  return null;
}

/** Lý do không nhận ảnh; null = nhận được. */
export function imageProblem(data: Uint8Array): string | null {
  if (data.length === 0) return "File trống.";
  if (data.length > MAX_IMAGE_BYTES) return `Ảnh quá lớn (${(data.length / 1024 / 1024).toFixed(1)} MB), tối đa 20 MB.`;
  if (!sniffImage(data)) return "Chỉ nhận ảnh JPG, PNG hoặc WEBP.";
  return null;
}

/** Tên file trong SQLite: chỉ chữ thường, số, gạch; không có thư mục. */
const SAFE_NAME = /^[a-z0-9-]+\.(jpg|png|webp|mp4|mov|webm|mkv)$/;
export const isSafeName = (name: string) => SAFE_NAME.test(name);
/** Clip hook: "<dòng>-hookclip-…". */
export const isClipName = (name: string) => isSafeName(name) && /^\d+-hookclip-/.test(name);
const IMAGE_EXT = /\.(jpg|png|webp)$/;
/** Character sheet: "nv<số>-…"; ảnh Muse tạo: "a<dòng>-truoc-…" / "a<dòng>-sau-…" (CON-77). */
export const isNhanVatName = (name: string) => isSafeName(name) && /^nv\d+-/.test(name) && IMAGE_EXT.test(name);
export const isAnhTaoName = (name: string) => isSafeName(name) && /^a\d+-(truoc|sau)-/.test(name) && IMAGE_EXT.test(name);

/** Thư mục chứa một file theo tên tool đặt: clip hook → tep\hook, video → tep\video, còn lại → tep\anh. */
export function dirOf(name: string): string {
  if (isClipName(name)) return HOOK_DIR;
  if (isNhanVatName(name)) return NHAN_VAT_DIR;
  if (isAnhTaoName(name)) return ANH_TAO_DIR;
  return name.endsWith(".mp4") ? VIDEO_DIR : IMAGE_DIR;
}

const randomPart = (now: Date) => `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

  /** Lưu clip hook đã kiểm tra (D30); trả tên file "<dòng>-hookclip-….<đuôi>". */
  saveClip(rowId: number, data: Uint8Array, now = new Date()): string {
    const ext = sniffClip(data);
    if (!ext) throw new Error("Không phải clip MP4 / MOV / WEBM / MKV");
    const name = `${rowId}-hookclip-${randomPart(now)}.${ext}`;
    fs.writeFileSync(path.join(this.dir(HOOK_DIR), name), data);
    return name;
  }

  /** Đường dẫn tuyệt đối của clip hook; undefined khi tên lạ hoặc file không còn. */
  clipPath(name: string): string | undefined {
    if (!isClipName(name)) return undefined;
    const p = path.join(this.dataDir, HOOK_DIR, name);
    return fs.existsSync(p) ? p : undefined;
  }

  /** Chỗ ghi bản video có hook: tep\video\<dòng>-hook-….mp4 (file chưa có). */
  newHookVideo(rowId: number, now = new Date()): { name: string; path: string } {
    const name = `${rowId}-hook-${randomPart(now)}.mp4`;
    return { name, path: path.join(this.dir(VIDEO_DIR), name) };
  }

  /** Thư mục tạm khi ghép hook (ảnh câu hook). */
  tmpDir(): string {
    return this.dir(path.join("tep", "tam"));
  }

  /** Xoá một file bất kỳ tool đã đặt tên (ảnh, video, clip hook). */
  removeAny(name: string | null | undefined): void {
    if (!name || !isSafeName(name)) return;
    fs.rmSync(path.join(this.dataDir, dirOf(name), name), { force: true });
  }

  /** Dung lượng một file ảnh / video / clip hook (byte); 0 khi không còn. */
  fileBytes(name: string | null | undefined): number {
    if (!name || !isSafeName(name)) return 0;
    const p = path.join(this.dataDir, dirOf(name), name);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  }

  /** Lưu character sheet đã kiểm tra (D32); trả tên file "nv<id>-….<đuôi>". */
  saveNhanVat(id: number, data: Uint8Array, now = new Date()): string {
    const ext = sniffImage(data);
    if (!ext) throw new Error("Không phải ảnh JPG / PNG / WEBP");
    const name = `nv${id}-${randomPart(now)}.${ext}`;
    fs.writeFileSync(path.join(this.dir(NHAN_VAT_DIR), name), data);
    return name;
  }

  /** Đường dẫn tuyệt đối của character sheet; undefined khi tên lạ hoặc file không còn. */
  nhanVatPath(name: string | null | undefined): string | undefined {
    if (!name || !isNhanVatName(name)) return undefined;
    const p = path.join(this.dataDir, NHAN_VAT_DIR, name);
    return fs.existsSync(p) ? p : undefined;
  }

  /** Lưu một ảnh Muse tạo cho dòng Bảng ảnh; trả tên file. Không phải ảnh thì báo lỗi. */
  saveAnhTao(rowId: number, side: "truoc" | "sau", data: Uint8Array, now = new Date()): string {
    if (data.length === 0) throw new Error("file ảnh trống");
    const ext = sniffImage(data);
    if (!ext) throw new Error("file tải về không phải ảnh JPG / PNG / WEBP");
    const name = `a${rowId}-${side}-${randomPart(now)}.${ext}`;
    fs.writeFileSync(path.join(this.dir(ANH_TAO_DIR), name), data);
    return name;
  }

  /** Đường dẫn tuyệt đối của ảnh Muse tạo; undefined khi tên lạ hoặc file không còn. */
  anhTaoPath(name: string): string | undefined {
    if (!isAnhTaoName(name)) return undefined;
    const p = path.join(this.dataDir, ANH_TAO_DIR, name);
    return fs.existsSync(p) ? p : undefined;
  }

  /** Tổng dung lượng (byte) các thư mục `subs`, để hiện "Đang dùng" (17.9). Mặc định: ảnh + video + clip hook của Bảng video. */
  usedBytes(subs: string[] = [IMAGE_DIR, VIDEO_DIR, HOOK_DIR]): number {
    let total = 0;
    for (const sub of subs) {
      const d = path.join(this.dataDir, sub);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) total += fs.statSync(path.join(d, f)).size;
    }
    return total;
  }
}

const CLIP_TYPE: Record<ClipExt, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" };

export function typeOf(name: string): string {
  const ext = name.split(".").pop() ?? "";
  return CLIP_TYPE[ext as ClipExt] ?? IMAGE_TYPE[ext as ImageExt] ?? "application/octet-stream";
}

/** 1,4 GB / 350 MB / 12 KB. */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
