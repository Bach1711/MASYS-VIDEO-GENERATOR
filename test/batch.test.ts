import { describe, expect, it } from "vitest";
import { activeRows, getBatch } from "../src/batch/create.js";
import {
  DEFAULT_SHIRT_TEMPLATE,
  DEFAULT_TEMPLATE,
  combineExtra,
  fileStamp,
  renderTemplate,
  validateShirtTemplate,
  validateTemplate,
  videoFileName,
  type TemplateValues,
} from "../src/batch/template.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { getSettings, setDriveRootFolder, setRequestTemplate } from "../src/db/settings.js";
import { saveSheetConfig, type SheetConfig } from "../src/db/sheetConfigs.js";
import { DriveClient, FOLDER_MIME, type DriveFile } from "../src/google/drive.js";
import { GoogleApiError } from "../src/google/http.js";
import type { Grid, SheetsClient } from "../src/google/sheets.js";
import { ThumbnailCache } from "../src/scan/thumbnails.js";
import { createApp } from "../src/web/app.js";

const ID = "1n8HgHWnmVQocIxycDJpXxldIEt4gnvvmiZ631LnOhSg";
const TAB = "Trang tính1";
const ROOT = "1eTZ0IlgShDhv4wMfH6OZ1Uwo5ve9GIOB";
const VIDEO = "1ktAlBSjKy-C_uZfgBnTe_yWcmIShHLSI";
const OTHER = "1OTHERfolderxxxxxxxxxxxxxxxxxx";
const CFG: SheetConfig = { spreadsheetId: ID, tab: TAB, headerRow: 1, colImage: "A", colPrompt: "B", colVideo: "C", colStatus: "D" };
const img = (id: string) => `https://drive.google.com/file/d/${id}/view`;

describe("mẫu yêu cầu §8.2", () => {
  const values: TemplateValues = {
    link_anh: img("imgimgimg02"),
    doan_ghep_ao: "",
    prompt: "Người mẫu cười, chỉ vào hình in {o_video}",
    yeu_cau_them: "nền phòng ngủ",
    link_thu_muc: `https://drive.google.com/drive/folders/${VIDEO}`,
    ten_file: "Trang tính1_row2_20261026-2215.mp4",
    o_video: "C2",
    ten_tab: TAB,
    link_sheet: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`,
  };

  it("mẫu gốc hợp lệ và điền đủ mọi chỗ trống", () => {
    expect(validateTemplate(DEFAULT_TEMPLATE)).toEqual([]);
    const text = renderTemplate(DEFAULT_TEMPLATE, { ...values, prompt: "Người mẫu cười" });
    expect(text).not.toMatch(/[{}]/);
    expect(text).toContain(`Ảnh: ${img("imgimgimg02")}`);
    expect(text).toContain("Yêu cầu thêm: nền phòng ngủ");
    expect(text).toContain(`Lưu video vào thư mục Google Drive: https://drive.google.com/drive/folders/${VIDEO} (tên file: Trang tính1_row2_20261026-2215.mp4).`);
    expect(text).toContain(`vào ô C2 của tab "Trang tính1" trong Google Sheet https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0.`);
    expect(text).toContain("3. Chỉ sửa đúng ô C2. Không sửa bất kỳ ô nào khác.");
  });

  it("mẫu gốc dặn giữ nguyên bối cảnh và nền, chỉ lấy động tác từ prompt (D27)", () => {
    const text = renderTemplate(DEFAULT_TEMPLATE, { ...values, doan_ghep_ao: "" });
    expect(text).toContain(
      "Giữ nguyên nền, bối cảnh và ánh sáng của ảnh người mẫu; không đổi sang phòng hay khung cảnh khác.\n" +
        "Từ prompt dưới đây chỉ lấy động tác, biểu cảm và cách quay; bỏ qua mọi mô tả bối cảnh, phòng, ánh sáng.\n" +
        "Prompt: Người mẫu cười",
    );
    expect(DEFAULT_SHIRT_TEMPLATE).toContain("chỉ thay chiếc áo, giữ nguyên khuôn mặt, tóc, dáng, tư thế, nền, bối cảnh và ánh sáng của ảnh người mẫu");
    expect(validateShirtTemplate(DEFAULT_SHIRT_TEMPLATE)).toEqual([]);
  });

  it("điền một lượt: chữ {o_video} nằm trong prompt không bị thay", () => {
    expect(renderTemplate("P: {prompt} / ô {o_video}", values)).toBe("P: Người mẫu cười, chỉ vào hình in {o_video} / ô C2");
  });

  it("báo chỗ trống gõ sai và thiếu chỗ bắt buộc", () => {
    expect(validateTemplate("Ảnh {link_anh} {promt} thư mục {link_thu_muc} sheet {link_sheet}")).toEqual([
      "Không có chỗ trống tên: {promt}",
      "Mẫu phải có: {o_video}",
    ]);
    expect(validateTemplate("   ")).toEqual(["Mẫu đang trống."]);
  });

  it("gộp yêu cầu thêm, tên file, dấu thời gian theo giờ máy", () => {
    expect(combineExtra(" giữ hình in ", "nền phòng ngủ")).toBe("giữ hình in; nền phòng ngủ");
    expect(combineExtra("", "  ")).toBe("(không có)");
    expect(fileStamp(new Date(2026, 9, 26, 9, 5))).toBe("20261026-0905");
    expect(videoFileName("Trang tính1", 5, "20261026-0905")).toBe("Trang tính1_row5_20261026-0905.mp4");
    expect(videoFileName('Tháng 10/11: "lô" *', 2, "20261026-0905")).toBe("Tháng 10-11- -lô- -_row2_20261026-0905.mp4");
  });
});

