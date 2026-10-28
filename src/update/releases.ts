import fs from "node:fs";
import { isVersion } from "./layout.js";

// Nguồn bản mới (D16): chỉ GitHub Releases của repo này. Không token, không nguồn nào khác.
export const RELEASE_REPO = "Bach1711/MASYS-VIDEO-GENERATOR";
const GITHUB_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const GITHUB_DOWNLOAD = `https://github.com/${RELEASE_REPO}/releases/download/`;

export const zipAssetName = (v: string) => `MASYS-Video-v${v}-win64.zip`;

export interface ReleaseInfo {
  version: string;
  publishedAt?: string;
  notes: string;
  pageUrl?: string;
  zipUrl: string;
  zipSize?: number;
  sha256Url: string;
}

export interface ReleaseSourceOptions {
  apiUrl?: string;
  downloadPrefix?: string;
  fetch?: typeof fetch;
  /** Bao lâu không nhận thêm byte nào thì coi là kết nối đứng (mặc định 30 giây). */
  stallMs?: number;
  /** Số lần thử lại liền nhau khi không tải thêm được gì (mặc định 5). */
  retries?: number;
  /** Chờ trước lần thử lại thứ n: n × giá trị này (mặc định 2 giây). */
  retryDelayMs?: number;
  /** Số kết nối tải cùng lúc khi biết kích thước file (mặc định 8). */
  connections?: number;
}

export interface DownloadHooks {
  onProgress?: (bytes: number, total?: number) => void;
  /** Gọi trước mỗi lần thử lại: lần thứ `attempt` trên tối đa `max`. */
  onRetry?: (attempt: number, max: number) => void;
}

const UA = "masys-video-updater";

/**
 * Địa chỉ thay thế chỉ để chạy thử tự động (giả lập GitHub trên máy). Chỉ chấp nhận localhost,
 * để biến môi trường không thể trỏ tool tới nguồn tải lạ.
 */
export function sourceFromEnv(env: NodeJS.ProcessEnv = process.env): ReleaseSourceOptions {
  const api = env.MASYS_RELEASES_API;
  const dl = env.MASYS_RELEASES_DOWNLOAD;
  const local = (u?: string) => !!u && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u);
  return local(api) && local(dl) ? { apiUrl: api, downloadPrefix: dl } : {};
}

export class ReleaseSource {
  private readonly apiUrl: string;
  private readonly downloadPrefix: string;
  private readonly doFetch: typeof fetch;
  private readonly stallMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly connections: number;
  constructor(o: ReleaseSourceOptions = {}) {
    this.stallMs = o.stallMs ?? 30_000;
    this.retries = o.retries ?? 5;
    this.retryDelayMs = o.retryDelayMs ?? 2_000;
    this.connections = o.connections ?? 8;
    this.apiUrl = o.apiUrl ?? GITHUB_API;
    this.downloadPrefix = o.downloadPrefix ?? GITHUB_DOWNLOAD;
    this.doFetch = o.fetch ?? fetch;
  }

  /** Địa chỉ tải có thuộc đúng repo không (chặn mọi nguồn khác). */
  allowed(url: string): boolean {
    return url.startsWith(this.downloadPrefix);
  }

