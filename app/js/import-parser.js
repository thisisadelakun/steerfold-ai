export const IMPORT_LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, rows: 5000, columns: 100 });

function checkCsvQuotes(text) {
  let quoted = false;
  let afterQuote = false;
  let atStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') index += 1;
        else { quoted = false; afterQuote = true; }
      }
    } else if (character === "," || character === "\r" || character === "\n") {
      atStart = true;
      afterQuote = false;
    } else if (character === '"') {
      if (!atStart || afterQuote) throw new Error("CSV contains a misplaced quote. Quote the entire field and escape quotes with two quote characters.");
      quoted = true;
      atStart = false;
    } else {
      if (afterQuote && !/\s/.test(character)) throw new Error("CSV contains text after a closing quote.");
      if (!/\s/.test(character)) atStart = false;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
}

export async function parseImportFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (!["csv", "xlsx"].includes(extension)) throw new Error("Choose a CSV or XLSX file.");
  if (!file.size) throw new Error("The selected file is empty.");
  if (file.size > IMPORT_LIMITS.bytes) throw new Error("Choose a file no larger than 5 MB.");
  const XLSX = await import("../vendor/sheetjs/xlsx.mjs");
  const bytes = await file.arrayBuffer();
  if (extension === "xlsx" && (new Uint8Array(bytes)[0] !== 0x50 || new Uint8Array(bytes)[1] !== 0x4b)) {
    throw new Error("This file is not an XLSX workbook.");
  }
  let workbook;
  let source = bytes;
  if (extension === "csv") {
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("CSV files must use UTF-8 text encoding."); }
    checkCsvQuotes(source);
  }
  try {
    workbook = XLSX.read(source, {
      type: extension === "csv" ? "string" : "array", raw: true,
      cellNF: true, cellText: false, sheetRows: IMPORT_LIMITS.rows + 2,
    });
  } catch {
    throw new Error("The file could not be parsed. Check UTF-8 CSV encoding or an unencrypted XLSX workbook.");
  }
  if (!workbook.SheetNames.length) throw new Error("No worksheets were found.");
  return {
    name: file.name, type: extension.toUpperCase(), sheetNames: [...workbook.SheetNames],
    readSheet(name) {
      const sheet = workbook.Sheets[name];
      if (!sheet?.["!ref"]) throw new Error("This worksheet is empty.");
      const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"]);
      if (range.e.c - range.s.c + 1 > IMPORT_LIMITS.columns) throw new Error("Use at most 100 columns per worksheet.");
      if (range.e.r - range.s.r > IMPORT_LIMITS.rows) throw new Error("Use at most 5,000 data rows per worksheet.");
      // Read raw cell values directly: sheet_to_json can convert date serials to local Dates.
      const matrix = [];
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        matrix.push(Array.from({ length: range.e.c - range.s.c + 1 }, (_, column) => {
          return sheet[XLSX.utils.encode_cell({ r: row, c: range.s.c + column })]?.v ?? "";
        }));
      }
      const first = matrix.findIndex((row) => row.some((value) => String(value).trim() !== ""));
      if (first < 0) throw new Error("This worksheet is empty.");
      const headers = matrix[first].map((value) => String(value ?? "").trim());
      const rows = [];
      for (let index = first + 1; index < matrix.length; index += 1) {
        const values = matrix[index];
        if (!values.some((value) => String(value).trim() !== "")) continue;
        if (values.length > headers.length) throw new Error(`Row ${range.s.r + index + 1} has values without a column header.`);
        const dates = {};
        const percentages = [];
        const formulas = [];
        const cellErrors = [];
        headers.forEach((_, column) => {
          const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + index, c: range.s.c + column })];
          if (cell?.f) formulas.push(column);
          if (cell?.t === "e") cellErrors.push(column);
          if (extension !== "xlsx" || typeof cell?.v !== "number") return;
          if (cell.z && XLSX.SSF.is_date(cell.z)) {
            const date = XLSX.SSF.parse_date_code(cell.v, { date1904: Boolean(workbook.Workbook?.WBProps?.date1904) });
            if (date) dates[column] = `${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
          } else if (cell.z?.includes("%")) percentages.push(column);
        });
        rows.push({ rowNumber: range.s.r + index + 1, values: [...values], dates, percentages, formulas, cellErrors });
      }
      if (!rows.length) throw new Error("No data rows were found below the header.");
      if (rows.length > IMPORT_LIMITS.rows) throw new Error("Use at most 5,000 data rows per worksheet.");
      return { headers, rows };
    },
  };
}
