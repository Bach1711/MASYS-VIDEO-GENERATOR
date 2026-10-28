import type { Hono } from "hono";
import { APP_VERSION } from "../version.js";
import { full360, icon32, icon64, icon180 } from "./logoData.js";

// Logo MASYS (CON-48): ảnh nằm sẵn trong code (logoData.ts) nên bản zip không cần thêm file.
// Đường dẫn có số phiên bản: cập nhật logo thì Chrome tải ảnh mới, không dùng ảnh cũ trong bộ nhớ đệm.

const FILES: Record<string, string> = {
  "icon-32.png": icon32,
  "icon-64.png": icon64,
  "icon-180.png": icon180,
  "masys.png": full360,
};

export const LOGO_PREFIX = "/logo/";
export const logoUrl = (file: keyof typeof FILES | string) => `${LOGO_PREFIX}${file}?v=${APP_VERSION}`;

export function registerLogoRoutes(app: Hono) {
  app.get(`${LOGO_PREFIX}:file`, (c) => {
    const data = FILES[c.req.param("file")];
    if (!data) return c.notFound();
    return c.body(Buffer.from(data, "base64"), 200, {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });
}
