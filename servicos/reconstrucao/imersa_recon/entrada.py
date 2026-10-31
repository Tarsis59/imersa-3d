"""Entrada da captura: ZIP de fotos vindo do celular, aberto com segurança (zip slip, zip bomba, lixo)."""

import zipfile
from pathlib import Path, PurePosixPath

from .rostos import EXTENSOES

MAX_FOTOS = 1000
MAX_BYTES_FOTO = 50 * 1024 * 1024
MAX_BYTES_TOTAL = 6 * 1024**3


class ErroEntrada(ValueError):
    pass


def extrair_zip(
    caminho: Path,
    destino: Path,
    max_fotos: int = MAX_FOTOS,
    max_bytes_foto: int = MAX_BYTES_FOTO,
    max_bytes_total: int = MAX_BYTES_TOTAL,
) -> list[Path]:
    """
    Extrai só as fotos, achatando as pastas (cada uma vai direto em `destino`, pelo nome, nunca pelo caminho do
    ZIP: assim nada escreve fora). Tamanhos conferidos antes e durante a leitura (o cabeçalho pode mentir).
    """
    try:
        arquivo = zipfile.ZipFile(caminho)
    except (zipfile.BadZipFile, OSError) as e:
        raise ErroEntrada("o arquivo enviado não é um ZIP válido") from e
    with arquivo:
        itens = []
        for info in arquivo.infolist():
            nome = PurePosixPath(info.filename.replace("\\", "/")).name
            if info.is_dir() or not nome or nome.startswith(".") or "__MACOSX" in info.filename:
                continue
            if PurePosixPath(nome).suffix.lower() in EXTENSOES:
                itens.append((info, nome))
        if not itens:
            raise ErroEntrada("o ZIP não tem nenhuma foto (.jpg, .jpeg, .png ou .webp)")
        if len(itens) > max_fotos:
            raise ErroEntrada(f"fotos demais no ZIP ({len(itens)}); o limite é {max_fotos}")
        if any(i.file_size > max_bytes_foto for i, _ in itens) or sum(i.file_size for i, _ in itens) > max_bytes_total:
            raise ErroEntrada("foto grande demais dentro do ZIP")

        destino.mkdir(parents=True, exist_ok=True)
        usados: set[str] = set()
        saida: list[Path] = []
        total = 0
        for indice, (info, nome) in enumerate(sorted(itens, key=lambda x: x[0].filename)):
            final = nome if nome.lower() not in usados else f"{indice:04d}_{nome}"
            usados.add(final.lower())
            alvo = destino / final
            lidos = 0
            with arquivo.open(info) as origem, open(alvo, "wb") as f:
                while bloco := origem.read(1024 * 1024):
                    lidos += len(bloco)
                    total += len(bloco)
                    if lidos > max_bytes_foto or total > max_bytes_total:
                        f.close()
                        alvo.unlink(missing_ok=True)
                        raise ErroEntrada("foto grande demais dentro do ZIP")
                    f.write(bloco)
            saida.append(alvo)
        return saida
