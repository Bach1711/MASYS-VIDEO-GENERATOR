import { combineExtra, renderTemplate } from "../batch/template.js";
import type { BangTemplateKind, Settings } from "../db/settings.js";
import { labelOf, SLOT_TEXT, type BangRow, type Slot } from "./rows.js";

// Yêu cầu gửi Muse của Bảng mới (spec v6.0 mục 17.4, D22, D24, D27): ảnh đính kèm thẳng vào cuộc trò chuyện,
// theo thứ tự cố định; Muse gửi video ngay trong cuộc trò chuyện, không lưu Drive, không sửa sheet.

export const DEFAULT_BANG_TEMPLATE = `Tôi gửi kèm {so_anh} ảnh: {danh_sach_anh}.
Hãy tạo một video dọc 9:16, dài khoảng 8–10 giây, một cảnh, từ ảnh người mẫu (ảnh 1).
{doan_ghep_ao}
Giữ nguyên nền, bối cảnh và ánh sáng của ảnh người mẫu; không đổi sang phòng hay khung cảnh khác.
Từ prompt dưới đây chỉ lấy động tác, biểu cảm và cách quay; bỏ qua mọi mô tả bối cảnh, phòng, ánh sáng.
Prompt: {prompt}
Yêu cầu thêm: {yeu_cau_them}
Luôn giữ nguyên hình in trên áo, không làm méo hay đổi chữ/hình.
Tạo xong thì gửi video ngay trong cuộc trò chuyện này. Không lưu lên Google Drive, không sửa Google Sheet.`;

export const DEFAULT_BANG_SHIRT_TEMPLATE = `Trước khi tạo video, hãy ghép chiếc áo ở ảnh 2 vào người mẫu ở ảnh 1: chỉ thay chiếc áo, giữ nguyên khuôn mặt, tóc, dáng, tư thế, nền, bối cảnh và ánh sáng của ảnh 1, giữ nguyên hình in trên áo. Dùng ảnh vừa ghép để tạo video. Không cần lưu ảnh vừa ghép.`;

/**
 * Mẫu hai mặt (CON-73, đội duyệt 30/10/2026). Ghép ra ảnh A, B trước rồi làm video chỉ từ hai ảnh đó; không cho người mẫu
 * xoay người liền mạch (AI làm video vẽ lại hình in khi xoay nên mặt sau bị sai), mà cắt cảnh sang quay lưng và chỉ cử
 * động nhẹ ở đầu, tóc, chân để hình in mặt sau giữ đúng.
 */
export const DEFAULT_TWO_SIDED_TEMPLATE = `Tôi gửi kèm 4 ảnh theo đúng thứ tự: ảnh 1 = người mẫu mặt trước, ảnh 2 = áo mặt trước, ảnh 3 = người mẫu quay lưng, ảnh 4 = áo mặt sau.
Làm đúng 2 bước theo thứ tự, không gộp, không bỏ bước nào.
Bước 1 – thay áo cho người mẫu. Đầu ra là 2 ảnh người mẫu:
- Ảnh A: người mẫu ở ảnh 1 mặc chiếc áo ở ảnh 2.
- Ảnh B: người mẫu ở ảnh 3 mặc chiếc áo ở ảnh 4.
Chỉ thay chiếc áo, bỏ hoàn toàn áo cũ; giữ nguyên thiết kế áo (chữ, hình, màu, vị trí); giữ nguyên khuôn mặt, tóc, dáng, nền và ánh sáng của người mẫu. Gửi ảnh A và ảnh B vào cuộc trò chuyện này.
Bước 2 – chỉ làm sau khi đã có ảnh A và ảnh B: tạo MỘT video dọc 9:16, dài khoảng 9–10 giây, ghép từ 3 đoạn, chuyển đoạn bằng cắt thẳng hoặc hoà cảnh nhanh (không cần cảnh người mẫu xoay người):
- Đoạn 1 (khoảng 4 giây): tạo từ ảnh A, người mẫu ở mặt trước làm động tác theo prompt bên dưới.
- Đoạn 2 (khoảng 3–4 giây): tạo từ ảnh B, người mẫu vẫn quay lưng suốt đoạn, KHÔNG xoay người, có cử động nhẹ: quay đầu nhìn lại máy quay qua vai và mỉm cười, vuốt hoặc hất tóc nhẹ, dồn trọng tâm từ chân này sang chân kia; máy quay tiến gần chậm. Thân áo gần như giữ yên, tay không che hình in, hình in mặt sau giữ đúng như ảnh B ở mọi khung hình.
- Đoạn 3 (khoảng 2 giây): quay lại mặt trước như ảnh A, người mẫu cười nhìn máy quay.
Không dùng ảnh 2 và ảnh 4 cho video. Ở mọi khung hình, hình in phải đúng như ảnh A (mặt trước) và ảnh B (mặt sau).
Từ prompt dưới đây chỉ lấy động tác, biểu cảm và cách quay cho đoạn 1; bỏ qua mọi mô tả bối cảnh, phòng, ánh sáng.
Prompt: {prompt}
Yêu cầu thêm: {yeu_cau_them}
Tạo xong thì gửi video ngay trong cuộc trò chuyện này. Không lưu lên Google Drive, không sửa Google Sheet.`;

