#!/usr/bin/env python3
"""
Gerador procedural de masmorras top-down para o Tiled (formato JSON .tmj).

Usa EXCLUSIVAMENTE os tiles do atlas `tileset.png` (176x224 px, tiles 16x16,
11 colunas x 14 linhas = 154 ids locais; gid = id + 1).

Estilo: masmorra densa sobre fundo escuro. Salas e corredores ficam colados e
formam uma única malha de piso; toda borda norte ou sul vira face de tijolo,
as laterais viram faixas finas de muro e as passagens estreitas pelas faces
viram arcos ou portas. Os buracos escuros no meio das salas são poços.

Uso:
    python dungeon_gen.py --width 64 --height 48 --seed 42 --out mapa.tmj --preview mapa.png

Só a biblioteca padrão é necessária para gerar o .tmj; Pillow é opcional e só
é usado para o PNG de pré-visualização e para validar o atlas.
"""
from __future__ import annotations

import argparse
import json
import os
import random
from collections import deque
from pathlib import Path

# --------------------------------------------------------------------------
# Catálogo do atlas (ids LOCAIS: id = linha * 11 + coluna).
# --------------------------------------------------------------------------
TILE = 16
ATLAS_COLS, ATLAS_ROWS = 11, 14

# Chão
COBBLE = [26, 37, 48, 59]                      # pedra irregular, faixa vertical 1x4
SLAB = [[27, 28, 29, 30, 31],                  # lajotas, bloco 5x4 que se repete
        [38, 39, 40, 41, 42],
        [49, 50, 51, 52, 53],
        [60, 61, 62, 63, 64]]
FLOOR_PLAIN = 24
FLOOR_RUBBLE = 130
FLOOR_CRACKED = 141
FLOOR_PUDDLE = 90                              # poça sob o cano 79
TRAPDOORS = [84, 95]

# Vazio / poços
PIT_LIP = 85                                   # borda norte do poço
PIT_LIP_GRATE = 86
VOID = 96

# Paredes. 13 e 35 são o MESMO desenho (topo + face de tijolo); 25 é o 23 espelhado.
WALL_FACE = 13
WALL_L, WALL_R = 23, 25                        # faixa fina: chão à direita / à esquerda
WALL_TL, WALL_TR = 12, 14                      # cantos superiores (chão na diagonal de baixo)
WALL_BL, WALL_BR = 34, 36                      # cantos inferiores (chão na diagonal de cima)
WALL_TORCH = 20
WALL_DRAIN = 79
WALL_BLOCK = [[56, 57], [67, 68]]              # bloco de muro 2x2 (obstáculo em salões)

# Decoração
TORCH = 19
BANNERS = [106, 107, 108, 117, 118, 119]
BONES = [129, 140]                             # alavancas no chão
MAX_LEVERS = 4                                 # no máximo uma por prisão, até 4 no mapa

# Objetos  (pares = (topo, base) para objetos de 2 tiles de altura)
POTS = [101, 112, 123, 134]
CRATES = [102, 113]
BARRELS = [103, 114]
CHESTS_CLOSED = [104, 115]
CHESTS_OPEN = [105, 116]
SHELVES = [124, 135]
TABLES = [125, 136, 127, 128]
TALL_SHELF = (126, 137)
LONG_TABLE = (138, 139)                        # (esquerda, direita)
PILLAR = (82, 93)
PILLAR_TORCH = (81, 92)
FENCE = (83, 94)

# Existem no atlas mas não são usados (função ambígua)
UNUSED = {80: "nicho escuro com cristais (topo)", 91: "nicho escuro com cristais (base)",
          15: "porta de madeira", 16: "arco", 17: "grade levadiça", 18: "arco"}

WALL_IDS = {WALL_FACE, WALL_L, WALL_R, WALL_TL, WALL_TR, WALL_BL, WALL_BR,
            WALL_TORCH, WALL_DRAIN, 56, 57, 67, 68}
COLLIDE = WALL_IDS | {PIT_LIP, PIT_LIP_GRATE, VOID, *POTS, *CRATES, *BARRELS,
                      *CHESTS_CLOSED, *CHESTS_OPEN, *SHELVES, *TABLES, TALL_SHELF[1],
                      *LONG_TABLE, PILLAR[1], PILLAR_TORCH[1], FENCE[1]}

