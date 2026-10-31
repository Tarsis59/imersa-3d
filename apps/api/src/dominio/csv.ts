function detectarSeparador(primeiraLinha: string): ';' | ',' {
  const pontoEVirgula = (primeiraLinha.match(/;/g) ?? []).length;
  const virgula = (primeiraLinha.match(/,/g) ?? []).length;
  return pontoEVirgula > 0 && pontoEVirgula >= virgula ? ';' : ',';
}

/** CSV no padrão RFC 4180, com separador detectado (`;` do Excel em português ou `,`). Ignora linhas vazias. */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const fim = t.search(/\r?\n/);
  const sep = detectarSeparador(fim === -1 ? t : t.slice(0, fim));
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  const fecharLinha = () => {
    linha.push(campo);
    campo = '';
    if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
    linha = [];
  };
  for (let i = 0; i < t.length; i++) {
    const ch = t.charAt(i);
    if (aspas) {
      if (ch === '"') {
        if (t.charAt(i + 1) === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += ch;
    } else if (ch === '"' && campo === '') aspas = true;
    else if (ch === sep) {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t.charAt(i + 1) === '\n') i++;
      fecharLinha();
    } else campo += ch;
  }
  if (aspas) throw new Error('aspas não fechadas no arquivo');
  fecharLinha();
  return linhas;
}
