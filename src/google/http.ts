// Lớp gọi REST Google duy nhất. Access token chỉ nằm trong header của request,
// không bao giờ được đưa vào lỗi, kết quả hay log.

export type TokenProvider = () => Promise<string>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export interface Bytes {
  contentType: string;
  data: Uint8Array;
}

export interface GoogleHttp {
  <T>(method: "GET" | "PUT" | "POST", url: string, body?: unknown): Promise<T>;
  /** Tải dữ liệu nhị phân (ảnh thu nhỏ). Vượt `maxBytes` thì báo lỗi. */
  bytes(url: string, maxBytes: number): Promise<Bytes>;
}

export function createGoogleHttp(getToken: TokenProvider, fetchImpl: FetchLike = fetch): GoogleHttp {
  async function send(method: string, url: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await getToken()}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new GoogleApiError(0, `Không kết nối được Google: ${(e as Error).message}`);
    }
    if (!res.ok) {
      let json: unknown = {};
      try {
        json = JSON.parse(await res.text());
      } catch {
        // thân lỗi không phải JSON
      }
      const err = (json as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } }).error;
      throw new GoogleApiError(res.status, err?.message ?? `HTTP ${res.status}`, err?.errors?.[0]?.reason ?? err?.status);
    }
    return res;
  }

  const call = async function <T>(method: "GET" | "PUT" | "POST", url: string, body?: unknown): Promise<T> {
    const text = await (await send(method, url, body)).text();
    try {
      return (text ? JSON.parse(text) : {}) as T;
    } catch {
      return {} as T;
    }
  } as GoogleHttp;

  call.bytes = async (url, maxBytes) => {
    const res = await send("GET", url);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new GoogleApiError(413, `File quá lớn (${declared} byte)`);
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.byteLength > maxBytes) throw new GoogleApiError(413, `File quá lớn (${data.byteLength} byte)`);
    return { contentType: res.headers.get("content-type") ?? "application/octet-stream", data };
  };

  return call;
}
