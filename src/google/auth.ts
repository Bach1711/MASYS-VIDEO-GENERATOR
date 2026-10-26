import { JWT } from "google-auth-library";
import type { ServiceAccountCredentials } from "../config.js";
import type { TokenProvider } from "./http.js";

// Spec §8.1: tool chỉ cần sửa sheet (ô Trạng thái) và đọc Drive.
export const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
];

/** Đổi khoá service account lấy access token; thư viện tự cache và làm mới trước khi hết hạn. */
export function serviceAccountTokenProvider(credentials: ServiceAccountCredentials): TokenProvider {
  const jwt = new JWT({ email: credentials.client_email, key: credentials.private_key, scopes: SCOPES });
  return async () => {
    try {
      const { token } = await jwt.getAccessToken();
      if (!token) throw new Error("Google không trả về access token");
      return token;
    } catch (e) {
      // Thông điệp lỗi của thư viện không chứa khoá; vẫn bọc lại để không mang theo request/response.
      throw new Error(`Không xác thực được service account: ${(e as Error).message}`);
    }
  };
}
