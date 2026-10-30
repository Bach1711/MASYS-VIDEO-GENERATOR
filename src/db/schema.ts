// Spec §9. Mỗi phần tử là một bước migration; chỉ thêm vào cuối, không sửa bước cũ.
// Phiên bản hiện tại lưu ở PRAGMA user_version.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    driveRootFolderId TEXT,
    timeoutMinutes    INTEGER NOT NULL DEFAULT 20,
    pauseMinSec       INTEGER NOT NULL DEFAULT 20,
    pauseMaxSec       INTEGER NOT NULL DEFAULT 60,
    dailyVideoLimit   INTEGER NOT NULL DEFAULT 5,
    museUrl           TEXT,
    requestTemplate   TEXT
  );
  INSERT INTO settings (id) VALUES (1);

  CREATE TABLE sheet_configs (
    spreadsheetId TEXT NOT NULL,
    tab           TEXT NOT NULL,
    headerRow     INTEGER NOT NULL DEFAULT 1,
    colImage      TEXT NOT NULL,
    colPrompt     TEXT NOT NULL,
    colVideo      TEXT NOT NULL,
    colStatus     TEXT NOT NULL,
    PRIMARY KEY (spreadsheetId, tab)
  );

  CREATE TABLE batches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    spreadsheetId TEXT NOT NULL,
    tab           TEXT NOT NULL,
    driveFolderId TEXT NOT NULL,
    extraRequest  TEXT,
    status        TEXT NOT NULL,
    createdAt     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    batchId       INTEGER NOT NULL REFERENCES batches(id),
    rowNumber     INTEGER NOT NULL,
    inputSnapshot TEXT NOT NULL,
    promptSent    TEXT,
    requestText   TEXT,
    overwrite     INTEGER NOT NULL DEFAULT 0,
    state         TEXT NOT NULL DEFAULT 'queued',
    error         TEXT,
    sentAt        TEXT,
    doneAt        TEXT,
    videoLink     TEXT,
    driveFileId   TEXT,
    museChatUrl   TEXT
  );
  CREATE INDEX runs_batch ON runs(batchId);
  CREATE INDEX runs_sentAt ON runs(sentAt);

  CREATE TABLE run_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    runId          INTEGER NOT NULL REFERENCES runs(id),
    at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    fromState      TEXT,
    toState        TEXT NOT NULL,
    message        TEXT,
    screenshotPath TEXT
  );
  CREATE INDEX run_events_run ON run_events(runId);
  `,
  // 2: tên file sheet để hiển thị (không thuộc §9, chỉ phục vụ giao diện).
  `
  ALTER TABLE sheet_configs ADD COLUMN spreadsheetTitle TEXT;
  `,
  // 3: hàng đợi (CON-40). Lý do lô tạm dừng; bản chụp tab trước lượt để vẫn kiểm tra được sau khi tool mở lại.
  `
  ALTER TABLE batches ADD COLUMN pauseReason TEXT;
  ALTER TABLE runs ADD COLUMN tabSnapshot TEXT;
  `,
  // 4: cập nhật trong tool (CON-44). Phiên bản lần chạy trước, để báo "Đã cập nhật / Đã quay về".
  // Từ D16: migration chỉ được THÊM bảng/cột, để bản cũ vẫn mở được dữ liệu khi bấm Quay về.
  `
  ALTER TABLE settings ADD COLUMN lastRunVersion TEXT;
  `,
  // 5: ghép ảnh áo (CON-46, spec v4.4). Cột Ảnh áo tuỳ chọn (NULL = không có); đoạn ghép áo (NULL = mẫu gốc).
  `
  ALTER TABLE sheet_configs ADD COLUMN colShirt TEXT;
  ALTER TABLE settings ADD COLUMN shirtTemplate TEXT;
  `,
  // 6: sửa ngay trên Bảng (CON-50, spec v5.0 D18). Mỗi ô tool ghi lên sheet theo yêu cầu người dùng.
  // kind: 'edit' (sửa một ô), 'fill' (dải prompt), 'add_row' (thêm dòng).
  `
  CREATE TABLE sheet_edits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    spreadsheetId TEXT NOT NULL,
    tab           TEXT NOT NULL,
    cell          TEXT NOT NULL,
    rowNumber     INTEGER NOT NULL,
    field         TEXT NOT NULL,
    oldValue      TEXT NOT NULL,
    newValue      TEXT NOT NULL,
    kind          TEXT NOT NULL
  );
  CREATE INDEX sheet_edits_tab ON sheet_edits(spreadsheetId, tab, at);
  `,
  // 7: bắt đầu nhanh (CON-51). Lần gần nhất thấy Muse đã đăng nhập (kiểm tra hoặc gửi thành công); NULL = chưa biết.
  `
  ALTER TABLE settings ADD COLUMN museReadyAt TEXT;
  `,
  // 8: Bảng cục bộ (CON-71, spec v6.0 mục 17.3, D21, D22, D25). Mỗi dòng của Bảng mới; ảnh là đường dẫn
  // tương đối trong thư mục dữ liệu (tep\anh). AUTOINCREMENT để số dòng không bao giờ bị dùng lại.
  // importedFrom = "<spreadsheetId>|<tab>|<dòng>" khi nhập từ sheet (17.6).
  // Giới hạn ngày: máy còn để mặc định 5 thì lên mặc định mới 100 (D25); máy đã tự đặt số khác giữ nguyên.
  `
  CREATE TABLE bang_rows (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    prompt       TEXT NOT NULL DEFAULT '',
    modelFront   TEXT,
    shirtFront   TEXT,
    modelBack    TEXT,
    shirtBack    TEXT,
    videoFile    TEXT,
    videoBytes   INTEGER,
    videoAt      TEXT,
    deletedAt    TEXT,
    importedFrom TEXT
  );
  CREATE UNIQUE INDEX bang_rows_imported ON bang_rows(importedFrom) WHERE importedFrom IS NOT NULL;
  ALTER TABLE runs ADD COLUMN bangRowId INTEGER;
  ALTER TABLE settings ADD COLUMN twoSidedTemplate TEXT;
  UPDATE settings SET dailyVideoLimit = 100 WHERE id = 1 AND dailyVideoLimit = 5;
  `,
  // 9: Bảng mới tạo video (CON-52, spec v6.0 mục 17.4, 17.5). Lô của Bảng mới có source = 'bang'
  // (không có sheet / thư mục Drive: spreadsheetId, driveFolderId để rỗng). Mẫu yêu cầu riêng của Bảng mới;
  // NULL = dùng mẫu mặc định 17.4.
  `
  ALTER TABLE batches ADD COLUMN source TEXT NOT NULL DEFAULT 'sheet';
  ALTER TABLE settings ADD COLUMN bangTemplate TEXT;
  ALTER TABLE settings ADD COLUMN bangShirtTemplate TEXT;
  CREATE INDEX runs_bangRow ON runs(bangRowId);
  `,
  // 10: Chạy song song (CON-73, D28): số cuộc trò chuyện Muse chờ video cùng lúc, 1–6.
  `
  ALTER TABLE settings ADD COLUMN parallelVideos INTEGER NOT NULL DEFAULT 3;
  `,
];
