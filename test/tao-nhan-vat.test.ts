import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getNhanVat, listNhanVat } from "../src/anh/nhanVat.js";
import { addRow } from "../src/anh/rows.js";
import { insertAnhBatch, planAnhBatch } from "../src/anh/run.js";
import {
  buildCore,
  buildFillPrompt,
  chosenFile,
  criteriaProblems,
  draftFiles,
  draftRuns,
  FACE_PROMPT,
  getDraft,
  listDrafts,
  masterPrompt,
  parseFillAnswer,
  readCriteria,
  TURNAROUND_PROMPT,
  type Criteria,
} from "../src/anh/taoNhanVat.js";
import { BangFiles } from "../src/bang/files.js";
import { BotError, type WatchResult } from "../src/bot/museBot.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { getDailyQuota, getImageQuota } from "../src/db/quota.js";
import { getSettings } from "../src/db/settings.js";
import { BatchRunner, type MuseDriver } from "../src/queue/runner.js";
import { createApp } from "../src/web/app.js";

// Tạo nhân vật ngay trong app (CON-81, spec 17.14, D35).

const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, n]);
const H = { "X-Masys": "1", "Content-Type": "application/json" };
const CORE =
  "24-year-old adult Western European woman, tall slim build, fair skin with light freckles across the nose, oval face, grey-blue eyes, shoulder-length wavy chestnut brown hair parted in the center, small silver hoop earrings, cream cropped knit sweater, light blue wide-leg jeans, white canvas sneakers";
