import { columnLetter } from "./a1.js";

export type ColumnRole = "colImage" | "colPrompt" | "colVideo" | "colStatus";
export type ColumnGuess = Partial<Record<ColumnRole, string>>;

export const ROLE_LABELS: Record<ColumnRole, string> = {
  colImage: "Ảnh",
  colPrompt: "Prompt",
  colVideo: "Video",
  colStatus: "Trạng thái",
};

// Thứ tự quan trọng: đoán Trạng thái và Video trước để "Link video" không bị nhận thành cột Ảnh.
const RULES: [ColumnRole, RegExp][] = [
  ["colStatus", /\b(trang thai|tinh trang|status)\b/],
  ["colVideo", /\bvideo\b/],
  ["colImage", /\b(anh|hinh|hinh anh|image|img|photo|picture)\b/],
  ["colPrompt", /\b(prompt|mo ta|noi dung|description)\b/],
];

export function normalizeHeader(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Tự đoán cột theo tên tiêu đề (F2). Mỗi cột chỉ gán cho một vai trò; lấy cột khớp đầu tiên. */
export function guessColumns(headers: string[]): ColumnGuess {
  const guess: ColumnGuess = {};
  const used = new Set<number>();
  for (const [role, re] of RULES) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(normalizeHeader(h)));
    if (i >= 0) {
      guess[role] = columnLetter(i);
      used.add(i);
    }
  }
  return guess;
}
