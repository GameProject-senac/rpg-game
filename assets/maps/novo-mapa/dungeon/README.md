# Gerador procedural de masmorras para o Tiled (.tmj)

## Arquivos

| Arquivo | O que é |
|---|---|
| `dungeon_gen.py` | Gerador (Python 3.9+; Pillow só para o preview) |
| `tileset.png` | Seu atlas (176×224, tiles 16×16, 11×14 = 154 ids) |
| `tileset_grid.png` | Atlas ampliado com o id local de cada célula |
| `mapa.tmj` | Mapa de exemplo, 64×48, seed 42 |
| `mapa_preview.png` | Render do mapa de exemplo |

## 1. Análise do tileset

O tileset é de masmorra. O layout segue a referência: fundo escuro, salas e corredores colados
formando uma malha única, faces de tijolo nas bordas norte e sul, faixas finas de muro nas laterais
e passagens abertas entre as áreas. Água, escadas e escadas de mão da referência não existem
no atlas. Os buracos escuros (poços) fazem o papel das áreas alagadas.

Catálogo (id local = linha × 11 + coluna; no `.tmj`, gid = id + 1):

| Grupo | Ids | Observação |
|---|---|---|
| Chão de caverna | 26, 37, 48, 59 | faixa vertical 1×4 |
| Lajotas | 27–31, 38–42, 49–53, 60–64 | bloco 5×4, repetido pela coordenada do mundo |
| Piso liso | 24 | miolo da moldura de parede |
| Piso com detalhe | 130 entulho, 141 rachado, 90 poça, 84/95 alçapão | mesma cor base do 24 |
| Abismo | 85 borda, 86 borda com grade, 96 vazio | |
| Parede 9-slice | 12 13 14 / 23 · 25 / 34 35 36 | cantos e laterais têm transparência |
| Face de parede | 20 com tocha, 79 com cano | |
| Bloco de ruína 2×2 | 56 57 / 67 68 | |
| Coluna (2 de altura) | 82/93, 81/92 com tocha | |
| Grade sobre mureta (2 de altura) | 83/94 | |
| Tocha de parede | 19 | sobreposta à face da parede |
| Estandartes | 106, 107, 108, 117, 118, 119 | |
| Alavancas | 129, 140 | usadas só nas prisões |
| Vasos | 101, 112, 123, 134 | |
| Caixotes / barris | 102, 113 / 103, 114 | |
| Baús | 104, 115 fechados · 105, 116 abertos | |
| Estantes | 124, 135 · alta 126/137 | |
| Mesas | 125, 136, 127, 128 · longa 138+139 | |
| **Não usados** | 80, 91 · 15, 16, 17, 18 | nicho escuro (função ambígua) · porta, arcos e grade levadiça (removidos: passagens abertas) |

As outras 64 células do atlas são transparentes.

## 2. Como o gerador funciona

1. **Salas**: retângulos com pelo menos 2 tiles de muro entre vizinhas na horizontal. Na vertical
   basta 1, e a parede fica compartilhada.
2. **Corredores**: árvore geradora mínima entre as salas, mais alguns atalhos para criar loops.
   Os corredores têm forma de L, com 1 ou 2 tiles de largura. Salas empilhadas ganham passagens extras
   na parede compartilhada.
3. **Limpeza**: remove do piso as formas que não têm tile no atlas, como coluna de muro com 1 tile
   de largura entre dois pisos ou pisos ligados só pela diagonal.
4. **Autotile das paredes**, para cada célula sem piso:
   - piso acima ou abaixo: face `13`. No atlas, `13` e `35` são o mesmo desenho.
   - piso só à direita ou à esquerda: faixa `23` / `25`
   - piso só na diagonal: cantos `12` / `14` / `34` / `36`
5. **Passagens abertas**: não há portas. As aberturas de 1 tile nas paredes ficam livres e nunca recebem mobília.
6. **Poços**: abertos dentro de salas grandes, só quando não desconectam o mapa.
7. **Decoração**: tochas, estandartes (uma cor por sala), cano com poça, entulho e alçapões.
   As alavancas (`129`/`140`) aparecem só nas prisões: no máximo uma por prisão e quatro no mapa.
8. **Mobília por tema** (salão, biblioteca, tesouro, depósito, prisão, alojamento, poço). Cada objeto
   só é colocado se cumprir todas estas regras:
   - fica fora das **passagens** de cada sala. Passagem é cada entrada (onde a sala encosta num
     corredor ou em outra sala) com o anel de células em volta, mais o caminho mais curto entre as
     entradas. Em salas grandes esse caminho é alargado;
   - não fica em **gargalos**, ou seja, piso com parede dos dois lados;
   - caixotes, vasos, barris, baús e estantes ficam **encostados na parede**. Só colunas, mesas e
     grades da prisão ficam no meio da sala;
   - a ocupação é de cerca de 10% do piso da sala, sem objetos colados na diagonal;
   - uma busca em largura confirma que **toda** a masmorra continua acessível.

Camadas, de baixo para cima:

| Camada | Conteúdo |
|---|---|
| `Ground` | piso das salas e vazio |
| `Water` | poços |
| `Paths` | piso dos corredores e das passagens |
| `Walls` | paredes e blocos 2×2 |
| `Decorations` | tochas, estandartes, poças, entulho, alçapões, alavancas |
| `Objects` | mobília |
| `Markers` | camada de objetos: `PlayerStart` e retângulos das salas com `kind` |

Todo tile usado tem uma classe (`type`) e a propriedade `collides` no tileset embutido.

## 3. Uso

```bash
python dungeon_gen.py --width 64 --height 48 --seed 42 --out mapa.tmj --preview mapa_preview.png
```

- `--width` / `--height`: tamanho em tiles (mínimo 32×24)
- `--seed`: sem ele, a seed é aleatória e aparece na saída e nas propriedades do mapa
- `--density`: 0.3 (esparso) a 0.7 (muito denso); o padrão é 0.5
- `--tileset`: caminho do PNG; o `.tmj` grava o caminho relativo a ele mesmo
- `--preview`: PNG renderizado (requer `pip install pillow`)

No fim, o script confere que todo gid é válido, que nenhum aponta para célula vazia do atlas e que o mapa está todo conectado.

## 4. Abrir no Tiled

1. Instale o Tiled 1.10 ou mais recente (https://www.mapeditor.org).
2. Deixe `mapa.tmj` e `tileset.png` **na mesma pasta**.
3. No Tiled, use *File → Open* e escolha `mapa.tmj`.
4. As camadas aparecem no painel *Layers* e podem ser editadas, ocultadas ou travadas.
   O tileset vem embutido no mapa. Para reaproveitá-lo em outros mapas, use *Tileset → Export Tileset As… (.tsj)*.
5. Para ver a colisão, selecione um tile no painel *Tilesets* e confira `collides` em *Properties*.