const EMMA: Criteria = {
  tuoi: "24",
  khuVuc: "Western European",
  gioiTinh: "woman",
  vocDang: "tall slim build",
  da: "fair skin with light freckles across the nose",
  khuonMat: "oval face",
  mat: "grey-blue eyes",
  toc: "shoulder-length wavy chestnut brown hair parted in the center",
  phuKien: "small silver hoop earrings",
  ao: "cream cropped knit sweater",
  quan: "light blue wide-leg jeans",
  giay: "white canvas sneakers",
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup(o: { sendError?: BotError; neverReply?: boolean; echoAttached?: boolean } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-taonv-"));
  dirs.push(dataDir);
  const files = new BangFiles(dataDir);
  const db = openDatabase(":memory:");
  const log: { text: string; files: string[]; tab: string }[] = [];
  const pages = new Map<string, { src: string; data: Uint8Array }[]>();
  const pending = new Map<string, number>();
  let counter = 10;
  const bot: MuseDriver = {
    isOpen: true,
    async open() {},
    async send(text: string, f: string[] = [], tab = "") {
      if (o.sendError) throw o.sendError;
      log.push({ text, files: f, tab });
      pages.set(tab, f.map((p) => ({ src: "blob:me/attached", data: new Uint8Array(fs.readFileSync(p)) })));
      pending.set(tab, 2);
      return { chatUrl: `https://muse.ai/thread/t${log.length}abcd` };
    },
    async reply() {},
    async watch(tab?: string): Promise<WatchResult> {
      const t = tab ?? "";
      const left = pending.get(t) ?? 0;
      if (left > 0) {
        pending.set(t, left - 1);
        if (left === 1 && !o.neverReply) {
          const list = pages.get(t) ?? [];
          if (o.echoAttached && list[0]) list.push({ src: "blob:muse/echo", data: list[0].data });
          list.push({ src: `blob:muse/${++counter}`, data: png(counter) });
          pages.set(t, list);
        }
      }
      return { closed: false, login: false, approval: false, images: (pages.get(t) ?? []).map((i) => ({ src: i.src, ready: true })) };
    },
    async openChat() {},
    async bringToFront() {},
    async downloadVideo() {
      throw new Error("không dùng");
    },
    async downloadImages(tab: string, from: number) {
      return (pages.get(tab) ?? []).slice(from).map((i) => i.data);
    },
  };
  const runner = new BatchRunner(db, undefined, undefined, bot, { pollMs: 2, minuteMs: 1, secondMs: 1, random: () => 0, bangFiles: files });
  const app = createApp(loadConfig({ MASYS_DATA_DIR: dataDir }), db, { runner });
  db.prepare("UPDATE settings SET pauseMinSec = 0, pauseMaxSec = 0").run();
  const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
  const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
  const create = async (values: Partial<Criteria> = EMMA, ten = "Emma") => {
    const res = await app.request("/nhan-vat/tao", { method: "POST", headers: FORM, body: form({ ten, ...values }) });
    await runner.idle();
    return res;
  };
  const start = async (id: number, kind: string) => {
    const res = await app.request(`/nhan-vat/tao/${id}/chay`, { method: "POST", headers: FORM, body: form({ kind }) });
    await runner.idle();
    return res;
  };
  return { db, files, dataDir, app, runner, log, create, start };
}

describe("Mô tả và prompt", () => {
  it("12 tiêu chí ghép đúng bằng mô tả mẫu của người phụ trách", () => {
    expect(buildCore(EMMA)).toBe(CORE);
    expect(criteriaProblems(EMMA)).toEqual([]);
  });

  it("phụ kiện để trống thì bỏ khỏi mô tả; ô khác thiếu thì báo", () => {
    expect(buildCore({ ...EMMA, phuKien: "" })).not.toContain(",,");
    expect(criteriaProblems({ ...EMMA, phuKien: "" })).toEqual([]);
    expect(criteriaProblems({ ...EMMA, ao: "" })).toEqual(["Chưa điền Áo."]);
    expect(criteriaProblems({ ...EMMA, khuVuc: "Mars" })).toEqual(["Chưa chọn Khu vực."]);
  });

  it("không nhận tuổi dưới 18", () => {
    expect(criteriaProblems({ ...EMMA, tuoi: "17" })[0]).toContain("Tuổi phải là số từ 18");
    expect(criteriaProblems({ ...EMMA, tuoi: "abc" })[0]).toContain("Tuổi phải là số từ 18");
    expect(criteriaProblems({ ...EMMA, tuoi: "18" })).toEqual([]);
  });

  it("prompt giữ nguyên văn, có photorealistic, turnaround và face nói về ảnh đính kèm", () => {
    const m = masterPrompt(CORE);
    expect(m).toContain(`Full-body character design of ${CORE}.`);
    expect(m).toContain("Photorealistic.");
    expect(m).toContain("No text, no logo, no extra people, no props.");
    expect(TURNAROUND_PROMPT).toContain("front, three-quarter, side profile, back");
    expect(TURNAROUND_PROMPT).toContain("wide 16:9 layout");
    expect(FACE_PROMPT).toContain("close-up portrait of the same character");
  });

  it("readCriteria bỏ khoá lạ và xuống dòng", () => {
    const c = readCriteria({ ao: " red\n shirt ", la: "x" });
    expect(c.ao).toBe("red shirt");
    expect(c).not.toHaveProperty("la");
  });
});

describe("Nhờ AI điền", () => {
  it("prompt giữ ô đã điền, hỏi ô trống", () => {
    const text = buildFillPrompt({ ...EMMA, ao: "", giay: "" });
    expect(text).toContain("Khu vực: Western European");
    expect(text).toContain("Áo: (cần điền, ví dụ: cream cropped knit sweater)");
    expect(text).toContain("Giày: (cần điền");
    expect(text).toContain("đúng 12 dòng");
  });

  it("đọc được câu trả lời, kể cả có gạch đầu dòng và in đậm", () => {
    const got = parseFillAnswer("Đây là kết quả:\n- **Áo:** white linen shirt\n2. Tuổi: 26 tuổi\nKhu vực: East Asian\nGiới tính: Woman\nPhụ kiện: none\nLạ: x\nGiày: (cần điền)");
    expect(got).toEqual({ ao: "white linen shirt", tuoi: "26", khuVuc: "East Asian", gioiTinh: "woman" });
  });

  it("bỏ giá trị không hợp lệ", () => {
    expect(parseFillAnswer("Tuổi: 16\nKhu vực: Mars\nGiới tính: robot")).toEqual({});
  });

  it("trang trả mô tả và prompt; không có header riêng thì từ chối", async () => {
    const { app } = setup();
    const res = await app.request("/nhan-vat/tao/xem-truoc", { method: "POST", headers: H, body: JSON.stringify(EMMA) });
    const body = (await res.json()) as { core: string; fillPrompt: string };
    expect(body.core).toBe(CORE);
    expect(body.fillPrompt).toContain("Tuổi: 24");
    const read = await app.request("/nhan-vat/tao/doc-tra-loi", { method: "POST", headers: H, body: JSON.stringify({ answer: "Áo: red shirt" }) });
    expect(((await read.json()) as { fields: unknown }).fields).toEqual({ ao: "red shirt" });
    const no = await app.request("/nhan-vat/tao/xem-truoc", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(no.status).toBe(403);
  });
});

describe("Tạo nhân vật qua Muse", () => {
  it("master không kèm ảnh, turnaround và face kèm master, mỗi ảnh một cuộc trò chuyện; lưu vào thư viện", async () => {
    const { db, log, create, start, app, dataDir } = setup();
    const res = await create();
    expect(res.status).toBe(303);
    const id = listDrafts(db)[0]!.id;
    expect(res.headers.get("location")).toBe(`/nhan-vat/tao/${id}`);
    expect(log).toHaveLength(1);
    expect(log[0]!.text).toContain(CORE);
    expect(log[0]!.files).toEqual([]);

    await start(id, "ca-hai");
    expect(log).toHaveLength(3);
    const master = chosenFile(draftFiles(db, id), "master")!;
    expect(log[1]!.text).toBe(TURNAROUND_PROMPT);
    expect(log[2]!.text).toBe(FACE_PROMPT);
    expect(log[1]!.files[0]).toContain(master.file);
    expect(log[2]!.files[0]).toContain(master.file);
    expect(new Set(log.map((l) => l.tab)).size).toBe(3);

    const html = await (await app.request(`/nhan-vat/tao/${id}`)).text();
    expect(html).toContain("Lưu nhân vật");
    const saved = await app.request(`/nhan-vat/tao/${id}/luu`, { method: "POST" });
    expect(saved.status).toBe(303);
    const nv = listNhanVat(db).find((n) => n.ten === "Emma")!;
    expect(nv.masterFile).toMatch(/^nv\d+-/);
    expect(nv.faceFile).toMatch(/^nv\d+-/);
    expect(getDraft(db, id)!.nhanVatId).toBe(nv.id);
    for (const f of [nv.file, nv.faceFile!, nv.masterFile!]) expect(fs.existsSync(path.join(dataDir, "tep", "nhan-vat", f))).toBe(true);
    expect(fs.readFileSync(path.join(dataDir, "tep", "nhan-vat", nv.file))).toEqual(
      fs.readFileSync(path.join(dataDir, "tep", "anh-tao", chosenFile(draftFiles(db, id), "turnaround")!.file)),
    );

    // Lưu lần nữa không tạo nhân vật thứ hai.
    await app.request(`/nhan-vat/tao/${id}/luu`, { method: "POST" });
    expect(listNhanVat(db)).toHaveLength(1);

    // Nhân vật vừa lưu chạy được trên Bảng ảnh: gửi ảnh 4 góc rồi ảnh mặt, không gửi master.
    const row = addRow(db, { nhanVatId: nv.id, prompt: "đứng trong quán cà phê" });
    const plan = planAnhBatch(db, [row], getSettings(db), "");
    expect(plan.runs).toHaveLength(1);
    insertAnhBatch(db, "", plan.runs);
  });

  it("tạo lại chỉ gửi đúng ảnh đó; ảnh mới được chọn, ảnh cũ vẫn giữ", async () => {
    const { db, log, create, start } = setup();
    await create();
    const id = listDrafts(db)[0]!.id;
    await start(id, "ca-hai");
    await start(id, "face");
    expect(log).toHaveLength(4);
    expect(log[3]!.text).toBe(FACE_PROMPT);
    const faces = draftFiles(db, id).filter((f) => f.kind === "face");
    expect(faces).toHaveLength(2);
    expect(chosenFile(draftFiles(db, id), "face")!.id).toBe(faces[1]!.id);
    expect(draftFiles(db, id).filter((f) => f.kind === "turnaround")).toHaveLength(1);
  });

  it("chọn master khác: ảnh tạo sau đính kèm master đó", async () => {
    const { db, log, create, start, app } = setup();
    await create();
    const id = listDrafts(db)[0]!.id;
    await start(id, "master");
    const first = draftFiles(db, id).filter((f) => f.kind === "master")[0]!;
    await app.request(`/nhan-vat/tao/${id}/chon/${first.id}`, { method: "POST" });
    await start(id, "face");
    expect(log.at(-1)!.files[0]).toContain(first.file);
  });

  it("bỏ ảnh master Muse hiện lại, chỉ lấy ảnh Muse tạo", async () => {
    const { db, create, start } = setup({ echoAttached: true });
    await create();
    const id = listDrafts(db)[0]!.id;
    await start(id, "face");
    expect(draftFiles(db, id).filter((f) => f.kind === "face")).toHaveLength(1);
  });

  it("thiếu ảnh hoặc chưa có master thì không tạo tiếp, không lưu được", async () => {
    const { db, log, create, start, app } = setup();
    await create(EMMA);
    const id = listDrafts(db)[0]!.id;
    await app.request(`/nhan-vat/tao/${id}/luu`, { method: "POST" });
    expect(listNhanVat(db)).toHaveLength(0);
    db.prepare("DELETE FROM nv_draft_files").run();
    const res = await start(id, "face");
    expect(decodeURIComponent(res.headers.get("location")!.replace(/\+/g, " "))).toContain("Tạo ảnh master trước");
    expect(log).toHaveLength(1);
  });

  it("form thiếu tiêu chí hoặc tuổi dưới 18: không tạo bản nháp, không gửi Muse, giữ chữ đã điền", async () => {
    const { db, log, create } = setup();
    const res = await create({ ...EMMA, tuoi: "16" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("light blue wide-leg jeans");
    expect(listDrafts(db)).toHaveLength(0);
    expect(log).toHaveLength(0);
  });

  it("tính vào giới hạn ảnh, không trừ giới hạn video; hết lượt thì không tạo", async () => {
    const { db, log, create, start } = setup();
    await create();
    const id = listDrafts(db)[0]!.id;
    await start(id, "ca-hai");
    expect(getImageQuota(db).used).toBe(3);
    expect(getDailyQuota(db).used).toBe(0);

    db.prepare("UPDATE settings SET dailyImageLimit = 4").run();
    const res = await start(id, "ca-hai");
    expect(decodeURIComponent(res.headers.get("location")!.replace(/\+/g, " "))).toContain("chỉ còn 1 lượt");
    expect(log).toHaveLength(3);
  });

  it("D9: Muse không trả ảnh thì Cần xem, không tự gửi lại", async () => {
    const { db, log, create } = setup({ neverReply: true });
    db.prepare("UPDATE settings SET timeoutMinutes = 1").run();
    await create();
    const id = listDrafts(db)[0]!.id;
    expect(log).toHaveLength(1);
    expect(draftRuns(db, id).master).toMatchObject({ state: "needs_review", error: "quá thời gian" });
    expect(draftFiles(db, id)).toHaveLength(0);
  });

  it("chưa gửi được (giao diện Muse đổi): lô tạm dừng, không tính là đã gửi", async () => {
    const { db, create } = setup({ sendError: new BotError("ui_changed", "Không thấy nút Gửi của Muse", false) });
    await create();
    const id = listDrafts(db)[0]!.id;
    expect(draftRuns(db, id).master!.state).toBe("paused_ui");
    expect(getImageQuota(db).used).toBe(0);
  });

  it("xoá bản nháp đã lưu: nhân vật vẫn còn đủ ảnh; xoá nhân vật thì xoá cả ảnh master", async () => {
    const { db, create, start, app, dataDir } = setup();
    await create();
    const id = listDrafts(db)[0]!.id;
    await start(id, "ca-hai");
    const names = draftFiles(db, id).map((f) => f.file);
    await app.request(`/nhan-vat/tao/${id}/luu`, { method: "POST" });
    const nv = listNhanVat(db)[0]!;
    await app.request(`/nhan-vat/tao/${id}/xoa`, { method: "POST" });
    expect(getDraft(db, id)).toBeUndefined();
    for (const n of names) expect(fs.existsSync(path.join(dataDir, "tep", "anh-tao", n))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "tep", "nhan-vat", nv.masterFile!))).toBe(true);

    await app.request(`/nhan-vat/${nv.id}/xoa`, { method: "POST" });
    expect(getNhanVat(db, nv.id)).toBeUndefined();
    expect(fs.existsSync(path.join(dataDir, "tep", "nhan-vat", nv.masterFile!))).toBe(false);
  });

  it("trang: có nút Tạo nhân vật, ô nhờ AI; trang lô có link về bản nháp", async () => {
    const { db, create, app } = setup();
    expect(await (await app.request("/nhan-vat")).text()).toContain("Tạo nhân vật");
    const html = await (await app.request("/nhan-vat/tao")).text();
    expect(html).toContain("Sao chép prompt nhờ AI điền");
    expect(html).toContain("Điền vào các ô");
    expect(html).toContain("Western European");
    await create();
    const id = listDrafts(db)[0]!.id;
    const batch = draftRuns(db, id).master!.batchId;
    const lo = await (await app.request(`/batch/${batch}`)).text();
    expect(lo).toContain("Tạo nhân vật");
    expect(lo).toContain(`/nhan-vat/tao/${id}`);
    expect(lo).not.toContain("Quay lại Bảng mới");
  });
});
