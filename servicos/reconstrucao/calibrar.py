"""Mostra as medidas do validador em cada conjunto rotulado (para ajustar os limites)."""
import time

from imersa_recon.validador import avaliar
from tests.conjunto_rotulado import Fotos, conjuntos

f = Fotos()
print({c: (len(v), f.ler(v[0]).shape) for c, v in f.cenas.items()})
acertos = 0
lista = conjuntos(f)
for nome, imgs, esperado in lista:
    t = time.time()
    r = avaliar(imgs)
    acertos += r.aprovado == esperado
    m = {k: round(v, 2) for k, v in r.metricas.items()}
    print(f"{'OK ' if r.aprovado == esperado else 'ERRO'} {nome:20s} esperado={esperado!s:5} aprovado={r.aprovado!s:5} {time.time() - t:4.1f}s {m}")
print(f"acerto: {acertos}/{len(lista)}")
