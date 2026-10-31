import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { lerXlsx, tabelaParaCsv } from './xlsx';

/** Monta um .xlsx mínimo e válido (como o Excel grava) para o teste. */
function xlsx(planilha: string, compartilhadas: string[]): Uint8Array {
  // Texto rico (começa com '<r>') vai sem embrulho, como o Excel grava.
  const si = compartilhadas.map((s) => (s.startsWith('<') ? `<si>${s}</si>` : `<si><t>${s}</t></si>`)).join('');
  return zipSync({
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Unidades" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${si}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${planilha}</sheetData></worksheet>`),
  });
}

describe('leitor de .xlsx', () => {
  it('textos compartilhados, números, texto em linha, células vazias e entidades XML', () => {
    const b = xlsx(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>1</v></c><c r="C2" t="inlineStr"><is><t>101</t></is></c><c r="E2"><v>72.5</v></c></row>' +
        '<row r="4"><c r="A4" t="str"><v>Torre &amp; Cia</v></c><c r="B4"><v>2</v></c></row>',
      ['predio', 'andar', 'codigo', 'Torre Á'],
    );
    expect(lerXlsx(b)).toEqual([
      ['predio', 'andar', 'codigo'],
      ['Torre Á', '1', '101', '', '72.5'],
      [],
      ['Torre & Cia', '2'],
    ]);
  });

  it('texto rico (vários trechos) e colunas depois de Z', () => {
    const b = xlsx('<row r="1"><c r="AA1" t="s"><v>0</v></c></row>', ['<r><t>Tipo </t></r><r><t>2Q</t></r>']);
    expect(lerXlsx(b)[0]?.[26]).toBe('Tipo 2Q');
  });

  it('arquivo que não é planilha vira erro claro', () => {
    expect(() => lerXlsx(new Uint8Array([1, 2, 3]))).toThrow(/não é uma planilha .xlsx válida/);
  });

  it('vira CSV com ; e aspas quando precisa (e a importação já aceita)', () => {
    expect(tabelaParaCsv([['a', 'b;c'], ['diz "oi"', ''], []])).toBe('a;"b;c"\n"diz ""oi""";');
  });
});
