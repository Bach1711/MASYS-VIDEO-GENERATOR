// Mẫu yêu cầu gửi Muse (spec §8.2). Luôn ghi địa chỉ tuyệt đối, không để Muse tự đoán.

export const DEFAULT_TEMPLATE = `Hãy tạo một video dọc 9:16, dài khoảng 8–10 giây, một cảnh, từ ảnh người mẫu sau:
Ảnh: {link_anh}

Prompt: {prompt}
Yêu cầu thêm: {yeu_cau_them}
Luôn giữ nguyên hình in trên áo, không làm méo hay đổi chữ/hình.

Sau khi tạo xong:
1. Lưu video vào thư mục Google Drive: {link_thu_muc} (tên file: {ten_file}).
2. Dán link Google Drive của video vào ô {o_video} của tab "{ten_tab}" trong Google Sheet {link_sheet}.
3. Chỉ sửa đúng ô {o_video}. Không sửa bất kỳ ô nào khác.`;

export const PLACEHOLDERS = {
  link_anh: "Link Drive của ảnh (cột Ảnh)",
  prompt: "Prompt đã chỉnh",
  yeu_cau_them: "Yêu cầu thêm (chung cho lô; riêng dòng)",
  link_thu_muc: "Link thư mục Drive lưu video",
  ten_file: "Tên file video: <tab>_row<N>_<YYYYMMDD-HHmm>.mp4",
  o_video: "Ô Video của dòng, ví dụ C5",
  ten_tab: "Tên trang tính",
  link_sheet: "Link Google Sheet, kèm mã trang tính",
} as const;

export type Placeholder = keyof typeof PLACEHOLDERS;
export type TemplateValues = Record<Placeholder, string>;

/** Thiếu những chỗ này thì Muse không biết lấy ảnh ở đâu hay ghi link vào đâu. */
export const REQUIRED_PLACEHOLDERS: Placeholder[] = ["link_anh", "link_thu_muc", "o_video", "link_sheet"];

const TOKEN = /\{([A-Za-z_]+)\}/g;

/** Lỗi của mẫu: chỗ trống không tồn tại (gõ sai) hoặc thiếu chỗ bắt buộc. Rỗng = hợp lệ. */
export function validateTemplate(template: string): string[] {
  const problems: string[] = [];
  if (!template.trim()) return ["Mẫu đang trống."];
  const used = new Set([...template.matchAll(TOKEN)].map((m) => m[1]!));
  const unknown = [...used].filter((p) => !(p in PLACEHOLDERS));
  if (unknown.length) problems.push(`Không có chỗ trống tên: ${unknown.map((p) => `{${p}}`).join(", ")}`);
  const missing = REQUIRED_PLACEHOLDERS.filter((p) => !used.has(p));
  if (missing.length) problems.push(`Mẫu phải có: ${missing.map((p) => `{${p}}`).join(", ")}`);
  return problems;
}

/** Điền một lượt: giá trị đã điền không bị thay tiếp (prompt có chữ "{o_video}" vẫn giữ nguyên). */
export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(TOKEN, (whole, name: string) => (name in values ? values[name as Placeholder] : whole));
}

/** Gộp yêu cầu thêm: chung cho lô trước, riêng dòng sau. */
export function combineExtra(batchExtra: string, rowExtra: string): string {
  const parts = [batchExtra, rowExtra].map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.join("; ") : "(không có)";
}

/** Dấu thời gian theo giờ máy: YYYYMMDD-HHmm. */
export function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function isFileStamp(s: string): boolean {
  return /^\d{8}-\d{4}$/.test(s);
}

/** `<tab>_row<N>_<YYYYMMDD-HHmm>.mp4`; ký tự Drive/Windows không cho dùng trong tên file đổi thành "-". */
export function videoFileName(tab: string, row: number, stamp: string): string {
  const safeTab = tab.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "tab";
  return `${safeTab}_row${row}_${stamp}.mp4`;
}

export function sheetLink(spreadsheetId: string, sheetId: number): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
}

export function folderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
