CREATE TABLE sync_sheet_generations (
  spreadsheet_id TEXT NOT NULL,
  sheet_id INTEGER NOT NULL,
  generation TEXT NOT NULL,
  PRIMARY KEY (spreadsheet_id,sheet_id)
);