  async latest(): Promise<ReleaseInfo> {
    let r: Response;
    try {
      r = await this.doFetch(this.apiUrl, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": UA },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("Không kết nối được GitHub (máy mất mạng hoặc GitHub không trả lời).");
    }
    if (r.status === 404) throw new Error("Chưa có bản phát hành nào trên GitHub (hoặc repo không công khai).");
    if (!r.ok) throw new Error(`GitHub trả lỗi ${r.status}. Thử lại sau ít phút.`);
    const body = (await r.json()) as {
      tag_name?: string;
      published_at?: string;
      body?: string;
      html_url?: string;
      draft?: boolean;
      prerelease?: boolean;
      assets?: { name: string; browser_download_url: string; size?: number }[];
    };
    const version = (body.tag_name ?? "").replace(/^v/, "");
    if (!isVersion(version)) throw new Error("Bản phát hành trên GitHub có số phiên bản không hợp lệ.");
    const asset = (name: string) => body.assets?.find((a) => a.name === name);
    const zip = asset(zipAssetName(version));
    const sha = asset(`${zipAssetName(version)}.sha256`);
    if (!zip || !sha) throw new Error(`Bản v${version} trên GitHub thiếu file zip hoặc file SHA-256.`);
    const prefix = `${this.downloadPrefix}v${version}/`;
    if (!zip.browser_download_url.startsWith(prefix) || !sha.browser_download_url.startsWith(prefix)) {
      throw new Error("Địa chỉ tải không thuộc repo phát hành của tool; không tải.");
    }
    return {
      version,
      publishedAt: body.published_at,
      notes: body.body ?? "",
      pageUrl: body.html_url,
      zipUrl: zip.browser_download_url,
      zipSize: zip.size,
      sha256Url: sha.browser_download_url,
    };
  }

  /** Tải file nhỏ (file SHA-256) vào bộ nhớ; GitHub chuyển hướng sang máy chủ lưu file, fetch tự theo. */
  async download(url: string): Promise<Buffer> {
    if (!this.allowed(url)) throw new Error("Địa chỉ tải không thuộc repo phát hành của tool; không tải.");
    return this.withRetries({}, async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.stallMs);
      try {
        const r = await this.doFetch(url, { headers: { "User-Agent": UA }, signal: ac.signal });
        if (!r.ok) throw httpError(r.status);
        return Buffer.from(await r.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /**
   * Tải file lớn (zip bản mới) vào `file`. GitHub giới hạn tốc độ theo từng kết nối, nên khi biết `size` thì
   * chia file thành vài đoạn tải cùng lúc (mỗi đoạn một file `file.N`), xong thì ghép lại. Mỗi đoạn tải tiếp
   * từ chỗ dừng (HTTP Range); `stallMs` không nhận thêm byte nào thì coi là đứng, ngắt và thử lại; mạng chậm
   * nhưng vẫn chạy thì không bị cắt. Lỗi thì phần đã tải vẫn nằm trên đĩa để lần sau tải tiếp.
   * Máy chủ không hỗ trợ Range thì tải một luồng từ đầu.
   */
  async downloadToFile(url: string, file: string, o: DownloadHooks & { size?: number } = {}): Promise<void> {
    if (!this.allowed(url)) throw new Error("Địa chỉ tải không thuộc repo phát hành của tool; không tải.");
    const size = o.size ?? 0;
    const single = fileSize(file) > 0; // lần trước đã tải một luồng: tải tiếp đúng kiểu đó
    const n = single ? 1 : Math.min(this.connections, Math.floor(size / MIN_SEGMENT));
    if (n > 1) {
      try {
        await this.segmented(url, file, size, n, o);
        return;
      } catch (e) {
        if (!(e instanceof NoRangeError)) throw e;
        for (let i = 0; i < n; i++) fs.rmSync(`${file}.${i}`, { force: true });
      }
    }
    await this.withRetries(o, () => this.fetchPiece(url, file, 0, undefined, (h, t) => o.onProgress?.(h, t)), () => fileSize(file));
  }

  private async segmented(url: string, file: string, size: number, n: number, o: DownloadHooks): Promise<void> {
    const segs = Array.from({ length: n }, (_, i) => ({
      start: Math.floor((size * i) / n),
      end: Math.floor((size * (i + 1)) / n) - 1,
      file: `${file}.${i}`,
    }));
    const have = segs.map((s) => fileSize(s.file));
    const report = () => o.onProgress?.(have.reduce((a, b) => a + b, 0), size);
    report();
    // Một đoạn hỏng hẳn thì dừng các đoạn khác, để không còn gì ghi vào đĩa sau khi đã báo lỗi.
    const cancel = new AbortController();
    const results = await Promise.allSettled(
      segs.map(async (s, i) => {
        const onBytes = (h: number) => {
          have[i] = h;
          report();
        };
        try {
          await this.withRetries(o, () => this.fetchPiece(url, s.file, s.start, s.end, onBytes, cancel.signal), () => fileSize(s.file), cancel.signal);
        } catch (e) {
          cancel.abort();
          throw e;
        }
      }),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected" && !(r.reason instanceof CancelledError));
    if (failed) throw failed.reason;
    const fd = fs.openSync(file, "w");
    try {
      for (const s of segs) fs.writeSync(fd, fs.readFileSync(s.file));
    } finally {
      fs.closeSync(fd);
    }
    for (const s of segs) fs.rmSync(s.file, { force: true });
  }

  /**
   * Một lần tải: `file` đang giữ các byte từ vị trí `base`; xin tiếp phần còn thiếu (tới `end` nếu có) và nối
   * vào. Đứng quá `stallMs` thì ngắt và ném lỗi để thử lại.
   */
  private async fetchPiece(
    url: string,
    file: string,
    base: number,
    end: number | undefined,
    onBytes: (have: number, total?: number) => void,
    cancel?: AbortSignal,
  ): Promise<void> {
    let have = fileSize(file);
    if (end !== undefined && base + have > end) return;
    const ac = new AbortController();
    const onCancel = () => ac.abort();
    cancel?.addEventListener("abort", onCancel);
    let timer = setTimeout(() => ac.abort(), this.stallMs);
    let fd: number | undefined;
    try {
      const headers: Record<string, string> = { "User-Agent": UA };
      const ranged = end !== undefined || have > 0;
      if (ranged) headers.Range = `bytes=${base + have}-${end ?? ""}`;
      const r = await this.doFetch(url, { headers, signal: ac.signal });
      // 416: phần đã có đủ cả file rồi (SHA-256 kiểm tra ở bước sau).
      if (r.status === 416 && end === undefined && have > 0) return;
      if (!r.ok || !r.body) throw httpError(r.status);
      if (ranged && r.status !== 206) {
        if (end !== undefined) throw new NoRangeError();
        have = 0; // máy chủ bỏ qua Range: tải lại từ đầu
      }
      const range = /\/(\d+)\s*$/.exec(r.headers.get("content-range") ?? "");
      const len = Number(r.headers.get("content-length"));
      const total = end !== undefined ? end - base + 1 : range ? Number(range[1]) : len > 0 ? have + len : undefined;
      fd = fs.openSync(file, have > 0 ? "a" : "w");
      onBytes(have, total);
      for await (const chunk of r.body as AsyncIterable<Uint8Array>) {
        fs.writeSync(fd, chunk);
        have += chunk.length;
        clearTimeout(timer);
        timer = setTimeout(() => ac.abort(), this.stallMs);
        onBytes(have, total);
      }
      if (total !== undefined && have < total) throw new Error("ngắt giữa chừng");
    } finally {
      clearTimeout(timer);
      cancel?.removeEventListener("abort", onCancel);
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  /**
   * Chạy `attempt`, lỗi mạng thì chờ rồi thử lại. Chỉ tính những lần liền nhau không tải thêm được gì
   * (theo `progress`), nên mạng chập chờn mà vẫn nhích dần thì tải tới xong.
   */
  private async withRetries<T>(o: DownloadHooks, attempt: () => Promise<T>, progress: () => number = () => 0, cancel?: AbortSignal): Promise<T> {
    let failures = 0;
    for (;;) {
      const before = progress();
      try {
        return await attempt();
      } catch (e) {
        if (cancel?.aborted) throw new CancelledError();
        if (e instanceof FatalDownloadError || e instanceof NoRangeError) throw e;
        failures = progress() > before ? 1 : failures + 1;
        if (failures > this.retries) {
          throw new Error(
            `Tải bản mới bị ngắt ${this.retries + 1} lần liền (mạng chập chờn hoặc GitHub không trả lời). Phần đã tải được giữ lại: bấm Cập nhật lần nữa để tải tiếp.`,
          );
        }
        o.onRetry?.(failures, this.retries);
        await new Promise((res) => setTimeout(res, this.retryDelayMs * failures));
        if (cancel?.aborted) throw new CancelledError();
      }
    }
  }
}

/** Đoạn nhỏ nhất khi chia file tải song song. */
const MIN_SEGMENT = 2 * 1024 * 1024;

const fileSize = (f: string) => (fs.existsSync(f) ? fs.statSync(f).size : 0);

/** Lỗi không nên thử lại (file không có trên GitHub…). */
class FatalDownloadError extends Error {}
/** Máy chủ không trả đúng đoạn được xin: chuyển sang tải một luồng. */
class NoRangeError extends Error {}
/** Đoạn bị dừng vì đoạn khác đã hỏng hẳn. */
class CancelledError extends Error {}

function httpError(status: number): Error {
  // 408/429/5xx: GitHub tạm thời quá tải, thử lại được. Còn lại (404…) thử lại cũng vậy.
  if (status === 408 || status === 429 || status >= 500) return new Error(`HTTP ${status}`);
  return new FatalDownloadError(`Tải bản mới lỗi: GitHub trả mã ${status}. Thử lại sau, hoặc báo người phụ trách.`);
}
