"""IFC → GLB para a web: Y para cima (padrão glTF), nós com o GlobalId do IFC e o tipo IFC em `extras`."""

import multiprocessing
from pathlib import Path

import ifcopenshell.geom as geom

from .glb import gravar_glb, ler_glb
from .metadados import abrir, ler_metadados


def converter(entrada: Path, saida: Path) -> dict:
    f = abrir(entrada)
    s = geom.settings()
    s.set("use-world-coords", True)
    s.set("y-up", True)  # o IFC é Z para cima; a web (glTF/three.js) é Y para cima
    s.set("use-element-guids", True)  # nome do nó = GlobalId: estável entre versões do projeto (vínculo com unidades)
    s.set("weld-vertices", True)
    saida = Path(saida)
    saida.parent.mkdir(parents=True, exist_ok=True)
    ser = geom.serializers.glb(str(saida), s)
    ser.setFile(f)
    ser.writeHeader()
    it = geom.iterator(s, f, multiprocessing.cpu_count(), include=f.by_type("IfcProduct"))
    elementos = 0
    if it.initialize():
        while True:
            ser.write(it.get())
            elementos += 1
            if not it.next():
                break
    ser.finalize()
    if elementos == 0:
        raise ValueError("o IFC não tem geometria para mostrar em 3D")

    # anota cada nó com o tipo IFC (e a área, nos ambientes): o visualizador esconde ambientes não vinculados e o
    # configurador encontra pisos, paredes e forros sem depender de nomes
    meta = ler_metadados(entrada, f)
    area = {e["guid"]: e["area_m2"] for e in meta["espacos"]}
    doc, binario = ler_glb(saida)
    for no in doc.get("nodes", []):
        guid = no.get("name")
        if not guid:
            continue
        try:
            # IfcWallStandardCase/IfcSlabStandardCase (obsoletos no IFC4) viram o tipo base
            classe = f.by_guid(guid).is_a().removesuffix("StandardCase")
        except RuntimeError:
            continue
        no["extras"] = {"ifc": classe, **({"areaM2": area[guid]} if area.get(guid) else {})}
    doc.setdefault("asset", {})["generator"] = "Imersa 3D (IfcOpenShell)"
    gravar_glb(saida, doc, binario)
    return {"elementos": elementos, "bytes": saida.stat().st_size, "metadados": meta}