export const BANG_DEFAULTS: Record<BangTemplateKind, string> = {
  bangTemplate: DEFAULT_BANG_TEMPLATE,
  bangShirtTemplate: DEFAULT_BANG_SHIRT_TEMPLATE,
  twoSidedTemplate: DEFAULT_TWO_SIDED_TEMPLATE,
};

/** Chỗ trống mỗi mẫu được dùng, và chỗ bắt buộc. */
export const BANG_PLACEHOLDERS: Record<BangTemplateKind, { known: Record<string, string>; required: string[] }> = {
  bangTemplate: {
    known: {
      so_anh: "Số ảnh đính kèm (1 hoặc 2)",
      danh_sach_anh: "Ảnh nào là gì, ví dụ: ảnh 1 là người mẫu, ảnh 2 là thiết kế áo",
      doan_ghep_ao: "Đoạn ghép áo, chỉ có ở dòng có ảnh áo trước",
      prompt: "Prompt của dòng",
      yeu_cau_them: "Yêu cầu thêm chung cho lần chạy",
    },
    required: ["prompt"],
  },
  bangShirtTemplate: { known: {}, required: [] },
  twoSidedTemplate: {
    known: { prompt: "Prompt của dòng", yeu_cau_them: "Yêu cầu thêm chung cho lần chạy" },
    required: ["prompt"],
  },
};

const TOKEN = /\{([A-Za-z_]+)\}/g;

/** Lỗi của một mẫu Bảng mới; rỗng = hợp lệ. */
export function validateBangTemplate(kind: BangTemplateKind, template: string): string[] {
  if (!template.trim()) return ["Mẫu đang trống."];
  const { known, required } = BANG_PLACEHOLDERS[kind];
  const used = new Set([...template.matchAll(TOKEN)].map((m) => m[1]!));
  const problems: string[] = [];
  const unknown = [...used].filter((p) => !(p in known));
  if (unknown.length) problems.push(`Không có chỗ trống tên: ${unknown.map((p) => `{${p}}`).join(", ")}`);
  const missing = required.filter((p) => !used.has(p));
  if (missing.length) problems.push(`Mẫu phải có: ${missing.map((p) => `{${p}}`).join(", ")}`);
  return problems;
}

export type BangKind = "single" | "shirt" | "two_sided";
export const BANG_KIND_TEXT: Record<BangKind, string> = { single: "Một ảnh người mẫu", shirt: "Ghép áo một mặt", two_sided: "Áo hai mặt" };

/** Ảnh đính kèm theo thứ tự cố định 17.4 (bỏ ô trống, giữ thứ tự còn lại). */
const ORDER: Slot[] = ["modelFront", "shirtFront", "modelBack", "shirtBack"];

export interface BangRequest {
  kind: BangKind;
  attachments: { slot: Slot; name: string }[];
  text: string;
}

/** Yêu cầu cho một dòng; dòng thiếu dữ liệu (17.4) thì trả lý do. */
export function buildBangRequest(row: BangRow, s: Pick<Settings, BangTemplateKind>, extra: string): BangRequest | { problems: string[] } {
  const { label, problems } = labelOf({ ...row, videoFile: null, runState: null });
  if (label === "missing_data") return { problems };
  const attachments = ORDER.filter((slot) => row[slot]).map((slot) => ({ slot, name: row[slot]! }));
  const prompt = row.prompt.trim();
  const yeu_cau_them = combineExtra(extra, "");
  if (attachments.length === 4) {
    return { kind: "two_sided", attachments, text: renderTemplate(s.twoSidedTemplate ?? DEFAULT_TWO_SIDED_TEMPLATE, { prompt, yeu_cau_them }) };
  }
  const shirt = attachments.length === 2;
  const text = renderTemplate(s.bangTemplate ?? DEFAULT_BANG_TEMPLATE, {
    so_anh: String(attachments.length),
    danh_sach_anh: shirt ? "ảnh 1 là người mẫu, ảnh 2 là thiết kế áo" : "ảnh 1 là người mẫu",
    doan_ghep_ao: shirt ? (s.bangShirtTemplate ?? DEFAULT_BANG_SHIRT_TEMPLATE).trim() : "",
    prompt,
    yeu_cau_them,
  });
  return { kind: shirt ? "shirt" : "single", attachments, text };
}

/** "ảnh 1 · Mẫu trước" cho phần xem trước. */
export const attachmentText = (i: number, slot: Slot) => `ảnh ${i + 1} · ${SLOT_TEXT[slot]}`;
