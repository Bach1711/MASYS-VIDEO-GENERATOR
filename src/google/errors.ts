import { GoogleApiError } from "./http.js";

export function shareHint(clientEmail: string): string {
  return `Chia sẻ sheet cho ${clientEmail} với quyền chỉnh sửa`;
}

/** Đổi lỗi Google thành câu người dùng hiểu được (F1). */
export function describeGoogleError(e: unknown, clientEmail: string): string {
  if (e instanceof GoogleApiError) {
    if (e.status === 403 || e.status === 404) return shareHint(clientEmail);
    if (e.status === 400 && /not supported for this document/i.test(e.message)) {
      return "Link này không phải Google Sheet (có thể là file Excel trên Drive). Mở file và chọn Tệp → Lưu dưới dạng Google Trang tính.";
    }
    if (e.status === 0) return e.message;
    return `Google báo lỗi ${e.status}: ${e.message}`;
  }
  return (e as Error)?.message ?? String(e);
}