TILE_CLASS = {}
for _ids, _cls in [
    (COBBLE, "ground_cave"), (sum(SLAB, []), "ground_slab"),
    ([FLOOR_PLAIN, FLOOR_RUBBLE, FLOOR_CRACKED, FLOOR_PUDDLE], "ground_floor"),
    (TRAPDOORS, "trapdoor"), ([PIT_LIP, PIT_LIP_GRATE, VOID], "void"),
    (WALL_IDS, "wall"), ([TORCH], "torch"),
    (BANNERS, "banner"), (BONES, "bones"), (POTS, "pot"), (CRATES, "crate"),
    (BARRELS, "barrel"), (CHESTS_CLOSED + CHESTS_OPEN, "chest"),
    (SHELVES + list(TALL_SHELF), "bookshelf"), (TABLES + list(LONG_TABLE), "table"),
    (list(PILLAR) + list(PILLAR_TORCH), "pillar"), (list(FENCE), "fence"),
]:
    for _i in _ids:
        TILE_CLASS[_i] = _cls

LAYERS = ["Ground", "Water", "Paths", "Walls", "Decorations", "Objects"]
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


class Room:
    def __init__(self, x, y, w, h):
        self.x, self.y, self.w, self.h = x, y, w, h       # retângulo do PISO
        self.kind = "plain"
        self.floor = "plain"

    @property
    def x2(self):
        return self.x + self.w - 1

    @property
    def y2(self):
        return self.y + self.h - 1

    @property
    def center(self):
        return self.x + self.w // 2, self.y + self.h // 2

    def cells(self):
        for yy in range(self.y, self.y + self.h):
            for xx in range(self.x, self.x + self.w):
                yield xx, yy

    def __contains__(self, p):
        return self.x <= p[0] <= self.x2 and self.y <= p[1] <= self.y2