// Dòng 2–4 sẵn sàng, 5 đã có video, 6 đang chạy.
function grid(): Grid {
  return [
    ["Ảnh", "Prompt", "Video", "Trạng Thái"],
    [img("imgimgimg02"), "prompt gốc 2", "", ""],
    [img("imgimgimg03"), "prompt gốc 3", "", ""],
    [img("imgimgimg04"), "prompt gốc 4", "", ""],
    [img("imgimgimg05"), "prompt gốc 5", "https://drive.google.com/file/d/vvvvvvvvvv/view", "Xong"],
    [img("imgimgimg06"), "prompt gốc 6", "", "Đang chạy"],
  ];
}

function setup(opts: { sentToday?: number; root?: string | null } = {}) {
  const sheetGrid = grid();
  const sheetWrites: unknown[] = [];
  const sheets = {
    readTab: async () => sheetGrid,
    readRow: async (_i: string, _t: string, row: number) => sheetGrid[row - 1] ?? [],
    getSpreadsheet: async () => ({ spreadsheetId: ID, title: "MASYS Video – Danh sách", tabs: [{ sheetId: 777, title: TAB, rowCount: 100, columnCount: 4 }] }),
    writeStatus: async (...a: unknown[]) => void sheetWrites.push(a),
  } as unknown as SheetsClient;
  const folders: Record<string, { name: string; mimeType: string; trashed?: boolean }> = {
    [ROOT]: { name: "MASYS Video", mimeType: FOLDER_MIME },
    [VIDEO]: { name: "Video", mimeType: FOLDER_MIME },
    [OTHER]: { name: "Khác", mimeType: FOLDER_MIME },
    "1TRASHEDfolderxxxxxxxxxxxxxxx": { name: "Cũ", mimeType: FOLDER_MIME, trashed: true },
  };
  const getFile = async (id: string): Promise<DriveFile> => {
    const f = folders[id];
    if (f) return { id, name: f.name, mimeType: f.mimeType, trashed: !!f.trashed };
    if (id.startsWith("imgimgimg")) return { id, name: `${id}.jpg`, mimeType: "image/jpeg", trashed: false };
    throw new GoogleApiError(404, "File not found");
  };
  const drive = {
    getFile,
    // Dùng getFolder thật trên getFile giả để kiểm tra luôn cách báo lỗi thư mục.
    getFolder: (id: string) => DriveClient.prototype.getFolder.call({ getFile }, id),
    listFolders: async (parent: string) => (parent === ROOT ? [{ id: "1ANHfolderxxxxxxxxxxxxxxxxxxxx", name: "Ảnh người mẫu" }, { id: VIDEO, name: "Video" }] : []),
    thumbnail: async () => ({ contentType: "image/jpeg", data: new Uint8Array([1]) }),
  } as unknown as DriveClient;

  const config = loadConfig({
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "bot@x.iam.gserviceaccount.com", private_key: "PK" }),
  });
  const db = openDatabase(":memory:");
  saveSheetConfig(db, { ...CFG, spreadsheetTitle: "MASYS Video – Danh sách" });
  if (opts.root !== null) setDriveRootFolder(db, opts.root ?? ROOT);
  if (opts.sentToday) {
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (900, 'X', 'Y', 'F', 'done')").run();
    for (let i = 0; i < opts.sentToday; i++) {
      db.prepare("INSERT INTO runs (batchId, rowNumber, inputSnapshot, state, sentAt) VALUES (900, 2, '{}', 'done', ?)").run(new Date().toISOString());
    }
  }
  const app = createApp(config, db, { sheets, drive, thumbs: new ThumbnailCache(drive) });
  const post = (fields: [string, string][]) =>
    app.request("/batch/prepare", { method: "POST", body: new URLSearchParams([["id", ID], ["tab", TAB], ...fields]) });
  return { app, db, post, sheetGrid, sheetWrites };
}

