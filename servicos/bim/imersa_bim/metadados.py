"""Pavimentos, ambientes (com área útil), portas e janelas de um IFC."""

from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element as elemento
import ifcopenshell.util.unit as unidade

# área útil primeiro; a bruta só se o projeto não tiver a útil
CHAVES_AREA = ("NetFloorArea", "GrossFloorArea")


def abrir(caminho: Path) -> ifcopenshell.file:
    try:
        return ifcopenshell.open(str(caminho))
    except Exception as e:  # o IfcOpenShell levanta tipos variados para arquivo ruim
        raise ValueError(f"arquivo IFC inválido: {e}") from e


def _area(espaco, escala_area: float) -> float | None:
    for conjunto in elemento.get_psets(espaco, qtos_only=True).values():
        for chave in CHAVES_AREA:
            if isinstance(conjunto.get(chave), (int, float)) and conjunto[chave] > 0:
                return round(conjunto[chave] * escala_area, 2)
    return None


def _andar(objeto):
    """Pavimento que contém o objeto (direto ou por agregação)."""
    atual = objeto
    for _ in range(10):
        pai = elemento.get_container(atual) or elemento.get_aggregate(atual)
        if pai is None:
            return None
        if pai.is_a("IfcBuildingStorey"):
            return pai
        atual = pai
    return None


def ler_metadados(caminho: Path, arquivo: ifcopenshell.file | None = None) -> dict:
    f = arquivo or abrir(caminho)
    escala = unidade.calculate_unit_scale(f)  # unidade de comprimento do projeto → metros
    andares = sorted(f.by_type("IfcBuildingStorey"), key=lambda a: a.Elevation or 0.0)
    espacos = []
    for e in f.by_type("IfcSpace"):
        andar = _andar(e)
        espacos.append(
            {
                "guid": e.GlobalId,
                "nome": e.Name,
                "nome_longo": e.LongName,
                "andar_guid": andar.GlobalId if andar else None,
                "area_m2": _area(e, escala * escala),
            }
        )
    ordem = {a.GlobalId: i for i, a in enumerate(andares)}
    espacos.sort(key=lambda e: (ordem.get(e["andar_guid"], 99), str(e["nome"])))
    return {
        "schema": f.schema,
        "andares": [{"guid": a.GlobalId, "nome": a.Name, "elevacao_m": round((a.Elevation or 0.0) * escala, 3)} for a in andares],
        "espacos": espacos,
        "portas": len(f.by_type("IfcDoor")),
        "janelas": len(f.by_type("IfcWindow")),
    }
