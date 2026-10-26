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
];
