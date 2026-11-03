import { combineExtra, renderTemplate } from "../batch/template.js";
import type { ImageTemplateKind, Settings } from "../db/settings.js";

// Yêu cầu gửi Muse của Bảng ảnh (CON-77, spec 17.13, D32, D33). Character sheet luôn đính kèm là ảnh 1.

export const DEFAULT_IMAGE_TEMPLATE = `Ảnh đính kèm là character sheet của nhân vật {ten_nhan_vat}. Chỉ dùng nó để giữ đúng khuôn mặt, kiểu tóc, màu tóc, màu da và vóc dáng của nhân vật; không chép bố cục, nền hay chữ của character sheet.
Hãy tạo MỘT tấm ảnh chụp đơn, khung dọc 9:16, không ghép nhiều góc, không chữ, không viền, theo mô tả sau:
{prompt}
Yêu cầu thêm: {yeu_cau_them}
Tạo xong thì gửi ảnh ngay trong cuộc trò chuyện này.`;

export const DEFAULT_IMAGE_BACK_TEMPLATE = `Tạo thêm một ảnh của đúng người trong ảnh vừa tạo: cùng trang phục, cùng bối cảnh, ánh sáng và khung hình, nhưng người mẫu quay lưng hẳn về phía máy ảnh, không quay đầu, không thấy mặt, tóc giữ đúng như ảnh vừa tạo. Vẫn là MỘT tấm ảnh chụp đơn, khung dọc 9:16, không chữ. Tạo xong thì gửi ảnh ngay trong cuộc trò chuyện này.`;

export const IMAGE_DEFAULTS: Record<ImageTemplateKind, string> = {
  imageTemplate: DEFAULT_IMAGE_TEMPLATE,
  imageBackTemplate: DEFAULT_IMAGE_BACK_TEMPLATE,
};

export const IMAGE_PLACEHOLDERS: Record<ImageTemplateKind, { known: Record<string, string>; required: string[] }> = {
  imageTemplate: {
    known: {
      ten_nhan_vat: "Tên nhân vật của dòng",
      prompt: "Prompt của dòng",
      yeu_cau_them: "Yêu cầu thêm chung cho lần chạy",
    },
    required: ["prompt"],
  },
  imageBackTemplate: { known: { ten_nhan_vat: "Tên nhân vật của dòng" }, required: [] },
};

const TOKEN = /\{([A-Za-z_]+)\}/g;

/** Lỗi của một mẫu Bảng ảnh; rỗng = hợp lệ. */
export function validateImageTemplate(kind: ImageTemplateKind, template: string): string[] {
  if (!template.trim()) return ["Mẫu đang trống."];
  const { known, required } = IMAGE_PLACEHOLDERS[kind];
  const used = new Set([...template.matchAll(TOKEN)].map((m) => m[1]!));
  const problems: string[] = [];
  const unknown = [...used].filter((p) => !(p in known));
  if (unknown.length) problems.push(`Không có chỗ trống tên: ${unknown.map((p) => `{${p}}`).join(", ")}`);
  const missing = required.filter((p) => !used.has(p));
  if (missing.length) problems.push(`Mẫu phải có: ${missing.map((p) => `{${p}}`).join(", ")}`);
  return problems;
}

/** Tin nhắn xin ảnh mặt trước và (nếu tích Quay lưng) tin xin ảnh quay lưng. */
export function buildImageRequest(
  row: { prompt: string; nhanVatTen: string; backOn: boolean },
  s: Pick<Settings, ImageTemplateKind>,
  extra: string,
): { text: string; backText: string | null } {
  const ten_nhan_vat = row.nhanVatTen;
  const text = renderTemplate(s.imageTemplate ?? DEFAULT_IMAGE_TEMPLATE, { ten_nhan_vat, prompt: row.prompt.trim(), yeu_cau_them: combineExtra(extra, "") });
  const backText = row.backOn ? renderTemplate(s.imageBackTemplate ?? DEFAULT_IMAGE_BACK_TEMPLATE, { ten_nhan_vat }) : null;
  return { text, backText };
}
