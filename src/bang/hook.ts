import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { DB } from "../db/index.js";
import { logger } from "../logger.js";
import type { BangFiles } from "./files.js";
import { getRow, pendingHookRows, setHookError, setHookVideo } from "./rows.js";

// Hook đầu video (CON-74, D30), đúng kiểu video mẫu "2914.Fleetwood Mac Hoodie.mp4":
// clip hook (người dùng tự lấy từ YouTube) đặt giữa khung đứng 1080×1920 nền đen, câu hook chữ đen trên nền trắng
// bo góc ngay phía trên clip, rồi mờ dần 0,5 giây sang video Muse. Không tiếng. Muse không làm phần này: tool ghép
// trên máy bằng ffmpeg đi kèm; câu chữ vẽ bằng Chrome (đúng dấu tiếng Việt, khung bo góc từng dòng như TikTok).

export const HOOK_W = 1080;
export const HOOK_H = 1920;
export const HOOK_FPS = 30;
export const FADE_SEC = 0.5;
/** Clip hook ngắn hơn thì không đủ chỗ cho đoạn mờ. */
export const MIN_CLIP_SEC = 1;
/** Khoảng trống giữa câu hook và mép trên clip; câu không lên cao hơn CAPTION_TOP_MIN (chừa chỗ giao diện TikTok). */
const CAPTION_GAP = 40;
const CAPTION_TOP_MIN = 160;

/** Chỗ tìm ffmpeg: biến MASYS_FFMPEG, bản zip (phien-ban\X.Y.Z\ffmpeg\ffmpeg.exe), rồi thư viện ffmpeg-static khi phát triển. */
export function ffmpegCandidates(env: NodeJS.ProcessEnv = process.env, execPath = process.execPath): string[] {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return [env.MASYS_FFMPEG, path.join(path.dirname(execPath), "..", "ffmpeg", exe), path.join(appRoot, "node_modules", "ffmpeg-static", exe)].filter(
    (p): p is string => !!p,
  );
}

export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return ffmpegCandidates(env).find((p) => fs.existsSync(p));
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, _stdout, stderr) => {
      if (err && typeof (err as { code?: unknown }).code !== "number") return reject(err);
      resolve({ code: err ? Number((err as { code?: number }).code) : 0, stderr: String(stderr) });
    });
  });
}

export interface ClipInfo {
  duration: number;
  width: number;
  height: number;
}

/** Đọc độ dài và khổ hình từ dòng thông tin ffmpeg in ra (`ffmpeg -i file`). */
export function parseProbe(stderr: string): ClipInfo | null {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const v = /Stream #[^\n]*Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!d || !v) return null;
  let width = Number(v[1]);
  let height = Number(v[2]);
  // Clip quay dọc trên điện thoại: ffmpeg tự xoay khi giải mã, nên đổi chiều theo góc xoay.
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/.exec(stderr);
  if (rot && Math.abs(Number(rot[1] ?? rot[2])) % 180 === 90) [width, height] = [height, width];
  return { duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]), width, height };
}

export async function probe(ffmpeg: string, file: string): Promise<ClipInfo> {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-i", file], 60_000);
  const info = parseProbe(stderr);
  if (!info) throw new Error("file không phải video hoặc bị hỏng");
  return info;
}

/** Vị trí clip hook (vừa khung 1080×1920, ở giữa) và câu hook (ngay trên clip). */
export function hookLayout(clip: { width: number; height: number }, captionHeight: number): { clipTop: number; clipHeight: number; captionY: number } {
  const fitWidth = clip.width / clip.height >= HOOK_W / HOOK_H;
  const clipHeight = fitWidth ? Math.round((HOOK_W * clip.height) / clip.width / 2) * 2 : HOOK_H;
  const clipTop = Math.round((HOOK_H - clipHeight) / 2);
  const captionY = Math.max(CAPTION_TOP_MIN, clipTop - CAPTION_GAP - captionHeight);
  return { clipTop, clipHeight, captionY };
}

/**
 * Đồ thị lọc ffmpeg: [0] clip hook, [1] video Muse, [2] ảnh câu hook (PNG nền trong).
 * captionY null (clip có chữ sẵn, CON-136): không có ảnh câu hook, chỉ clip rồi mờ sang video.
 */
