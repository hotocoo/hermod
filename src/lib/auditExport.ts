import type { AuditRow } from './bridge';

/** E-008: audit rows as exported, with the author's display name beside the raw id. */
export interface AuditExportRow { when: string; what: string; detail: string; by: string; byId: string; subject: string }

/** A cell that a spreadsheet would run as a formula gets a leading quote so it stays text. */
const FORMULA_START = /^[=+\-@\t\r]/;
const cell = (v: string): string => {
  const safe = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const CSV_HEAD = ['When', 'What', 'Detail', 'By', 'By id', 'Subject'];

export const exportRows = (rows: AuditRow[], nameOf: (id: string) => string): AuditExportRow[] =>
  rows.map((r) => ({ when: new Date(r.ts).toISOString(), what: r.kind, detail: r.detail ?? '', by: nameOf(r.by), byId: r.by, subject: r.subject ?? '' }));

export const toCsv = (rows: AuditExportRow[]): string =>
  [CSV_HEAD, ...rows.map((r) => [r.when, r.what, r.detail, r.by, r.byId, r.subject])].map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';

export const toJson = (rows: AuditExportRow[]): string => JSON.stringify(rows, null, 2);
