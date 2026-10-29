// Mẫu yêu cầu gửi Muse (spec §8.2). Luôn ghi địa chỉ tuyệt đối, không để Muse tự đoán.

export const DEFAULT_TEMPLATE = `Hãy tạo một video dọc 9:16, dài khoảng 8–10 giây, một cảnh, từ ảnh người mẫu sau:
Ảnh: {link_anh}
{doan_ghep_ao}
Giữ nguyên nền, bối cảnh và ánh sáng của ảnh người mẫu; không đổi sang phòng hay khung cảnh khác.
Từ prompt dưới đây chỉ lấy động tác, biểu cảm và cách quay; bỏ qua mọi mô tả bối cảnh, phòng, ánh sáng.
Prompt: {prompt}
Yêu cầu thêm: {yeu_cau_them}
Luôn giữ nguyên hình in trên áo, không làm méo hay đổi chữ/hình.

Sau khi tạo xong:
1. Lưu video vào thư mục Google Drive: {link_thu_muc} (tên file: {ten_file}).
2. Dán link Google Drive của video vào ô {o_video} của tab "{ten_tab}" trong Google Sheet {link_sheet}.
3. Chỉ sửa đúng ô {o_video}. Không sửa bất kỳ ô nào khác.`;

/**
 * Đoạn ghép áo (spec v4.4 §8.2): chỉ thêm vào yêu cầu của dòng có ảnh áo, thay cho {doan_ghep_ao}.
 * Phỏng theo câu người phụ trách đã thử tay thành công trên Muse ngày 28/10/2026;
 * v1.4.1 (D27): chỉ thay chiếc áo, giữ nguyên nền và bối cảnh của ảnh người mẫu.
 */
export const DEFAULT_SHIRT_TEMPLATE = `Ảnh áo: {link_anh_ao}
Hãy ghép chiếc áo trong ảnh áo vào người mẫu trong ảnh người mẫu ở trên: chỉ thay chiếc áo, giữ nguyên khuôn mặt, tóc, dáng, tư thế, nền, bối cảnh và ánh sáng của ảnh người mẫu, giữ nguyên hình in trên áo. Dùng ảnh vừa ghép để tạo video theo prompt dưới đây. Không cần lưu ảnh vừa ghép.`;

export const SHIRT_PLACEHOLDERS = {
  link_anh_ao: "Link Drive của ảnh áo (cột Ảnh áo)",
} as const;

export const PLACEHOLDERS = {
  link_anh: "Link Drive của ảnh (cột Ảnh)",
  doan_ghep_ao: "Đoạn ghép áo bên dưới, chỉ có ở dòng có ảnh áo (dòng không có ảnh áo thì bỏ trống)",
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
  return checkPlaceholders(template, Object.keys(PLACEHOLDERS), REQUIRED_PLACEHOLDERS);
}

/** Lỗi của đoạn ghép áo: chỉ được dùng {link_anh_ao}, và bắt buộc có nó. */
export function validateShirtTemplate(template: string): string[] {
  return checkPlaceholders(template, Object.keys(SHIRT_PLACEHOLDERS), ["link_anh_ao"]);
}

function checkPlaceholders(template: string, known: string[], required: string[]): string[] {
  const problems: string[] = [];
  if (!template.trim()) return ["Mẫu đang trống."];
  const used = new Set([...template.matchAll(TOKEN)].map((m) => m[1]!));
  const unknown = [...used].filter((p) => !known.includes(p));
  if (unknown.length) problems.push(`Không có chỗ trống tên: ${unknown.map((p) => `{${p}}`).join(", ")}`);
  const missing = required.filter((p) => !used.has(p));
  if (missing.length) problems.push(`Mẫu phải có: ${missing.map((p) => `{${p}}`).join(", ")}`);
  return problems;
}

/** Mẫu chính (đã sửa tay từ trước v4.4) thiếu chỗ đặt đoạn ghép áo: dòng có ảnh áo sẽ không được ghép. */
export function lacksShirtSlot(template: string): boolean {
  return !template.includes("{doan_ghep_ao}");
}

export const NO_SHIRT_SLOT_WARNING =
  "Mẫu yêu cầu gửi Muse đang thiếu chỗ {doan_ghep_ao}, nên dòng có ảnh áo sẽ không được ghép áo (Muse chỉ dùng ảnh người mẫu). Thêm {doan_ghep_ao} vào mẫu, hoặc bấm Khôi phục mẫu gốc, ở Cài đặt.";

/** Đoạn ghép áo đã điền link cho một dòng; dòng không có ảnh áo thì rỗng. */
export function shirtBlock(shirtTemplate: string, shirtLink: string): string {
  return shirtLink ? renderTemplate(shirtTemplate, { link_anh_ao: shirtLink }).trim() : "";
}

/**
 * Điền một lượt: giá trị đã điền không bị thay tiếp (prompt có chữ "{o_video}" vẫn giữ nguyên).
 * {doan_ghep_ao} rỗng mà đứng riêng một dòng thì bỏ luôn dòng đó, không để lại dòng trống thừa.
 */
export function renderTemplate(template: string, values: Partial<Record<string, string>>): string {
  let t = template;
  if (values.doan_ghep_ao === "") t = t.replace(/^[ \t]*\{doan_ghep_ao\}[ \t]*(\r?\n|$)/gm, "");
  return t.replace(TOKEN, (whole, name: string) => values[name] ?? whole);
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