/** Lấy các trường ẩn/ô nhập của form cuối trang để gửi bước tiếp theo, như trình duyệt làm. */
function formFields(html: string): [string, string][] {
  const fields: [string, string][] = [];
  const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const forms = html.split('<form method="post" action="/batch/prepare"');
  const last = forms[forms.length - 1]!.split("</form>")[0]!;
  for (const m of last.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/?>/g)) fields.push([m[1]!, decode(m[2]!)]);
  for (const m of last.matchAll(/<textarea[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) fields.push([m[1]!, decode(m[2]!)]);
  for (const m of last.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const sel = /<option value="([^"]*)" selected=""/.exec(m[2]!);
    if (sel) fields.push([m[1]!, sel[1]!]);
  }
  for (const m of last.matchAll(/<input id="folderLink" name="(folderLink)" type="text" value="([^"]*)"/g)) fields.push([m[1]!, decode(m[2]!)]);
  return fields;
}

const setField = (fields: [string, string][], name: string, value: string) =>
  fields.filter(([k]) => k !== name).concat([[name, value]]) as [string, string][];

describe("trang Chuẩn bị lô", () => {
  it("bước 1: mỗi dòng có prompt điền sẵn từ sheet + ô yêu cầu thêm; có ô yêu cầu chung; chọn sẵn thư mục Video", async () => {
    const { post } = setup();
    const res = await post([["row", "2"], ["row", "3"]]);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<textarea id="prompt_2" name="prompt_2" rows="5">prompt gốc 2<\/textarea>/);
    expect(html).toContain('name="extra_3"');
    expect(html).toContain('name="batchExtra"');
    expect(html).toMatch(new RegExp(`<option value="${VIDEO}" selected="">📁 MASYS Video / Video</option>`));
    expect(html).toContain("📁 MASYS Video / Ảnh người mẫu");
    expect(html).toContain("Hôm nay: <strong>0/5 video</strong>");
  });

  it("§12.4: prompt và yêu cầu thêm đã sửa nằm đúng trong requestText; sheet không bị ghi ô nào", async () => {
    const { post, db, sheetGrid, sheetWrites } = setup();
    let fields = formFields(await (await post([["row", "2"], ["row", "5"], ["overwrite", "5"]])).text());
    fields = setField(fields, "prompt_2", "PROMPT ĐÃ SỬA cho dòng 2");
    fields = setField(fields, "extra_2", "nền phòng ngủ");
    fields = setField(fields, "batchExtra", "giữ nguyên hình in");

    const preview = await post([...fields.filter(([k]) => k !== "id" && k !== "tab"), ["step", "preview"]]);
    expect(preview.status).toBe(200);
    const previewHtml = await preview.text();
    expect(previewHtml).toContain("Prompt: PROMPT ĐÃ SỬA cho dòng 2");
    expect(previewHtml).toContain("Yêu cầu thêm: giữ nguyên hình in; nền phòng ngủ");
    expect(previewHtml).toContain("Yêu cầu thêm: giữ nguyên hình in\n");
    expect(previewHtml).toContain("ô C5");
    expect(previewHtml).toContain(`#gid=777`);
    expect(previewHtml).toContain(`folders/${VIDEO}`);

    const create = await post([...formFields(previewHtml).filter(([k]) => k !== "id" && k !== "tab"), ["step", "create"]]);
    expect(create.status).toBe(303);
    const batchId = Number(create.headers.get("location")!.match(/\/batch\/(\d+)/)![1]);
    const b = getBatch(db, batchId)!;
    expect(b).toMatchObject({ status: "queued", driveFolderId: VIDEO, extraRequest: "giữ nguyên hình in" });
    expect(b.runs.map((r) => [r.rowNumber, r.state, r.overwrite])).toEqual([[2, "queued", 0], [5, "queued", 1]]);
    expect(b.runs[0]!.promptSent).toBe("PROMPT ĐÃ SỬA cho dòng 2");
    expect(b.runs[0]!.requestText).toContain("Prompt: PROMPT ĐÃ SỬA cho dòng 2");
    expect(b.runs[0]!.requestText).toContain("Yêu cầu thêm: giữ nguyên hình in; nền phòng ngủ");
    expect(b.runs[0]!.requestText).toMatch(/tên file: Trang tính1_row2_\d{8}-\d{4}\.mp4/);
    expect(b.runs[1]!.promptSent).toBe("prompt gốc 5");

    const snap = JSON.parse((db.prepare("SELECT inputSnapshot FROM runs WHERE rowNumber = 2").get() as { inputSnapshot: string }).inputSnapshot);
    expect(snap).toEqual({ image: img("imgimgimg02"), shirt: "", prompt: "prompt gốc 2", video: "", status: "" });
    expect(sheetGrid[1]![1]).toBe("prompt gốc 2");
    expect(sheetWrites).toEqual([]);
    const events = db.prepare("SELECT toState, message FROM run_events ORDER BY id").all();
    expect(events).toEqual([
      { toState: "queued", message: `Tạo lô #${batchId}` },
      { toState: "queued", message: `Tạo lô #${batchId} (ghi đè)` },
    ]);
  });

  it("dán link thư mục khác thì dùng link đó; link sai hoặc thư mục trong thùng rác thì báo lỗi", async () => {
    const { post } = setup();
    const base = formFields(await (await post([["row", "2"]])).text()).filter(([k]) => k !== "id" && k !== "tab");
    const ok = await (await post([...setField(base, "folderLink", `https://drive.google.com/drive/folders/${OTHER}?usp=sharing`), ["step", "preview"]])).text();
    expect(ok).toContain(`folders/${OTHER}`);
    expect(ok).toContain("📁 Khác");
    const bad = await post([...setField(base, "folderLink", "https://drive.google.com/file/d/imgimgimg02/view"), ["step", "preview"]]);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Link thư mục không đúng dạng");
    const trashed = await (await post([...setField(base, "folderLink", "https://drive.google.com/drive/folders/1TRASHEDfolderxxxxxxxxxxxxxxx"), ["step", "preview"]])).text();
    expect(trashed).toContain("đang nằm trong thùng rác");
    const missing = await (await post([...setField(base, "folderLink", "https://drive.google.com/drive/folders/1NOPEnopenopenopenopenope"), ["step", "preview"]])).text();
    expect(missing).toContain("Không mở được thư mục");
    expect(missing).not.toContain("Chia sẻ sheet");
  });

  it("prompt bị xoá trống thì không cho xem trước", async () => {
    const { post } = setup();
    const base = formFields(await (await post([["row", "2"]])).text()).filter(([k]) => k !== "id" && k !== "tab");
    const res = await post([...setField(base, "prompt_2", "   "), ["step", "preview"]]);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Prompt dòng 2 đang trống.");
  });

  it("dữ liệu sheet đổi sau khi xem trước → không tạo lô, bắt xem lại", async () => {
    const { post, db, sheetGrid } = setup();
    const base = formFields(await (await post([["row", "2"]])).text()).filter(([k]) => k !== "id" && k !== "tab");
    const preview = await (await post([...base, ["step", "preview"]])).text();
    sheetGrid[1]![0] = img("imgimgimg09"); // ai đó đổi ảnh dòng 2
    const res = await post([...formFields(preview).filter(([k]) => k !== "id" && k !== "tab"), ["step", "create"]]);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Hãy xem lại rồi bấm Tạo lô");
    expect(db.prepare("SELECT COUNT(*) n FROM batches").get()).toEqual({ n: 0 });
  });

  it("không xếp một dòng vào hai lô chưa xong; loại dòng không hợp lệ; chặn khi vượt giới hạn ngày", async () => {
    const { post, db } = setup();
    const base = formFields(await (await post([["row", "2"], ["row", "3"]])).text()).filter(([k]) => k !== "id" && k !== "tab");
    const preview = await (await post([...base, ["step", "preview"]])).text();
    await post([...formFields(preview).filter(([k]) => k !== "id" && k !== "tab"), ["step", "create"]]);
    expect([...activeRows(db, ID, TAB)].sort()).toEqual([2, 3]);

    const again = await (await post([["row", "2"], ["row", "4"], ["row", "5"], ["row", "6"]])).text();
    expect(again).toContain("dòng 2 (đang nằm trong một lô chưa chạy xong)");
    expect(again).toContain("dòng 5 (Đã có video)");
    expect(again).toContain("dòng 6 (Đang chạy)");
    expect(again).toContain('name="prompt_4"');
    expect(again).not.toContain('name="prompt_2"');

    const full = setup({ sentToday: 4 });
    const res = await full.post([["row", "2"], ["row", "3"]]);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("hôm nay chỉ còn 1 video");
  });

  it("dùng mẫu đã sửa trong Cài đặt; mẫu lỗi thì không cho xem trước", async () => {
    const { post, db } = setup();
    setRequestTemplate(db, "MẪU RIÊNG ảnh={link_anh} thư mục={link_thu_muc} ô={o_video} sheet={link_sheet}");
    const base = formFields(await (await post([["row", "3"]])).text()).filter(([k]) => k !== "id" && k !== "tab");
    expect(await (await post([...base, ["step", "preview"]])).text()).toContain(`MẪU RIÊNG ảnh=${img("imgimgimg03")}`);
    setRequestTemplate(db, "thiếu hết");
    expect(await (await post([...base, ["step", "preview"]])).text()).toContain("Mẫu yêu cầu đang lỗi");
  });

  it("chưa đặt thư mục gốc thì vẫn dán link được", async () => {
    const { post } = setup({ root: null });
    const html = await (await post([["row", "2"]])).text();
    expect(html).toContain("Chưa đặt thư mục gốc");
  });
});

