# Mapa principal (200×200)

Mapa do mundo normal do jogo: 200×200 tiles de 16 px, ou seja, 3200×3200 px, o mesmo tamanho do
mundo definido em `server.js` (`GAME_ZONES.mapa_normal`).

## Arquivos

| Arquivo | O que é |
|---|---|
| `mapa.tmj` | Mapa no formato Tiled JSON |
| `Grass.png`, `Props.png`, `Plants.png`, `Wall.png` | Os 4 atlas usados pelo mapa |
| `mapa_preview.png` | Render do mapa (3200×3200). O portal desenhado nele é só referência: no jogo ele é um sprite animado |
| `ferramentas/` | Scripts que geraram o mapa (opcional) |

## Abrir no Tiled

1. Use o Tiled 1.10 ou mais recente.
2. Deixe `mapa.tmj` e os 4 PNGs **na mesma pasta**.
3. Abra `mapa.tmj` com *File → Open*.

## Camadas

Os nomes das camadas e dos tilesets são os mesmos que `ExploracaoCombate.js` procura. **Não os renomeie.**

| Camada | Conteúdo |
|---|---|
| `chao` | Grama e trilhas (Grass) |
| `props` | Pedras, estátuas, obeliscos e ruínas (Props, Wall) |
| `props2` | Props sobrepostos: círculo de pedras do spawn e portões de pilares |
| `arvores 2` | Árvores de trás |
| `arvores` | Árvores da frente: quando duas se sobrepõem, a que está mais ao sul fica aqui |

Tilesets e `firstgid`: Grass 1, Props 2049, Plants 3073, Wall 7169.

## Pontos fixos do jogo

Estas áreas ficam livres no mapa. Se mudar as posições no código, ajuste o mapa também.

| Ponto | Pixels | Tile | Onde está no código |
|---|---|---|---|
| Spawn do player | (1600, 1600) | (100, 100), no centro do círculo de pedras | `SPAWN_INICIAL` em `server.js` |
| Portal do boss | (480, 1600) | (30, 100), entre os dois obeliscos e logo acima da estrada | `PORTAL_BOSS_ENTRY` em `server.js` e em `ExploracaoCombate.js` |
| Spawns de inimigo | (320\|2880, 320\|2880) | (20\|180, 20\|180) | `ENEMY_SPAWN_POINTS` em `server.js` |

A arena do boss continua em 4000–6000. O client considera que o jogador está na arena quando
x e y são ≥ 3600 (`ARENA_CUT`). Esse valor precisa ficar entre o fim do mapa (3200) e o início da arena (4000).

## Layout

- **Área feita à mão:** o desenho original do Godot (101×60) fica no centro-sul, a partir do tile (49, 140).
- **Estradas:** a estrada leste-oeste (linha 104) passa sob o portal e ao lado do spawn. A estrada
  do norte (linha 40) liga as ruínas.
- **Trilhas:**
  - um eixo norte-sul (coluna 98) desce da borda norte até o spawn;
  - verticais a oeste (coluna 10) e a leste (coluna 186);
  - ligações nas colunas 50, 127 e 150;
  - as trilhas originais continuam até as bordas do mapa.
- **Ruínas** (peças inteiras do `Wall.png`):
  - torre com porta e colunata, no norte, com uma trilha até a porta;
  - duas torres octogonais;
  - prédio quadrado;
  - duas fundações;
  - bloco de muro;
  - poço de entulho;
  - dois portões de pilares sobre as trilhas.
- **Pontos de interesse:** 23 cenas montadas só com peças inteiras dos atlas, espalhadas pela
  área nova sem encostar em trilhas, ruínas fixas ou pontos fixos do jogo:

  | Cena | Qtd. | Peças |
  |---|---|---|
  | Muralha | 3 | colunata de arcos, arco de passagem, pilar e pedras |
  | Torre isolada | 3 | torre octogonal ou quadrada, pilar e pedras |
  | Pátio murado | 2 | contorno de pátio, estátua, coluna e altar |
  | Santuário | 3 | gazebo entre duas estátuas, com pedras de passagem |
  | Círculo de obeliscos | 3 | cinco obeliscos em volta de uma plataforma |
  | Muro | 2 | bloco de muro, pilar, coluna e pedras |
  | Círculo de pedras | 2 | anel de pedras com altar no meio |
  | Pedreira | 5 | rochas grandes, pedras e coluna quebrada |

  Cenas do mesmo tipo ficam a pelo menos 35 tiles uma da outra, e todas ficam a pelo menos 8 tiles
  das ruínas fixas.
- **Objetos soltos:** pedras, colunas quebradas e altares pequenos espalhados pelas clareiras.
- **Vegetação:** bosques densos alternados com clareiras. As bordas do mapa são mais fechadas, e a
  área do spawn é um campo aberto.

## Uso no jogo (rpg-game)

O jogo lê `assets/maps/mapa.tmj` e os atlas de `assets/tilesets/`. Para atualizar o jogo com esta pasta:

1. Copie `mapa.tmj` para `rpg-game/assets/maps/`.
2. Na cópia que fica no jogo, mude o campo `image` de cada tileset de `Grass.png` para
   `../tilesets/Grass.png` (e o mesmo para os outros três). O Phaser não usa esse campo, mas
   assim o arquivo continua abrindo no Tiled a partir da pasta do jogo.
3. Copie os PNGs para `rpg-game/assets/tilesets/`.

O rpg-game já está com esta versão e com o mundo de 3200×3200 no servidor e no client.

## Ferramentas (opcional)

`ferramentas/build_map.py` gera o mapa de novo a partir do `mapa.tscn` original, que é só lido,
nunca alterado. A mesma seed gera sempre o mesmo mapa.

```
pip install pillow numpy scipy
python ferramentas/build_map.py "<rpg-game>/map/mapa-do-jogo/mapa pronto/mapa.tscn" . saida.tmj saida.png 7
```

O script grava o campo `image` como `../tilesets/<nome>.png`, que é o formato da pasta do jogo.
