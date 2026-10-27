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
}

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
  constructor(o: ReleaseSourceOptions = {}) {
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
        headers: { Accept: "application/vnd.github+json", "User-Agent": "masys-video-updater" },
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

  /** Tải về bộ nhớ đệm file; GitHub chuyển hướng sang máy chủ lưu file, fetch tự theo. */
  async download(url: string, onProgress?: (bytes: number) => void): Promise<Buffer> {
    if (!this.allowed(url)) throw new Error("Địa chỉ tải không thuộc repo phát hành của tool; không tải.");
    let r: Response;
    try {
      r = await this.doFetch(url, { headers: { "User-Agent": "masys-video-updater" }, signal: AbortSignal.timeout(15 * 60_000) });
    } catch {
      throw new Error("Tải bản mới bị ngắt (mạng chập chờn?). Thử lại.");
    }
    if (!r.ok || !r.body) throw new Error(`Tải bản mới lỗi: HTTP ${r.status}.`);
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const chunk of r.body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
      n += chunk.length;
      onProgress?.(n);
    }
    return Buffer.concat(chunks);
  }
}