describe("trang Cài đặt (thư mục gốc, mẫu yêu cầu)", () => {
  const form = (o: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(o) });

  it("đặt thư mục gốc bằng link, từ chối link không phải thư mục", async () => {
    const { app, db } = setup({ root: null });
    expect((await app.request("/settings/root", form({ link: `https://drive.google.com/drive/folders/${ROOT}` }))).status).toBe(303);
    expect(getSettings(db).driveRootFolderId).toBe(ROOT);
    expect(await (await app.request("/settings")).text()).toContain("📁 MASYS Video");
    const bad = await app.request("/settings/root", form({ link: "https://example.com" }));
    expect(bad.status).toBe(400);
    expect(getSettings(db).driveRootFolderId).toBe(ROOT);
  });

  it("lưu mẫu hợp lệ, từ chối mẫu lỗi, khôi phục mẫu gốc", async () => {
    const { app, db } = setup();
    expect(await (await app.request("/settings")).text()).toContain("Đang dùng mẫu gốc");
    const custom = "Ảnh {link_anh}\r\nlưu {link_thu_muc} ô {o_video} sheet {link_sheet}";
    expect((await app.request("/settings/template", form({ action: "save", template: custom }))).status).toBe(303);
    expect(getSettings(db).requestTemplate).toBe(custom.replace(/\r\n/g, "\n"));

    const bad = await app.request("/settings/template", form({ action: "save", template: "{link_anh} {promt}" }));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("{promt}");
    expect(getSettings(db).requestTemplate).toBe(custom.replace(/\r\n/g, "\n"));

    await app.request("/settings/template", form({ action: "reset" }));
    expect(getSettings(db).requestTemplate).toBeNull();
  });
});

