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

export interface GoogleHttp {
  <T>(method: "GET" | "PUT" | "POST", url: string, body?: unknown): Promise<T>;
}

export function createGoogleHttp(getToken: TokenProvider, fetchImpl: FetchLike = fetch): GoogleHttp {
  return async function call<T>(method: "GET" | "PUT" | "POST", url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await getToken()}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new GoogleApiError(0, `Không kết nối được Google: ${(e as Error).message}`);
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      const err = (json as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } }).error;
      throw new GoogleApiError(res.status, err?.message ?? `HTTP ${res.status}`, err?.errors?.[0]?.reason ?? err?.status);
    }
    return json as T;
  };
}