# --------------------------------------------------------------------------
# Gerador
# --------------------------------------------------------------------------
class DungeonGenerator:
    def __init__(self, width: int, height: int, seed: int, density: float = 0.5):
        if width < 32 or height < 24:
            raise ValueError("Tamanho mínimo: 32 x 24 tiles")
        self.W, self.H, self.seed = width, height, seed
        self.density = density
        self.rng = random.Random(seed)
        self.layers = {n: [[0] * width for _ in range(height)] for n in LAYERS}
        self.floor = [[False] * width for _ in range(height)]   # andável (inclui portas)
        self.corridor = [[False] * width for _ in range(height)]
        self.pit = [[False] * width for _ in range(height)]
        self.door = [[False] * width for _ in range(height)]
        self.blocked = set()                                   # células com objeto
        self.rooms: list[Room] = []
        self.start = (0, 0)

    # ---------------- helpers
    def inb(self, x, y):
        return 0 <= x < self.W and 0 <= y < self.H

    def is_floor(self, x, y):
        return self.inb(x, y) and self.floor[y][x]

    def set(self, layer, x, y, tid):
        self.layers[layer][y][x] = tid

    def get(self, layer, x, y):
        return self.layers[layer][y][x]

    def room_at(self, x, y):
        for r in self.rooms:
            if (x, y) in r:
                return r
        return None

    def walkable(self, x, y):
        return self.is_floor(x, y) and not self.pit[y][x] and (x, y) not in self.blocked

    def all_connected(self, extra=frozenset()):
        cells = [(x, y) for y in range(self.H) for x in range(self.W)
                 if self.walkable(x, y) and (x, y) not in extra]
        if not cells:
            return True
        seen = {cells[0]}
        q = deque([cells[0]])
        while q:
            cx, cy = q.popleft()
            for dx, dy in N4:
                n = (cx + dx, cy + dy)
                if n not in seen and self.walkable(*n) and n not in extra:
                    seen.add(n)
                    q.append(n)
        return len(seen) == len(cells)

    # ---------------- 1. salas
    def place_rooms(self):
        rng, W, H = self.rng, self.W, self.H
        budget = int(W * H * self.density * 0.55)   # área de piso desejada só em salas
        area = 0
        for _ in range(3000):
            if area >= budget:
                break
            w, h = rng.randint(4, 11), rng.randint(3, 7)
            x, y = rng.randint(2, W - w - 2), rng.randint(2, H - h - 2)
            r = Room(x, y, w, h)
            ok = True
            for o in self.rooms:
                # horizontal: >= 2 de muro entre salas; vertical: 1 (parede compartilhada) basta
                gap_x = max(o.x - r.x2 - 1, r.x - o.x2 - 1)
                gap_y = max(o.y - r.y2 - 1, r.y - o.y2 - 1)
                if gap_x < 2 and gap_y < 1:
                    ok = False
                    break
                if gap_y < 1 and gap_x < 3:
                    ok = False
                    break
            if not ok:
                continue
            self.rooms.append(r)
            area += w * h
        for r in self.rooms:
            a = r.w * r.h
            if a >= 40 and r.h >= 5:
                r.kind = "hall"
            else:
                r.kind = rng.choice(["library", "treasury", "storage", "storage",
                                     "prison", "barracks", "barracks"])
            r.floor = {"hall": "slab", "treasury": "slab", "library": "plain"}.get(
                r.kind, rng.choice(["plain", "plain", "slab", "cobble"]))
            for x, y in r.cells():
                self.floor[y][x] = True

    # ---------------- 2. corredores
    def carve(self, x, y):
        if 1 <= x < self.W - 1 and 1 <= y < self.H - 1 and not self.floor[y][x]:
            self.floor[y][x] = True
            self.corridor[y][x] = True

    def corridor_between(self, a: Room, b: Room):
        rng = self.rng
        ax, ay = rng.randint(a.x, a.x2), rng.randint(a.y, a.y2)
        bx, by = rng.randint(b.x, b.x2), rng.randint(b.y, b.y2)
        wide = rng.random() < 0.35
        horizontal_first = rng.random() < 0.5
        pts = [(ax, ay), (bx, ay), (bx, by)] if horizontal_first else [(ax, ay), (ax, by), (bx, by)]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            sx = 1 if x1 >= x0 else -1
            sy = 1 if y1 >= y0 else -1
            for x in range(x0, x1 + sx, sx):
                for y in range(y0, y1 + sy, sy):
                    self.carve(x, y)
                    if wide:
                        # corredores largos crescem para baixo/direita
                        self.carve(x + (1 if y0 != y1 else 0), y + (1 if x0 != x1 else 0))

    def connect_rooms(self):
        rng = self.rng
        rs = self.rooms
        if len(rs) < 2:
            return
        dist = lambda a, b: abs(a.center[0] - b.center[0]) + abs(a.center[1] - b.center[1])
        done, edges = {0}, []
        while len(done) < len(rs):
            best = min(((dist(rs[i], rs[j]), i, j) for i in done
                        for j in range(len(rs)) if j not in done))
            done.add(best[2])
            edges.append((best[1], best[2]))
        for _ in range(max(1, len(rs) // 4)):                     # loops
            i = rng.randrange(len(rs))
            j = min((k for k in range(len(rs)) if k != i and (min(i, k), max(i, k)) not in
                     {(min(e), max(e)) for e in edges}),
                    key=lambda k: dist(rs[i], rs[k]), default=None)
            if j is not None:
                edges.append((i, j))
        for i, j in edges:
            self.corridor_between(rs[i], rs[j])
        # arcos extras nas paredes compartilhadas entre salas empilhadas
        for a in rs:
            for b in rs:
                if b.y == a.y2 + 2:
                    lo, hi = max(a.x, b.x), min(a.x2, b.x2)
                    if hi - lo >= 2 and rng.random() < 0.6:
                        x = rng.randint(lo + 1, hi - 1) if hi - lo > 2 else lo + 1
                        self.carve(x, a.y2 + 1)

    def cleanup(self):
        """Remove configurações que não têm tile no atlas.

        - coluna de muro de 1 tile entre dois pisos (precisaria de 23+25 juntos)
        - diagonal pura entre pisos (canto interno inexistente)
        """
        changed = True
        while changed:
            changed = False
            for y in range(1, self.H - 1):
                for x in range(1, self.W - 1):
                    if self.floor[y][x]:
                        continue
                    f = self.is_floor
                    if f(x - 1, y) and f(x + 1, y):
                        self.carve(x, y)
                        changed = True
            # diagonais soltas: piso em (x,y) e (x+1,y+1) sem ligação ortogonal
            for y in range(1, self.H - 2):
                for x in range(1, self.W - 2):
                    a, b = self.floor[y][x], self.floor[y + 1][x + 1]
                    c, d = self.floor[y][x + 1], self.floor[y + 1][x]
                    if (a and b and not c and not d) or (c and d and not a and not b):
                        self.carve(x + 1, y) if a else self.carve(x, y)
                        changed = True

    # ---------------- 3. poços dentro de salas grandes
    def carve_pits(self):
        rng = self.rng
        for r in self.rooms:
            if r.w < 7 or r.h < 5 or rng.random() > 0.45:
                continue
            pw, ph = rng.randint(2, min(4, r.w - 4)), rng.randint(2, min(3, r.h - 3))
            px = rng.randint(r.x + 2, r.x2 - pw - 1)
            py = rng.randint(r.y + 2, r.y2 - ph)
            cells = [(x, y) for y in range(py, py + ph) for x in range(px, px + pw)]
            for x, y in cells:
                self.pit[y][x] = True
            if not self.all_connected():
                for x, y in cells:
                    self.pit[y][x] = False
            else:
                r.kind = "pit"

    # ---------------- 4. paredes (autotile)
    def wall_tile(self, x, y):
        f = self.is_floor
        n, s, e, w = f(x, y - 1), f(x, y + 1), f(x + 1, y), f(x - 1, y)
        if s or n:
            return WALL_FACE
        if e:
            return WALL_L
        if w:
            return WALL_R
        if f(x + 1, y + 1):
            return WALL_TL
        if f(x - 1, y + 1):
            return WALL_TR
        if f(x + 1, y - 1):
            return WALL_BL
        if f(x - 1, y - 1):
            return WALL_BR
        return 0

    def find_doors(self):
        """Marca passagens de 1 tile pelas faces de parede (ficam abertas e livres de mobília)."""
        f = self.is_floor
        for y in range(1, self.H - 1):
            for x in range(1, self.W - 1):
                if not self.floor[y][x] or self.pit[y][x]:
                    continue
                if f(x - 1, y) or f(x + 1, y):
                    continue
                if not (f(x, y - 1) and f(x, y + 1)):
                    continue
                left = not f(x - 1, y) and (f(x - 1, y + 1) or f(x - 1, y - 1))
                right = not f(x + 1, y) and (f(x + 1, y + 1) or f(x + 1, y - 1))
                # só é parede (e não corredor vertical) se os vizinhos forem faces
                if left and right and f(x - 1, y + 1) and f(x + 1, y + 1):
                    self.door[y][x] = True

    def paint(self):
        rng = self.rng
        shift = [rng.randrange(4) for _ in range(self.W)]
        for y in range(self.H):
            for x in range(self.W):
                if not self.floor[y][x]:
                    self.set("Ground", x, y, VOID)
                    t = self.wall_tile(x, y)
                    if t:
                        self.set("Walls", x, y, t)
                    continue
                if self.pit[y][x]:
                    lip = not self.pit[y - 1][x]
                    self.set("Water", x, y, (PIT_LIP_GRATE if rng.random() < 0.15 else PIT_LIP)
                             if lip else VOID)
                    self.set("Ground", x, y, VOID)
                    continue
                r = self.room_at(x, y)
                if r is None or self.door[y][x]:
                    # corredor (camada Paths); a camada Ground fica escura por baixo
                    self.set("Ground", x, y, VOID)
                    self.set("Paths", x, y, FLOOR_PLAIN)
                elif r.floor == "slab":
                    self.set("Ground", x, y, SLAB[y % 4][x % 5])
                elif r.floor == "cobble":
                    self.set("Ground", x, y, COBBLE[(y + shift[x]) % 4])
                else:
                    self.set("Ground", x, y, FLOOR_PLAIN)
                if self.door[y][x]:
                    # passagem aberta, sem tile de porta (não há animação de abrir).
                    # O sorteio é mantido para a mesma seed gerar o mesmo layout de antes.
                    rng.randrange(4)

    # ---------------- 5. detalhes de parede
    def face_cells(self):
        """Faces de parede com piso logo abaixo (onde vão tochas e estandartes)."""
        out = []
        for y in range(self.H - 1):
            for x in range(self.W):
                if self.get("Walls", x, y) == WALL_FACE and self.is_floor(x, y + 1) \
                        and not self.pit[y + 1][x]:
                    out.append((x, y))
        return out

    def decorate_walls(self):
        rng = self.rng
        faces = self.face_cells()
        used = set()
        for x, y in faces:
            if (x - 1, y) in used or (x + 1, y) in used:
                continue
            roll = rng.random()
            below = self.room_at(x, y + 1)
            if roll < 0.12:
                self.set("Decorations", x, y, TORCH)
            elif roll < 0.15:
                self.set("Walls", x, y, WALL_TORCH)
            elif roll < 0.22 and below:
                self.set("Decorations", x, y, BANNERS[self.rooms.index(below) % len(BANNERS)])
            elif roll < 0.25 and below and below.floor == "plain":
                self.set("Walls", x, y, WALL_DRAIN)
                self.set("Decorations", x, y + 1, FLOOR_PUDDLE)
            else:
                continue
            used.add((x, y))

    # ---------------- 6. mobília
    def walk_floor(self, x, y):
        return self.is_floor(x, y) and not self.pit[y][x]

    def mark_passages(self):
        """Células que a mobília nunca ocupa.

        - entradas de cada sala (piso da sala encostado em corredor/outra sala) e o anel em volta;
        - o caminho mais curto entre cada par de entradas, alargado para o miolo da sala;
        - gargalos: piso com parede dos dois lados (esquerda+direita ou cima+baixo).
        """
        clear = set()
        for r in self.rooms:
            inside = {c for c in r.cells() if self.walk_floor(*c)}
            entries = [c for c in sorted(inside) if any(
                self.walk_floor(c[0] + dx, c[1] + dy) and (c[0] + dx, c[1] + dy) not in r
                for dx, dy in N4)]
            for x, y in entries:
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        if (x + dx, y + dy) in inside:
                            clear.add((x + dx, y + dy))
            path = set()
            for i, a in enumerate(entries):
                prev = {a: None}
                q = deque([a])
                while q:
                    cx, cy = q.popleft()
                    for dx, dy in N4:
                        n = (cx + dx, cy + dy)
                        if n in inside and n not in prev:
                            prev[n] = (cx, cy)
                            q.append(n)
                for b in entries[i + 1:]:
                    c = b
                    while c is not None:
                        path.add(c)
                        c = prev.get(c)
            clear |= path
            # alarga o caminho para dentro da sala, sem invadir as células encostadas na parede
            if r.w >= 6 and r.h >= 5:
                for x, y in path:
                    for dx, dy in N4:
                        n = (x + dx, y + dy)
                        if n in inside and not self.against_wall(*n):
                            clear.add(n)
            for x, y in inside:
                f = self.walk_floor
                if (not f(x - 1, y) and not f(x + 1, y)) or (not f(x, y - 1) and not f(x, y + 1)):
                    clear.add((x, y))
        self.keep_clear = clear

    def against_wall(self, x, y):
        return any(not self.is_floor(x + dx, y + dy) for dx, dy in N4)

    def try_put(self, cells, tiles, top=None, wall=True):
        """Coloca objeto se as células são piso livre, fora das passagens e a masmorra
        continua conectada. `wall=True`: pelo menos uma célula precisa encostar na parede."""
        if wall and not any(self.against_wall(x, y) for x, y in cells):
            return False
        for (x, y) in cells:
            if not self.walkable(x, y) or self.door[y][x] or self.corridor[y][x]:
                return False
            if (x, y) in self.keep_clear:
                return False
            if self.get("Decorations", x, y) == FLOOR_PUDDLE:
                return False
            # não encostar em portas/arcos
            if any(self.inb(x + dx, y + dy) and self.door[y + dy][x + dx] for dx, dy in N4):
                return False
        new = set(cells)
        if top:
            # o topo de um objeto alto ocupa piso livre da sala ou sobrepõe uma face lisa
            tx, ty = top[0]
            if self.walkable(tx, ty) and self.room_at(tx, ty) and not self.door[ty][tx]:
                if (tx, ty) in self.keep_clear:
                    return False
                new.add((tx, ty))
            elif self.get("Walls", tx, ty) != WALL_FACE or self.get("Decorations", tx, ty):
                return False
        new = frozenset(new)
        if not self.all_connected(new):
            return False
        for (x, y), t in zip(cells, tiles):
            self.set("Objects", x, y, t)
        if top:
            self.set("Objects", top[0][0], top[0][1], top[1])
        self.blocked |= new
        return True

    WALL_POOLS = {
        "library": SHELVES, "treasury": CHESTS_CLOSED + POTS, "storage": CRATES + BARRELS + POTS,
        "prison": BARRELS, "barracks": POTS + BARRELS + CRATES, "hall": POTS, "pit": POTS + BARRELS,
    }

    def fill_along_walls(self, r, ratio=0.10):
        """Repõe objetos do tema até ~10% do piso da sala (mín. 2), só junto às paredes."""
        rng = self.rng
        inside = [c for c in r.cells() if self.walk_floor(*c)]
        have = sum(1 for x, y in inside if self.get("Objects", x, y))
        target = max(2, int(len(inside) * ratio))
        pool = self.WALL_POOLS.get(r.kind, POTS)
        spots = [c for c in inside if self.against_wall(*c) and c not in self.keep_clear
                 and not self.get("Objects", *c)]
        # a parede de cima primeiro (estantes e baús ficam de frente para quem entra)
        rng.shuffle(spots)
        spots.sort(key=lambda c: 0 if not self.is_floor(c[0], c[1] - 1) else 1)
        for x, y in spots:
            if have >= target:
                break
            # sem objetos colados uns nos outros na diagonal (evita "muralha" de caixotes)
            if any(self.get("Objects", x + dx, y + dy) for dx in (-1, 1) for dy in (-1, 1)):
                continue
            if self.try_put([(x, y)], [rng.choice(pool)]):
                have += 1

    def furnish(self):
        rng = self.rng
        self.mark_passages()
        levers_left = MAX_LEVERS
        for r in self.rooms:
            north = [(x, r.y) for x in range(r.x, r.x2 + 1)
                     if not self.is_floor(x, r.y - 1)]                 # encostado na face
            corners = [(r.x, r.y), (r.x2, r.y), (r.x, r.y2), (r.x2, r.y2)]
            west = [(r.x, y) for y in range(r.y, r.y2 + 1)]
            east = [(r.x2, y) for y in range(r.y, r.y2 + 1)]
            cx, cy = r.center
            k = r.kind
            if k == "hall":
                for x in (r.x + 1, r.x2 - 1):
                    for y in range(r.y + 2, r.y2, 2):
                        t = PILLAR_TORCH if rng.random() < 0.3 else PILLAR
                        self.try_put([(x, y)], [t[1]], top=((x, y - 1), t[0]), wall=False)
                if r.w >= 8 and rng.random() < 0.5:
                    if self.try_put([(cx - 1, cy), (cx, cy), (cx - 1, cy + 1), (cx, cy + 1)],
                                    [WALL_BLOCK[0][0], WALL_BLOCK[0][1],
                                     WALL_BLOCK[1][0], WALL_BLOCK[1][1]], wall=False):
                        for (x, y), t in zip([(cx - 1, cy), (cx, cy), (cx - 1, cy + 1), (cx, cy + 1)],
                                             [56, 57, 67, 68]):
                            self.set("Objects", x, y, 0)
                            self.set("Walls", x, y, t)
                else:
                    self.try_put([(cx - 1, cy), (cx, cy)], list(LONG_TABLE), wall=False)
            elif k == "library":
                for x, y in north:
                    if rng.random() < 0.3:
                        self.try_put([(x, y)], [TALL_SHELF[1]], top=((x, y - 1), TALL_SHELF[0]))
                    else:
                        self.try_put([(x, y)], [rng.choice(SHELVES)])
                if not self.try_put([(cx - 1, cy + 1), (cx, cy + 1)], list(LONG_TABLE), wall=False):
                    self.try_put([(cx, cy + 1)], [rng.choice(TABLES)], wall=False)
            elif k == "treasury":
                for x, y in north:
                    if rng.random() < 0.55:
                        self.try_put([(x, y)], [rng.choice(CHESTS_CLOSED if rng.random() < 0.7
                                                           else CHESTS_OPEN)])
                for c in west + east:
                    if rng.random() < 0.3:
                        self.try_put([c], [rng.choice(POTS)])
            elif k == "storage":
                for x, y in corners:
                    sx = 1 if x == r.x else -1
                    sy = 1 if y == r.y else -1
                    for c in [(x, y), (x + sx, y), (x, y + sy), (x + 2 * sx, y)]:
                        if rng.random() < 0.5:
                            self.try_put([c], [rng.choice(CRATES + BARRELS + POTS)])
            elif k == "prison":
                if r.h >= 4:
                    fy = r.y + 2
                    gap = rng.randint(r.x, r.x2)
                    for x in range(r.x, r.x2 + 1):
                        if x != gap:
                            self.try_put([(x, fy)], [FENCE[1]], top=((x, fy - 1), FENCE[0]),
                                         wall=False)
                # uma alavanca por prisão, encostada na parede de baixo e fora das passagens
                spots = [(x, r.y2) for x in range(r.x, r.x2 + 1)
                         if self.walkable(x, r.y2) and (x, r.y2) not in self.keep_clear
                         and not self.get("Decorations", x, r.y2)]
                if spots and levers_left > 0:
                    x, y = rng.choice(spots)
                    self.set("Decorations", x, y, rng.choice(BONES))
                    levers_left -= 1
            elif k == "pit":
                for c in corners:
                    if rng.random() < 0.5:
                        self.try_put([c], [rng.choice(POTS + BARRELS)])
            else:  # barracks
                for c in corners:
                    if rng.random() < 0.6:
                        self.try_put([c], [rng.choice(POTS + BARRELS + CRATES)])
                self.try_put([(cx, cy)], [rng.choice(TABLES)], wall=False)

            # completa a sala com objetos do tema, sempre encostados na parede e fora das passagens
            self.fill_along_walls(r)

            # piso: entulho, rachaduras, alçapões (planos, não bloqueiam)
            for x, y in r.cells():
                if not self.walkable(x, y) or self.get("Decorations", x, y):
                    continue
                roll = rng.random()
                if r.floor == "plain" and roll < 0.05:
                    self.set("Decorations", x, y, rng.choice([FLOOR_RUBBLE, FLOOR_CRACKED]))
                elif r.floor == "plain" and roll < 0.065:
                    self.set("Decorations", x, y, rng.choice(TRAPDOORS))
        # corredores: só rachaduras e entulho no piso (sem alavancas no caminho)
        for y in range(self.H):
            for x in range(self.W):
                if self.corridor[y][x] and not self.door[y][x] and self.get("Paths", x, y):
                    if rng.random() < 0.04:
                        self.set("Paths", x, y, rng.choice([FLOOR_CRACKED, FLOOR_RUBBLE]))

    # ---------------- pipeline
    def generate(self):
        self.place_rooms()
        self.connect_rooms()
        self.cleanup()
        self.carve_pits()
        self.find_doors()
        self.paint()
        self.decorate_walls()
        self.furnish()
        r0 = self.rooms[0] if self.rooms else None
        if r0:
            free = [c for c in r0.cells() if self.walkable(*c)]
            self.start = free[len(free) // 2] if free else r0.center
        return self

    # ---------------- exportação Tiled JSON
    def to_tmj(self, tileset_image="tileset.png"):
        W, H = self.W, self.H
        layers = []
        for i, name in enumerate(LAYERS, start=1):
            grid = self.layers[name]
            data = [(grid[y][x] + 1) if grid[y][x] else 0 for y in range(H) for x in range(W)]
            layers.append({"id": i, "name": name, "type": "tilelayer",
                           "x": 0, "y": 0, "width": W, "height": H,
                           "opacity": 1, "visible": True, "data": data})
        objects, oid = [], 1
        sx, sy = self.start
        objects.append({"id": oid, "name": "PlayerStart", "type": "spawn", "point": True,
                        "x": sx * TILE + TILE / 2, "y": sy * TILE + TILE / 2,
                        "width": 0, "height": 0, "rotation": 0, "visible": True})
        oid += 1
        for r in self.rooms:
            objects.append({"id": oid, "name": f"room_{oid - 1}", "type": "room",
                            "x": r.x * TILE, "y": r.y * TILE,
                            "width": r.w * TILE, "height": r.h * TILE,
                            "rotation": 0, "visible": True,
                            "properties": [{"name": "kind", "type": "string", "value": r.kind}]})
            oid += 1
        layers.append({"id": len(LAYERS) + 1, "name": "Markers", "type": "objectgroup",
                       "draworder": "topdown", "x": 0, "y": 0, "opacity": 1,
                       "visible": True, "objects": objects})
        tiles_meta = [{"id": t, "type": TILE_CLASS[t],
                       "properties": [{"name": "collides", "type": "bool", "value": t in COLLIDE}]}
                      for t in sorted(TILE_CLASS)]
        return {
            "type": "map", "version": "1.10", "tiledversion": "1.11.0",
            "orientation": "orthogonal", "renderorder": "right-down",
            "width": W, "height": H, "tilewidth": TILE, "tileheight": TILE,
            "infinite": False, "compressionlevel": -1, "backgroundcolor": "#14182e",
            "nextlayerid": len(LAYERS) + 2, "nextobjectid": oid,
            "properties": [{"name": "seed", "type": "int", "value": self.seed}],
            "layers": layers,
            "tilesets": [{
                "firstgid": 1, "name": "dungeon", "image": tileset_image,
                "imagewidth": ATLAS_COLS * TILE, "imageheight": ATLAS_ROWS * TILE,
                "tilewidth": TILE, "tileheight": TILE, "columns": ATLAS_COLS,
                "tilecount": ATLAS_COLS * ATLAS_ROWS, "margin": 0, "spacing": 0,
                "tiles": tiles_meta,
            }],
        }


# --------------------------------------------------------------------------
# Validação e preview
# --------------------------------------------------------------------------
def validate(tmj: dict, tileset_path: Path | None):
    W, H = tmj["width"], tmj["height"]
    count = tmj["tilesets"][0]["tilecount"]
    used = set()
    for layer in tmj["layers"]:
        if layer["type"] != "tilelayer":
            continue
        assert len(layer["data"]) == W * H, f"{layer['name']}: tamanho errado"
        for g in layer["data"]:
            assert 0 <= g <= count, f"gid inválido {g}"
            if g:
                used.add(g - 1)
    if tileset_path and tileset_path.exists():
        try:
            from PIL import Image
        except ImportError:
            return used
        im = Image.open(tileset_path).convert("RGBA")
        for tid in used:
            c, r = tid % ATLAS_COLS, tid // ATLAS_COLS
            box = (c * TILE, r * TILE, c * TILE + TILE, r * TILE + TILE)
            assert im.crop(box).getextrema()[3][1] > 0, f"tile {tid} é vazio no atlas"
    return used


def render_preview(tmj: dict, tileset_path: Path, out_path: Path, scale=2):
    from PIL import Image
    atlas = Image.open(tileset_path).convert("RGBA")
    W, H = tmj["width"], tmj["height"]
    img = Image.new("RGBA", (W * TILE, H * TILE), tmj.get("backgroundcolor", "#000000"))
    cache = {}
    for layer in tmj["layers"]:
        if layer["type"] != "tilelayer":
            continue
        for i, g in enumerate(layer["data"]):
            if not g:
                continue
            tid = g - 1
            if tid not in cache:
                c, r = tid % ATLAS_COLS, tid // ATLAS_COLS
                cache[tid] = atlas.crop((c * TILE, r * TILE, c * TILE + TILE, r * TILE + TILE))
            img.alpha_composite(cache[tid], ((i % W) * TILE, (i // W) * TILE))
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    img.save(out_path)


def main():
    ap = argparse.ArgumentParser(description="Gerador procedural de masmorras Tiled (.tmj)")
    ap.add_argument("--width", type=int, default=64)
    ap.add_argument("--height", type=int, default=48)
    ap.add_argument("--seed", type=int, default=None, help="omitido = aleatório")
    ap.add_argument("--density", type=float, default=0.5,
                    help="0.3 (esparso) a 0.7 (muito denso); padrão 0.5")
    ap.add_argument("--out", default="mapa.tmj")
    ap.add_argument("--tileset", default="tileset.png",
                    help="caminho do PNG (gravado no .tmj relativo ao .tmj)")
    ap.add_argument("--preview", default=None, help="PNG de pré-visualização (requer Pillow)")
    args = ap.parse_args()

    seed = args.seed if args.seed is not None else random.randrange(1 << 31)
    gen = DungeonGenerator(args.width, args.height, seed, args.density).generate()

    out = Path(args.out).resolve()
    ts = Path(args.tileset).resolve()
    rel = Path(os.path.relpath(ts, out.parent)).as_posix()
    tmj = gen.to_tmj(rel)
    used = validate(tmj, ts)
    connected = gen.all_connected()
    out.write_text(json.dumps(tmj, separators=(",", ":")), encoding="utf-8")
    print(f"seed={seed}  {args.width}x{args.height}  salas={len(gen.rooms)}  "
          f"tiles distintos={len(used)}  conectado={connected}  -> {out}")
    if args.preview:
        render_preview(tmj, ts, Path(args.preview))
        print(f"preview -> {args.preview}")


if __name__ == "__main__":
    main()
