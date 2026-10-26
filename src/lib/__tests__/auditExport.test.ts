import { describe, expect, it } from 'vitest';
import { exportRows, toCsv, toJson } from '../auditExport';

const rows = [{ ts: 0, space_id: 's', kind: 'member.remove', by: 'u1', subject: 'u2', detail: 'said "bye", left' }];
const names = (id: string) => ({ u1: 'Ada' })[id] ?? id;

describe('E-008 audit export', () => {
  it('writes the author name, quotes commas and quotes', () => {
    const csv = toCsv(exportRows(rows, names));
    expect(csv.split('\r\n')[1]).toBe('1970-01-01T00:00:00.000Z,member.remove,"said ""bye"", left",Ada,u1,u2');
  });
  it('keeps formula-looking text inert', () => {
    expect(toCsv(exportRows([{ ...rows[0], detail: '=HYPERLINK("x")' }], names))).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
  });
  it('round-trips as JSON with both name and id', () => {
    expect(JSON.parse(toJson(exportRows(rows, names)))[0]).toMatchObject({ by: 'Ada', byId: 'u1' });
  });
});
