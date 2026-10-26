import type { DriveClient, DriveFile } from "../google/drive.js";
import type { Bytes } from "../google/http.js";

/**
 * Ảnh thu nhỏ phục vụ cho bảng Quét. Chỉ trả ảnh của file đã qua kiểm tra trong một lần quét,
 * để đường dẫn /thumb không thành lối tải file Drive bất kỳ bằng quyền service account.
 */
export class ThumbnailCache {
  private readonly known = new Map<string, DriveFile>();
  private readonly cache = new Map<string, { at: number; bytes: Bytes }>();

  constructor(
    private readonly drive: DriveClient,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly maxEntries = 300,
  ) {}

  remember(files: DriveFile[]): void {
    for (const f of files) this.known.set(f.id, f);
  }

  isKnown(fileId: string): boolean {
    return this.known.has(fileId);
  }

  async get(fileId: string): Promise<Bytes | undefined> {
    const file = this.known.get(fileId);
    if (!file) return undefined;
    const hit = this.cache.get(fileId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.bytes;

    const bytes = await this.drive.thumbnail(file);
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(fileId, { at: Date.now(), bytes });
    return bytes;
  }
}