export function hookFilter(clipSec: number, captionY: number | null): string {
  const frame = `fps=${HOOK_FPS},scale=${HOOK_W}:${HOOK_H}:force_original_aspect_ratio=decrease,pad=${HOOK_W}:${HOOK_H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  const d = clipSec.toFixed(3);
  const offset = (clipSec - FADE_SEC).toFixed(3);
  const head =
    captionY == null
      ? [`[0:v]${frame},trim=duration=${d},setpts=PTS-STARTPTS,format=yuv420p,settb=AVTB[h]`]
      : [
          `[0:v]${frame},trim=duration=${d},setpts=PTS-STARTPTS[bg]`,
          `[2:v]format=rgba[cap]`,
          `[bg][cap]overlay=x=(W-w)/2:y=${captionY}:eof_action=repeat,format=yuv420p,settb=AVTB[h]`,
        ];
  return [
    ...head,
    `[1:v]${frame},format=yuv420p,setpts=PTS-STARTPTS,settb=AVTB[m]`,
    `[h][m]xfade=transition=fade:duration=${FADE_SEC}:offset=${offset},format=yuv420p[out]`,
  ].join(";");
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Trang vẽ câu hook: rộng 1080, chữ đen đậm giữa khung, mỗi dòng một nền trắng bo góc (như chữ TikTok). */
export function captionHtml(text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}
#c{width:${HOOK_W}px;padding:6px 0;text-align:center}
#t{display:inline-block;max-width:600px;font:700 54px/1.3 "Segoe UI","Helvetica Neue",Arial,sans-serif;color:#111;white-space:pre-line;overflow-wrap:anywhere}
#t span{background:#fff;border-radius:16px;padding:4px 18px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
</style></head><body><div id="c"><div id="t"><span>${escapeHtml(text.trim())}</span></div></div></body></html>`;
}

export type CaptionRenderer = (text: string, outPng: string) => Promise<{ height: number }>;

/** Vẽ câu hook thành PNG nền trong bằng Chrome đã cài (cùng Chrome bot dùng, trình duyệt riêng, không hiện cửa sổ). */
export const renderCaptionWithChrome: CaptionRenderer = async (text, outPng) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: HOOK_W, height: 400 }, deviceScaleFactor: 1 });
    await page.setContent(captionHtml(text));
    const box = page.locator("#c");
    await box.screenshot({ path: outPng, omitBackground: true });
    const height = Math.round((await box.boundingBox())?.height ?? 0);
    return { height };
  } finally {
    await browser.close();
  }
};

export interface MergeInput {
  ffmpeg: string;
  clip: string;
  video: string;
  text: string;
  out: string;
  tmpDir: string;
  renderCaption: CaptionRenderer;
}

/** Ghép hook vào đầu video Muse, ghi ra `out` (MP4 H.264, 1080×1920, 30 hình/giây, không tiếng). */
export async function mergeHook(o: MergeInput): Promise<void> {
  const clip = await probe(o.ffmpeg, o.clip).catch(() => {
    throw new Error("clip hook không đọc được (không phải video hoặc bị hỏng)");
  });
  if (clip.duration < MIN_CLIP_SEC) throw new Error(`clip hook quá ngắn (${clip.duration.toFixed(1)} giây), cần ít nhất ${MIN_CLIP_SEC} giây`);
  await probe(o.ffmpeg, o.video).catch(() => {
    throw new Error("video Muse không đọc được");
  });
  const cap = path.join(o.tmpDir, `cau-hook-${process.pid}-${Date.now().toString(36)}.png`);
  // Câu rỗng = clip có chữ sẵn (CON-136): không vẽ câu, không cần Chrome.
  const withText = !!o.text.trim();
  try {
    let captionY: number | null = null;
    if (withText) {
      let height: number;
      try {
        ({ height } = await o.renderCaption(o.text, cap));
      } catch (e) {
        logger.warn({ err: e }, "Không vẽ được câu hook");
        throw new Error("không vẽ được câu hook (cần Google Chrome trên máy)");
      }
      captionY = hookLayout(clip, height).captionY;
    }
    const args = [
      "-hide_banner", "-y",
      "-i", o.clip,
      "-i", o.video,
      ...(withText ? ["-i", cap] : []),
      "-filter_complex", hookFilter(clip.duration, captionY),
      "-map", "[out]", "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      o.out,
    ];
    const r = await run(o.ffmpeg, args, 10 * 60_000);
    if (r.code !== 0 || !fs.existsSync(o.out) || fs.statSync(o.out).size === 0) {
      fs.rmSync(o.out, { force: true });
      const last = r.stderr.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 300);
      logger.warn({ code: r.code, stderr: r.stderr.slice(-2000) }, "ffmpeg ghép hook lỗi");
      throw new Error(`ffmpeg không ghép được (${last || `mã ${r.code}`})`);
    }
  } finally {
    fs.rmSync(cap, { force: true });
  }
}

