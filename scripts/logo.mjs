// Tạo các ảnh logo nhỏ cho tool từ file logo gốc (PNG nền trong suốt, CON-48).
// Dùng: node scripts/logo.mjs <đường-dẫn-logo-gốc.png>
// Kết quả: src/web/logoData.ts (ảnh PNG dạng base64, nằm luôn trong dist nên bản zip không cần thêm file).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error("Cần đường dẫn file logo gốc: node scripts/logo.mjs <logo.png>");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataUrl = "data:image/png;base64," + fs.readFileSync(src).toString("base64");

// Phần vòng tròn có nút play, tính theo tỉ lệ ảnh gốc 1600×1600 (không lấy chữ bên dưới).
const ICON_CROP = { x: 393 / 1600, y: 137 / 1600, size: 790 / 1600 };
const OUTPUTS = [
  { name: "icon32", size: 32, crop: ICON_CROP },
  { name: "icon64", size: 64, crop: ICON_CROP },
  { name: "icon180", size: 180, crop: ICON_CROP },
  { name: "full360", size: 360, crop: { x: 0, y: 0, size: 1 } },
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
const result = await page.evaluate(
  async ({ dataUrl, outputs }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const out = {};
    for (const o of outputs) {
      const c = document.createElement("canvas");
      c.width = c.height = o.size;
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      const s = o.crop.size * img.width;
      g.drawImage(img, o.crop.x * img.width, o.crop.y * img.height, s, s, 0, 0, o.size, o.size);
      out[o.name] = c.toDataURL("image/png").split(",")[1];
    }
    return out;
  },
  { dataUrl, outputs: OUTPUTS },
);
await browser.close();

const lines = [
  "// File tạo tự động bằng scripts/logo.mjs từ logo MASYS (CON-48). Đừng sửa tay.",
  "",
  ...Object.entries(result).map(([k, v]) => `export const ${k} = "${v}";`),
  "",
];
fs.writeFileSync(path.join(root, "src", "web", "logoData.ts"), lines.join("\n"));
for (const [k, v] of Object.entries(result)) console.log(`${k}: ${Math.round((v.length * 3) / 4 / 1024)} KB`);
