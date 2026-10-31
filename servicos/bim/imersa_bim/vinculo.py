"""Sugestão automática de vínculo ambiente do BIM ↔ unidade do espelho de vendas (o resto é ajuste manual)."""

import re
import unicodedata


def _normal(texto: str | None) -> str:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", t)


def _numero(texto: str | None) -> str | None:
    """Número principal ("Apto 101" → "101", "B-12" → "12"); só quando houver exatamente um."""
    nums = re.findall(r"\d+", texto or "")
    return (nums[0].lstrip("0") or "0") if len(nums) == 1 else None


def sugerir_vinculos(espacos: list[dict], unidades: list[dict]) -> list[dict]:
    """
    1º código idêntico ao nome do ambiente (sem espaços, acentos e maiúsculas); 2º mesmo número único.
    Cada ambiente vai para no máximo uma unidade; empate ou ambiguidade fica para o ajuste manual.
    """
    usados: set[str] = set()
    sugestoes: list[dict] = []
    for criterio in ("codigo", "numero"):
        for u in unidades:
            if any(s["unidadeId"] == u["id"] for s in sugestoes):
                continue
            if criterio == "codigo":
                alvo = _normal(u["codigo"])
                candidatos = [e for e in espacos if alvo and alvo in (_normal(e["nome"]), _normal(e.get("nome_longo")))]
            else:
                alvo = _numero(u["codigo"])
                candidatos = [e for e in espacos if alvo and alvo in (_numero(e["nome"]), _numero(e.get("nome_longo")))]
            livres = [e for e in candidatos if e["guid"] not in usados]
            if len(livres) == 1:
                usados.add(livres[0]["guid"])
                sugestoes.append({"unidadeId": u["id"], "espacoGuid": livres[0]["guid"], "motivo": criterio})
    return sugestoes