describe("ghép ảnh áo (CON-46, spec v4.4)", () => {
  /** Sheet có thêm cột E "Ảnh áo": dòng 2 có ảnh áo, dòng 3 để trống. */
  function withShirt(o: { shirt?: string } = {}) {
    const t = setup();
    saveSheetConfig(t.db, { ...CFG, colShirt: "E" });
    t.sheetGrid[0]!.push("Ảnh áo");
    t.sheetGrid[1]!.push(o.shirt ?? img("imgimgimg12"));
    t.sheetGrid[2]!.push("");
    return t;
  }
  const previewOf = async (t: ReturnType<typeof withShirt>, rows: string[]) => {
    const fields = formFields(await (await t.post(rows.map((r) => ["row", r] as [string, string]))).text());
    return t.post([...fields.filter(([k]) => k !== "id" && k !== "tab"), ["step", "preview"]]);
  };

  it("dòng có ảnh áo có đoạn ghép áo ngay dưới ảnh người mẫu; dòng không có thì giữ nguyên như cũ, không dòng trống thừa", async () => {
    const t = withShirt();
    const editHtml = await (await t.post([["row", "2"], ["row", "3"]])).text();
    expect(editHtml).toContain(`/thumb/imgimgimg12`);
    expect(editHtml).toContain("Ghép áo");

    const res = await previewOf(t, ["2", "3"]);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(
      `Ảnh: ${img("imgimgimg02")}\nẢnh áo: ${img("imgimgimg12")}\nHãy ghép chiếc áo trong ảnh áo vào người mẫu trong ảnh người mẫu ở trên: chỉ thay chiếc áo,`,
    );
    expect(html).toContain(`Ảnh: ${img("imgimgimg03")}\nGiữ nguyên nền, bối cảnh và ánh sáng của ảnh người mẫu;`);
    expect(html).toContain("bỏ qua mọi mô tả bối cảnh, phòng, ánh sáng.\nPrompt: prompt gốc 3");
    expect(html.match(/Ảnh áo:/g)).toHaveLength(1);
    expect(html).not.toContain("{doan_ghep_ao}");
    expect(html).not.toContain("thiếu chỗ {doan_ghep_ao}");
  });

  it("đoạn ghép áo đã sửa trong Cài đặt được dùng; mẫu chính thiếu {doan_ghep_ao} thì Xem trước cảnh báo", async () => {
    const t = withShirt();
    t.db.prepare("UPDATE settings SET shirtTemplate = ? WHERE id = 1").run("ÁO: {link_anh_ao} — ghép vào người mẫu.");
    let html = await (await previewOf(t, ["2"])).text();
    expect(html).toContain(`ÁO: ${img("imgimgimg12")} — ghép vào người mẫu.`);

    setRequestTemplate(t.db, DEFAULT_TEMPLATE.replace("{doan_ghep_ao}\n", ""));
    html = await (await previewOf(t, ["2"])).text();
    expect(html).toContain("thiếu chỗ {doan_ghep_ao}");
    expect(html).not.toContain("ÁO:");
  });

  it("link ảnh áo hỏng → dòng Thiếu dữ liệu, không vào lô", async () => {
    const t = withShirt({ shirt: "https://example.com/ao.png" });
    const res = await t.post([["row", "2"]]);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("dòng 2 (Thiếu dữ liệu)");
  });

  it("lưu link ảnh áo vào inputSnapshot khi tạo lô", async () => {
    const t = withShirt();
    const preview = await (await previewOf(t, ["2"])).text();
    const create = await t.post([...formFields(preview).filter(([k]) => k !== "id" && k !== "tab"), ["step", "create"]]);
    expect(create.status).toBe(303);
    const snap = JSON.parse((t.db.prepare("SELECT inputSnapshot FROM runs WHERE rowNumber = 2").get() as { inputSnapshot: string }).inputSnapshot);
    expect(snap.shirt).toBe(img("imgimgimg12"));
  });

  it("Cài đặt: khung Đoạn ghép áo lưu / báo lỗi / khôi phục; báo khi mẫu chính thiếu chỗ ghép áo", async () => {
    const { app, db } = setup();
    const form = (f: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(f) });
    let page = await (await app.request("/settings")).text();
    expect(page).toContain("Đoạn ghép áo");
    expect(page).toContain("{link_anh_ao}");
    expect(page).not.toContain("thiếu chỗ {doan_ghep_ao}");

    const bad = await app.request("/settings/shirt", form({ action: "save", template: "Ghép áo {link_ao}" }));
    expect(bad.status).toBe(400);
    const badHtml = await bad.text();
    expect(badHtml).toContain("Không có chỗ trống tên: {link_ao}");
    expect(badHtml).toContain("Mẫu phải có: {link_anh_ao}");
    expect(getSettings(db).shirtTemplate).toBeNull();

    const ok = await app.request("/settings/shirt", form({ action: "save", template: "Áo: {link_anh_ao}" }));
    expect(ok.status).toBe(303);
    expect(getSettings(db).shirtTemplate).toBe("Áo: {link_anh_ao}");
    await app.request("/settings/shirt", form({ action: "reset" }));
    expect(getSettings(db).shirtTemplate).toBeNull();

    setRequestTemplate(db, DEFAULT_TEMPLATE.replace("{doan_ghep_ao}\n", ""));
    page = await (await app.request("/settings")).text();
    expect(page).toContain("thiếu chỗ {doan_ghep_ao}");
  });
});
