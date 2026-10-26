import { GoogleApiError, type Bytes, type GoogleHttp } from "./http.js";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const enc = encodeURIComponent;

export type DriveLink = { kind: "file"; id: string } | { kind: "folder"; id: string } | { kind: "not_drive" };

const ID = "([A-Za-z0-9_-]{10,})";
const FILE_PATH = new RegExp(`^https?://(?:drive|docs)\\.google\\.com/(?:a/[^/]+/)?file/d/${ID}`);
const FOLDER_PATH = new RegExp(`^https?://drive\\.google\\.com/(?:a/[^/]+/)?drive/(?:u/\\d+/)?folders/${ID}`);
const ID_PARAM = new RegExp(`^https?://(?:drive|docs)\\.google\\.com/(?:open|uc|thumbnail)\\?(?:.*&)?id=${ID}`);

/** Nhận dạng link Drive trong cột Ảnh (D14). Trả về null khi ô trống. */
export function parseDriveLink(input: string): DriveLink | null {
  const s = input.trim();
  if (!s) return null;
  let m = FILE_PATH.exec(s) ?? ID_PARAM.exec(s);
  if (m) return { kind: "file", id: m[1]! };
  m = FOLDER_PATH.exec(s);
  if (m) return { kind: "folder", id: m[1]! };
  return { kind: "not_drive" };
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  trashed: boolean;
  thumbnailLink?: string;
}

// Ảnh thu nhỏ của Drive thường vài chục KB; ảnh gốc (dự phòng) giới hạn 10 MB.
const MAX_THUMB = 2 * 1024 * 1024;
const MAX_ORIGINAL = 10 * 1024 * 1024;

export class DriveClient {
  constructor(private readonly http: GoogleHttp) {}

  getFile(fileId: string): Promise<DriveFile> {
    const fields = "id,name,mimeType,trashed,thumbnailLink";
    return this.http<DriveFile>("GET", `${DRIVE}/${enc(fileId)}?fields=${enc(fields)}&supportsAllDrives=true`);
  }

  /** Ảnh thu nhỏ bằng quyền service account; Drive không tạo được thì dùng ảnh gốc. */
  async thumbnail(file: DriveFile): Promise<Bytes> {
    if (file.thumbnailLink) {
      try {
        return await this.http.bytes(file.thumbnailLink, MAX_THUMB);
      } catch {
        // thử ảnh gốc
      }
    }
    if (!file.mimeType.startsWith("image/")) throw new GoogleApiError(415, "File không phải ảnh");
    return this.http.bytes(`${DRIVE}/${enc(file.id)}?alt=media&supportsAllDrives=true`, MAX_ORIGINAL);
  }

  /** Thư mục con trực tiếp (chưa xoá) của một thư mục, theo tên (F4). */
  async listFolders(parentId: string): Promise<DriveFolder[]> {
    const q = `'${parentId.replace(/['\\]/g, "\\$&")}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const r = await this.http<{ files?: DriveFolder[] }>(
      "GET",
      `${DRIVE}?q=${enc(q)}&fields=${enc("files(id,name)")}&orderBy=name&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    );
    return r.files ?? [];
  }

  /**
   * Thư mục tồn tại, chưa nằm trong thùng rác và đúng là thư mục. Nếu không thì báo bằng Error thường
   * (không phải GoogleApiError) để không bị hiểu nhầm thành lỗi chia sẻ sheet.
   */
  async getFolder(folderId: string): Promise<DriveFolder> {
    let f: DriveFile;
    try {
      f = await this.getFile(folderId);
    } catch (e) {
      if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
        throw new Error("Không mở được thư mục: không tồn tại hoặc chưa chia sẻ cho service account");
      }
      throw e;
    }
    if (f.mimeType !== FOLDER_MIME) throw new Error(`"${f.name}" không phải thư mục`);
    if (f.trashed) throw new Error(`Thư mục "${f.name}" đang nằm trong thùng rác`);
    return { id: f.id, name: f.name };
  }
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFolder {
  id: string;
  name: string;
}