export interface HookMergerOptions {
  /** Đường dẫn ffmpeg; mặc định tìm theo ffmpegCandidates. */
  ffmpeg?: () => string | undefined;
  renderCaption?: CaptionRenderer;
}

/**
 * Hàng chờ ghép hook (D30): ghép lần lượt từng dòng (ffmpeg nặng máy, không chạy nhiều cùng lúc).
 * Dòng chờ ghép ghi ở bang_rows.hookJob nên tool tắt giữa chừng thì mở lại ghép tiếp (recover).
 */
export class HookMerger {
  private queue: number[] = [];
  private current: number | null = null;
  private pumping = false;
  private waiters: (() => void)[] = [];

  constructor(
    private readonly db: DB,
    private readonly files: Pick<BangFiles, "clipPath" | "videoPath" | "newHookVideo" | "tmpDir" | "removeAny">,
    private readonly o: HookMergerOptions = {},
  ) {}

  /** Dòng đang ghép hoặc đang chờ ghép trong lần chạy này. */
  isBusy(id: number): boolean {
    return this.current === id || this.queue.includes(id);
  }

  enqueue(id: number): void {
    if (!this.queue.includes(id)) this.queue.push(id);
    void this.pump();
  }

  /** Tool mở lại: ghép tiếp các dòng còn chờ. */
  recover(): void {
    for (const id of pendingHookRows(this.db)) this.enqueue(id);
  }

  /** Chờ hàng trống (dùng trong test). */
  idle(): Promise<void> {
    if (!this.pumping && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        this.current = id;
        try {
          await this.mergeRow(id);
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          logger.warn({ err: e, row: id }, "Không ghép được hook");
          if (getRow(this.db, id)?.hookJob != null) setHookError(this.db, id, why);
        }
      }
    } finally {
      this.current = null;
      this.pumping = false;
      for (const w of this.waiters.splice(0)) w();
    }
  }

  private async mergeRow(id: number): Promise<void> {
    const r = getRow(this.db, id);
    if (!r || r.hookJob == null) return;
    const text = r.hookJob;
    if (!r.videoFile) return setHookError(this.db, id, "dòng chưa có video");
    const video = this.files.videoPath(r.videoFile);
    if (!video) return setHookError(this.db, id, "không còn file video trên máy");
    const clip = r.hookClip ? this.files.clipPath(r.hookClip) : undefined;
    if (!clip) return setHookError(this.db, id, "chưa có clip hook (bấm + ở cột Hook để chọn)");
    // text "" = clip có chữ sẵn (CON-136): ghép clip, không vẽ câu hook.
    const ffmpeg = (this.o.ffmpeg ?? findFfmpeg)();
    if (!ffmpeg) return setHookError(this.db, id, "không tìm thấy ffmpeg (bộ ghép video đi kèm tool); giải nén lại bản zip");
    const out = this.files.newHookVideo(id);
    logger.info({ row: id }, "Đang ghép hook");
    await mergeHook({ ffmpeg, clip, video, text, out: out.path, tmpDir: this.files.tmpDir(), renderCaption: this.o.renderCaption ?? renderCaptionWithChrome });
    // Trong lúc ghép, dòng có thể bị xoá, đổi video hoặc xếp ghép lại với câu khác: bản vừa ghép không còn đúng.
    const now = getRow(this.db, id);
    if (!now || now.videoFile !== r.videoFile || now.hookJob !== text || now.hookClip !== r.hookClip) {
      fs.rmSync(out.path, { force: true });
      if (now?.hookJob != null) this.enqueue(id);
      return;
    }
    this.files.removeAny(setHookVideo(this.db, id, out.name, fs.statSync(out.path).size));
    logger.info({ row: id }, "Đã ghép hook");
  }
}
