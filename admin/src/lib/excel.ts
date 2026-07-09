'use client';

export type ExcelRow = Record<string, string | number>;

// Build + download a multi-sheet .xlsx. Filename gets a date suffix automatically.
// xlsx is imported dynamically so its ~200 KB only loads when the user actually exports.
export async function downloadExcel(filename: string, sheets: { name: string; rows: ExcelRow[] }[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  sheets.forEach(s => {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31)); // Excel tab name cap = 31 chars
  });
  XLSX.writeFile(wb, `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// Convenience for the common single-sheet case.
export async function downloadSheet(filename: string, sheetName: string, rows: ExcelRow[]) {
  return downloadExcel(filename, [{ name: sheetName, rows }]);
}
