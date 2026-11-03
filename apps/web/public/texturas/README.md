# Texturas PBR (Plano 12a, item 5)

Mapas de cor, normal e rugosidade usados pelo viewer (`packages/viewer/src/ambiente/materiaisPbr.ts`) na fachada
procedural, no gramado/calçada do lote e no asfalto/calçada da cidade, só nos níveis de qualidade médio e alto.

## Licença

Todas as texturas vêm da **[ambientCG](https://ambientcg.com)**, licença **CC0 1.0 Universal** (domínio público —
sem necessidade de atribuição, uso livre comercial e não comercial). Texto da licença:
https://creativecommons.org/publicdomain/zero/1.0/

## Origem de cada categoria

| Pasta | Material ambientCG | Link |
|---|---|---|
| `concreto/` | Concrete034 | https://ambientcg.com/view?id=Concrete034 |
| `porcelanato/` | Tiles074 | https://ambientcg.com/view?id=Tiles074 |
| `madeira/` | WoodFloor041 | https://ambientcg.com/view?id=WoodFloor041 |
| `grama/` | Grass001 | https://ambientcg.com/view?id=Grass001 |
| `asfalto/` | Asphalt012 | https://ambientcg.com/view?id=Asphalt012 |

Baixadas em 02/11/2026, no tamanho 1K-JPG original (`<Material>_1K-JPG.zip`, mapas `_Color`, `_NormalGL` e
`_Roughness`). Processadas localmente (sem serviço pago): redimensionadas para 512×512 e convertidas para WebP
(qualidade 68–80), para caber no limite de ≤ 3 MB do plano — o total das 5 categorias (15 arquivos) ficou em
~420 KB.

## Arquivos

Cada pasta (`concreto/`, `porcelanato/`, `madeira/`, `grama/`, `asfalto/`) tem:
- `cor.webp` — mapa de cor (albedo), espaço de cor sRGB.
- `normal.webp` — mapa de normal (OpenGL/+Y, `NormalGL`).
- `rugosidade.webp` — mapa de rugosidade (canal vermelho).
