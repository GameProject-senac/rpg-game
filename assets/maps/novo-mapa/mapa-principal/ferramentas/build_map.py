"""
Reconstrói o mapa principal (125x125, 16px) a partir do desenho feito à mão (mapa.tscn,
somente leitura) e estende a área nova com trilhas, árvores, props e ruínas inteiras.

Saída: Tiled JSON compatível com ExploracaoCombate.js (camadas chao/props/props2/
"arvores 2"/arvores; tilesets Grass/Props/Plants/Wall).

Uso (requer: pip install pillow numpy scipy):
    python build_map.py <mapa.tscn> <pasta com Grass/Props/Plants/Wall.png> <saida.tmj> <preview.png> [seed]
"""
import json, random, math, sys, os
from collections import defaultdict
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sprites import segment
from godot_decode_lib import decode_tscn

TSCN = sys.argv[1]
ASSETS = sys.argv[2]          # pasta com Grass/Props/Plants/Wall.png
OUT_TMJ = sys.argv[3]
OUT_PNG = sys.argv[4]
SEED = int(sys.argv[5]) if len(sys.argv) > 5 else 7

W = H = 200                   # 200x200 tiles de 16px = mundo 3200x3200
OX, OY = 49, 140              # onde o original (101x60) entra no mapa novo: centro-sul
LAYERS = ['chao', 'props', 'props2', 'arvores 2', 'arvores']
TS = [('Grass', 1, 64, 32), ('Props', 2049, 32, 32), ('Plants', 3073, 64, 64), ('Wall', 7169, 128, 64)]
FIRST = {n: f for n, f, c, r in TS}
COLS = {n: c for n, f, c, r in TS}

# pontos fixos do jogo (px -> tile)
SPAWN = (100, 100)                        # (1600,1600) px
PORTAL_PX = (480, 1600)
PORTAL_RECT = (23, 94, 38, 106)           # sprite 192x112 centrado em PORTAL_PX + folga
ENEMY_SPAWNS = [(20, 20), (180, 20), (20, 180), (180, 180)]   # (320|2880, 320|2880) px

rng = random.Random(SEED)

# ------------------------------------------------------------------ leitura
layers_src = decode_tscn(TSCN)            # {name: (tex, [(x,y,ax,ay)])}

seg = {t: segment(os.path.join(ASSETS, t + '.png')) for t in ('Props', 'Plants', 'Wall')}

def atlas_opaque(tex):
    im = np.array(Image.open(os.path.join(ASSETS, tex + '.png')).convert('RGBA'))[:, :, 3] > 0
    h, w = im.shape[0] // 16, im.shape[1] // 16
    return {(x, y) for y in range(h) for x in range(w) if im[y*16:y*16+16, x*16:x*16+16].any()}
OPAQUE = {t: atlas_opaque(t) for t in ('Grass', 'Props', 'Plants', 'Wall')}

grid = {n: {} for n in LAYERS}            # (x,y) -> (tex, ax, ay)
def inb(x, y): return 0 <= x < W and 0 <= y < H

# ------------------------------------------------------------------ trilhas
# Modelo: faixas horizontais (topo y, x0..x1) e verticais (esquerda x, y0..y1), 4 tiles.
def extract_trails(cells):
    hs, vs = defaultdict(set), defaultdict(set)
    for x, y, ax, ay in cells:
        if 6 <= ax <= 11 or 3 <= ax <= 5:         # faixa horizontal (e o remendo de ponta)
            hs[y - ay].add(x)
        elif 28 <= ax <= 31:
            vs[x - (ax - 28)].add(y)
    def runs(d):
        out = []
        for k, s in d.items():
            s = sorted(s); a = s[0]; p = s[0]
            for v in s[1:] + [None]:
                if v is None or v != p + 1:
                    out.append((k, a, p)); a = v
                p = v if v is not None else p
        return out
    return runs(hs), runs(vs)

H_SEG, V_SEG = [], []
orig_h, orig_v = extract_trails(layers_src['chao'][1])

def clean_network(hs, vs, tol=4):
    """Remove fiapos (<4 tiles) e encaixa pontas a até `tol` tiles da faixa perpendicular."""
    hs = [list(h) for h in hs if h[2] - h[1] + 1 >= 4]
    vs = [list(v) for v in vs if v[2] - v[1] + 1 >= 4]
    for _ in range(3):
        for h in hs:                       # h = [top, x0, x1]
            for v in vs:                   # v = [left, y0, y1]
                if not (v[1] - tol <= h[0] + 3 and h[0] <= v[2] + tol):
                    continue
                if abs(h[2] - (v[0] + 3)) <= tol and h[1] < v[0]:
                    h[2] = v[0] + 3
                    v[1] = min(v[1], h[0]); v[2] = max(v[2], h[0] + 3)
                if abs(h[1] - v[0]) <= tol and h[2] > v[0] + 3:
                    h[1] = v[0]
                    v[1] = min(v[1], h[0]); v[2] = max(v[2], h[0] + 3)
        for v in vs:
            for h in hs:
                if not (h[1] - tol <= v[0] + 3 and v[0] <= h[2] + tol):
                    continue
                if abs(v[2] - (h[0] + 3)) <= tol and v[1] < h[0]:
                    v[2] = h[0] + 3
                if abs(v[1] - h[0]) <= tol and v[2] > h[0] + 3:
                    v[1] = h[0]
    return hs, vs

orig_h, orig_v = clean_network(orig_h, orig_v)
for top, x0, x1 in orig_h: H_SEG.append([top + OY, x0 + OX, x1 + OX])
for left, y0, y1 in orig_v: V_SEG.append([left + OX, y0 + OY, y1 + OY])
print('trilhas originais H:', H_SEG); print('trilhas originais V:', V_SEG)

# ------------------------------------------------------------------ rede nova
def seg_h(top, x0, x1): H_SEG.append([top, x0, x1])
def seg_v(left, y0, y1): V_SEG.append([left, y0, y1])
def find_h(top): return next(h for h in H_SEG if h[0] == top)
def find_v(left): return next(v for v in V_SEG if v[0] == left)

ORIG_SEGS = ([list(h) for h in H_SEG], [list(v) for v in V_SEG])   # antes das extensões

ROAD = 104                                 # estrada leste-oeste: passa sob o portal e o spawn
NORTH = 40                                 # estrada do norte (ruínas)
seg_h(ROAD, 0, W - 1)
seg_h(NORTH, 0, W - 1)
find_v(OX + 69)[1] = ROAD                  # trilha original do norte sobe até a estrada
find_h(OY + 5)[1] = 0                      # trilhas originais que encostavam na borda do desenho
find_h(OY + 44)[1] = 0                     # antigo seguem até a borda do mapa
find_h(OY + 47)[2] = W - 1
seg_v(98, 0, ROAD + 3)                     # eixo norte-sul: borda norte -> spawn -> estrada
seg_v(10, NORTH, OY + 47)                  # oeste: estrada norte -> estrada -> trilhas originais
seg_v(186, NORTH, OY + 50)                 # leste: estrada norte -> estrada -> trilha original
seg_v(50, 0, NORTH + 3)                    # noroeste: borda -> estrada norte (portão)
seg_v(150, NORTH, ROAD + 3)                # ligação entre as duas estradas a leste

# ------------------------------------------------------------------ ruínas (peças inteiras)
wall_ts, wall_sp = seg['Wall']
def sprite_at(tex, ax, ay):
    """Sprite do tile (ax,ay); se ele for vazio, o sprite opaco mais próximo (até 3 tiles)."""
    ts = seg[tex][0]
    if (ax, ay) in ts:
        return ts[(ax, ay)]
    near = sorted((abs(x - ax) + abs(y - ay), s) for (x, y), s in ts.items()
                  if abs(x - ax) <= 3 and abs(y - ay) <= 3)
    return near[0][1]
def stamp_tiles(tex, sid, sub=None):
    tiles = seg[tex][1][sid]
    if sub:                                   # recorte de um sprite composto
        x0, y0, x1, y1 = sub
        tiles = {t for t in tiles if x0 <= t[0] <= x1 and y0 <= t[1] <= y1}
    return tiles
def bbox(tiles):
    xs = [t[0] for t in tiles]; ys = [t[1] for t in tiles]
    return min(xs), min(ys), max(xs), max(ys)

RUINS = []          # (layer, tex, tiles, gx, gy)
def place_ruin(tex, ax, ay, gx, gy, layer='props', sub=None):
    sid = sprite_at(tex, ax, ay)
    tiles = stamp_tiles(tex, sid, sub)
    bx, by, _, _ = bbox(tiles)
    cells = {}
    for (tx, ty) in tiles:
        cells[(gx + tx - bx, gy + ty - by)] = (tex, tx, ty)
    RUINS.append((layer, cells))
    return cells

# torre com porta + colunata (sprite 39). A porta escura fica nas colunas relativas 5..7.
door_tiles = [t for t in stamp_tiles('Wall', sprite_at('Wall', 2, 46)) if 56 <= t[1] <= 61]
im_wall = np.array(Image.open(os.path.join(ASSETS, 'Wall.png')).convert('RGBA'))
dark = [(tx, ty) for tx, ty in door_tiles
        if (im_wall[ty*16:ty*16+16, tx*16:tx*16+16, :3].sum(axis=2) < 200).sum() > 40]
door_cx = (min(t[0] for t in dark) + max(t[0] for t in dark)) / 2 - 2      # relativo ao bbox (x0=2)
SPUR_LEFT = 127                                            # trilha até a porta da torre A
gx_a = round(SPUR_LEFT + 1.5 - door_cx)
ruin_a = place_ruin('Wall', 2, 46, gx_a, 8)
ruin_a_bottom = max(y for _, y in ruin_a)
seg_v(SPUR_LEFT, ruin_a_bottom + 1, NORTH + 3)
def place_ruin_rect(ax0, ay0, ax1, ay1, gx, gy, layer='props'):
    cells = {(gx + ax - ax0, gy + ay - ay0): ('Wall', ax, ay)
             for ay in range(ay0, ay1 + 1) for ax in range(ax0, ax1 + 1) if (ax, ay) in OPAQUE['Wall']}
    RUINS.append((layer, cells))
    return cells
place_ruin('Wall', 70, 4, 160, 52)                         # poço de entulho
place_ruin('Wall', 44, 22, 60, 10)                         # torre octogonal (norte)
place_ruin('Wall', 44, 22, 165, 115)                       # torre octogonal (leste)
place_ruin('Wall', 2, 2, 20, 52)                           # prédio quadrado
place_ruin('Wall', 42, 2, 74, 14)                          # fundação baixa (norte)
place_ruin('Wall', 42, 2, 18, 118)                         # fundação baixa (oeste)
place_ruin('Wall', 14, 4, 125, 62)                         # bloco de muro
place_ruin_rect(56, 6, 63, 9, 48, 28, layer='props2')      # portão de pilares sobre a trilha 50
place_ruin_rect(56, 6, 63, 9, 8, 160, layer='props2')      # portão de pilares sobre a trilha 10
print('torre A em x', gx_a, 'porta (centro) col', gx_a + door_cx, 'base', ruin_a_bottom)

# ------------------------------------------------------------------ chão
def covering(x, y):
    h = next((s for s in H_SEG if s[0] <= y <= s[0] + 3 and s[1] <= x <= s[2]), None)
    v = next((s for s in V_SEG if s[0] <= x <= s[0] + 3 and s[1] <= y <= s[2]), None)
    return h, v

def in_orig_trail(x, y):
    hs, vs = ORIG_SEGS
    return any(s[0] <= y <= s[0] + 3 and s[1] <= x <= s[2] for s in hs) or \
           any(s[0] <= x <= s[0] + 3 and s[1] <= y <= s[2] for s in vs)

TRAIL = set(); NEW_TRAIL = set()          # NEW_TRAIL: trilha que não existia no desenho original
for y in range(H):
    for x in range(W):
        h, v = covering(x, y)
        H_T = ('Grass', 6 + (x % 6), y - h[0]) if h else None
        V_T = ('Grass', 28 + (x - v[0]), y % 6) if v else None
        if h or v:
            TRAIL.add((x, y))
            if not in_orig_trail(x, y):
                NEW_TRAIL.add((x, y))
        if h and v:
            r, c = y - h[0], x - v[0]
            hb, vb = r in (1, 2), c in (1, 2)
            h_cont = (h[1] < v[0]) if c == 0 else (h[2] > v[0] + 3) if c == 3 else True
            v_cont = (v[1] < h[0]) if r == 0 else (v[2] > h[0] + 3) if r == 3 else True
            if hb and vb:
                # miolo do cruzamento: liso só onde a trilha segue nas duas direções;
                # do lado em que ela termina, usa a faixa com borda desfiada
                v_open = (r == 1 and v[1] < h[0]) or (r == 2 and v[2] > h[0] + 3)
                h_open = (c == 1 and h[1] < v[0]) or (c == 2 and h[2] > v[0] + 3)
                if v_open and h_open:
                    t = ('Grass', x % 2, 2 + y % 2)
                elif v_open:
                    t = V_T
                else:
                    t = H_T
            elif hb:
                t = H_T if h_cont else V_T
            elif vb:
                t = V_T if v_cont else H_T
            else:
                t = H_T if h_cont else V_T if v_cont else ('Grass', x % 2, y % 2)
        elif h:
            t = H_T
        elif v:
            t = V_T
        else:
            t = ('Grass', x % 2, y % 2)
        grid['chao'][(x, y)] = t

# ------------------------------------------------------------------ zonas protegidas
PROTECT = set()
px0, py0, px1, py1 = PORTAL_RECT
for y in range(py0, py1 + 1):
    for x in range(px0, px1 + 1):
        PROTECT.add((x, y))
for ex, ey in ENEMY_SPAWNS:
    for y in range(ey - 3, ey + 4):
        for x in range(ex - 3, ex + 4):
            PROTECT.add((x, y))
RUIN_CELLS = set()
for layer, cells in RUINS:
    RUIN_CELLS |= set(cells)
RUIN_HALO = {(x + dx, y + dy) for x, y in RUIN_CELLS for dx in (-1, 0, 1) for dy in (-1, 0, 1)}

# ------------------------------------------------------------------ props originais + novos
props_tex = {}
for name in ('props', 'props2'):
    tex, cells = layers_src[name]
    for x, y, ax, ay in cells:
        gx, gy = x + OX, y + OY
        if (ax, ay) not in OPAQUE[tex] or not inb(gx, gy) or (gx, gy) in PROTECT:
            continue
        grid[name][(gx, gy)] = (tex, ax, ay)

# praça do spawn: círculo de pedras (Props) centrado no spawn
def place_props_sprite(ax, ay, gx, gy, layer='props'):
    sid = sprite_at('Props', ax, ay)
    tiles = seg['Props'][1][sid]
    bx, by, bx1, by1 = bbox(tiles)
    cells = {(gx + tx - bx, gy + ty - by): ('Props', tx, ty) for tx, ty in tiles}
    if any(c in grid[layer] or c in RUIN_CELLS or not inb(*c) for c in cells):
        return None
    grid[layer].update(cells)
    return cells

def place_props_rect(ax0, ay0, ax1, ay1, gx, gy, layer='props'):
    cells = {(gx + ax - ax0, gy + ay - ay0): ('Props', ax, ay)
             for ay in range(ay0, ay1 + 1) for ax in range(ax0, ax1 + 1) if (ax, ay) in OPAQUE['Props']}
    if any(c in grid[layer] or c in RUIN_CELLS or not inb(*c) for c in cells):
        return None
    grid[layer].update(cells)
    return cells

ring = place_props_rect(20, 24, 31, 31, SPAWN[0] - 6, SPAWN[1] - 5, layer='props2')
print('círculo do spawn:', 'ok' if ring else 'FALHOU')
SPAWN_ZONE = {(x, y) for y in range(SPAWN[1] - 7, SPAWN[1] + 4) for x in range(SPAWN[0] - 8, SPAWN[0] + 8)}
PROTECT |= SPAWN_ZONE
# obeliscos ladeando o portal animado
place_props_sprite(1, 1, px0 - 3, 96)
place_props_sprite(1, 1, px1 + 2, 96)
# estátuas junto das ruínas do norte
place_props_sprite(13, 0, 58, 28)
place_props_sprite(20, 0, 90, 26)

# ------------------------------------------------------------------ pontos de interesse
# Pequenas cenas montadas só com peças inteiras dos atlas, espalhadas pela área nova.
def piece(tex, ax0, ay0, ax1, ay1):
    return {(ax - ax0, ay - ay0): (tex, ax, ay)
            for ay in range(ay0, ay1 + 1) for ax in range(ax0, ax1 + 1) if (ax, ay) in OPAQUE[tex]}

P = {  # Props
    'gazebo': piece('Props', 20, 12, 26, 18), 'plataforma': piece('Props', 14, 16, 19, 18),
    'altar': piece('Props', 13, 12, 14, 15), 'coluna': piece('Props', 25, 4, 26, 10),
    'obelisco': piece('Props', 1, 1, 2, 5), 'estatua_a': piece('Props', 12, 1, 15, 10),
    'estatua_b': piece('Props', 19, 1, 22, 10), 'rocha1': piece('Props', 0, 23, 3, 27),
    'rocha2': piece('Props', 7, 23, 10, 27), 'pedras1': piece('Props', 9, 2, 11, 6),
    'pedras2': piece('Props', 5, 3, 8, 5), 'pisadas': piece('Props', 0, 17, 7, 22),
    'circulo': piece('Props', 20, 24, 31, 31),
}
WL = {  # Wall
    'colunata': piece('Wall', 40, 50, 63, 53), 'arco': piece('Wall', 28, 56, 31, 59),
    'pilar': piece('Wall', 58, 1, 58, 4), 'patio': piece('Wall', 28, 0, 39, 17),
    'muro': piece('Wall', 2, 20, 11, 25), 'torre_oct': piece('Wall', 44, 22, 53, 35),
    'torre_quad': piece('Wall', 2, 2, 11, 17),
}

def scene(*parts):
    """parts: (layer, peça, dx, dy) -> {layer: {(x,y): tile}} relativo à origem."""
    out = defaultdict(dict)
    for layer, pc, dx, dy in parts:
        for (x, y), t in pc.items():
            out[layer][(x + dx, y + dy)] = t
    return out

SCENES = {
    'santuario': lambda: scene(('props', P['gazebo'], 6, 0), ('props', P['estatua_a'], 0, -3),
                               ('props', P['estatua_b'], 15, -3), ('props2', P['pisadas'], 5, 8)),
    'obeliscos': lambda: scene(('props', P['plataforma'], 5, 6), ('props', P['obelisco'], 0, 2),
                               ('props', P['obelisco'], 13, 2), ('props', P['obelisco'], 2, 9),
                               ('props', P['obelisco'], 11, 9), ('props', P['obelisco'], 7, -1)),
    'muralha': lambda: scene(('props', WL['colunata'], 0, 0), ('props', WL['arco'], 10, 6),
                             ('props', WL['pilar'], -2, 5), ('props', P['pedras1'], 18, 6),
                             ('props', P['pedras2'], 3, 6)),
    'muro': lambda: scene(('props', WL['muro'], 0, 0), ('props', WL['pilar'], 12, 2),
                          ('props', P['pedras2'], 2, 7), ('props', P['coluna'], -3, 1)),
    'patio': lambda: scene(('props', WL['patio'], 0, 0), ('props2', P['estatua_a'], 4, 3),
                           ('props2', P['altar'], 5, 13), ('props2', P['coluna'], 9, 9)),
    'pedreira': lambda: scene(('props', P['rocha1'], 0, 0), ('props', P['rocha2'], 5, 2),
                              ('props', P['pedras1'], 10, 0), ('props', P['pedras2'], 2, 6),
                              ('props', P['coluna'], 12, 4)),
    'torre': lambda: scene(('props', rng.choice([WL['torre_oct'], WL['torre_quad']]), 0, 0),
                           ('props', P['pedras2'], 11, 10), ('props', WL['pilar'], -2, 9)),
    'circulo': lambda: scene(('props', P['circulo'], 0, 0), ('props2', P['altar'], 5, 2)),
}
SCENE_COUNT = {'muralha': 3, 'torre': 3, 'patio': 2, 'santuario': 3, 'obeliscos': 3, 'muro': 2,
               'circulo': 2, 'pedreira': 5}

TRAIL_HALO2 = {(x + dx, y + dy) for x, y in TRAIL for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2)}
POI_CELLS = set()
SCENE_CENTERS = defaultdict(list)          # tipo -> centros já colocados
RUIN_BOXES = [bbox(list(cells)) for _, cells in RUINS]

def box_gap(a, b):
    """Distância (em tiles) entre dois retângulos (x0,y0,x1,y1); 0 se encostam/sobrepõem."""
    dx = max(a[0] - b[2], b[0] - a[2], 0)
    dy = max(a[1] - b[3], b[1] - a[3], 0)
    return max(dx, dy)

def try_scene(name, sc, ox, oy):
    allc = [(x + ox, y + oy) for layer in sc for (x, y) in sc[layer]]
    for c in allc:
        if not inb(*c) or in_orig_rect(*c) or c in TRAIL_HALO2 or c in RUIN_HALO or c in PROTECT \
                or c in grid['props'] or c in grid['props2']:
            return False
    box = bbox(allc)
    if any(box_gap(box, rb) < 8 for rb in RUIN_BOXES):    # longe das ruínas fixas
        return False
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    if any(math.hypot(cx - x, cy - y) < 35 for x, y in SCENE_CENTERS[name]):   # sem repetir perto
        return False
    halo = {(x + dx, y + dy) for x, y in allc for dx in range(-6, 7) for dy in range(-6, 7)}
    if halo & POI_CELLS:                                   # distância mínima entre cenas
        return False
    for layer, cells in sc.items():
        for (x, y), t in cells.items():
            grid[layer][(x + ox, y + oy)] = t
    POI_CELLS.update(allc)
    SCENE_CENTERS[name].append((cx, cy))
    return True

def in_orig_rect(x, y): return OX - 1 <= x <= OX + 101 and OY - 5 <= y <= H - 1
placed_scenes = defaultdict(int)
for name, n in SCENE_COUNT.items():
    for _ in range(n):
        for _try in range(800):
            sc = SCENES[name]()
            if try_scene(name, sc, rng.randint(2, W - 30), rng.randint(2, H - 25)):
                placed_scenes[name] += 1
                break
print('pontos de interesse:', dict(placed_scenes))
# as cenas ganham uma folga sem árvores em volta
POI_HALO = {(x + dx, y + dy) for x, y in POI_CELLS for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
PROTECT |= POI_HALO

# objetos pequenos soltos nas clareiras (pedras, colunas quebradas, altares)
SMALL = [P['pedras1'], P['pedras2'], P['coluna'], P['altar'], P['rocha1'], P['rocha2']]
n_small = 0
for _ in range(int(W * H * 0.0012)):
    pc = rng.choice(SMALL)
    ox, oy = rng.randrange(W - 6), rng.randrange(H - 8)
    cells = [(x + ox, y + oy) for x, y in pc]
    if any(not inb(*c) or in_orig_rect(*c) or c in TRAIL_HALO2 or c in RUIN_HALO or c in PROTECT
           or c in grid['props'] or c in grid['props2'] for c in cells):
        continue
    for (x, y), t in pc.items():
        grid['props'][(x + ox, y + oy)] = t
    PROTECT |= set(cells)
    n_small += 1
print('objetos pequenos soltos:', n_small)

# pedrinhas soltas (as mesmas peças avulsas que o designer usou)
single = set()
for name in ('props', 'props2'):
    tex, cells = layers_src[name]
    for x, y, ax, ay in cells:
        # pedras soltas do atlas: bloco de pedrinhas em colunas 0..14, linhas 28..31
        if (ax, ay) in OPAQUE['Props'] and 0 <= ax <= 14 and 28 <= ay <= 31:
            single.add((ax, ay))
single = sorted(single)
print('peças avulsas de pedra:', len(single))

# ------------------------------------------------------------------ árvores
plant_ts, plant_sp = seg['Plants']
trees = []          # dict: sid, cells(dict pos->(ax,ay)), base, orig
seen = set()
usage = defaultdict(int)
for name in ('arvores 2', 'arvores'):
    tex, cells = layers_src[name]
    groups = defaultdict(set)
    for x, y, ax, ay in cells:
        sid = plant_ts.get((ax, ay))
        if sid is not None:
            groups[(sid, x - ax, y - ay)].add((x, y))
    for (sid, dx, dy), pts in groups.items():
        key = (sid, dx + OX, dy + OY)
        if key in seen:
            continue
        seen.add(key)
        usage[sid] += 1
        full = {(ax + dx + OX, ay + dy + OY): (ax, ay) for ax, ay in plant_sp[sid]}   # completa a árvore
        trees.append({'sid': sid, 'cells': full, 'orig': True})

def base_rows(t, n=2):
    by = max(y for _, y in t['cells'])
    return {(x, y) for x, y in t['cells'] if y > by - n}

removed = defaultdict(int)
kept = []
for t in trees:
    cs = set(t['cells'])
    if any(not inb(*c) for c in cs):
        # copa saindo do mapa: corta só o que está fora (o tronco segue dentro)
        t['cells'] = {c: v for c, v in t['cells'].items() if inb(*c)}
        removed['recortada_na_borda'] += 1
    if cs & PROTECT:
        removed['zona_protegida'] += 1; continue
    if base_rows(t) & NEW_TRAIL:
        removed['tronco_em_trilha_nova'] += 1; continue
    if cs & RUIN_CELLS:
        removed['sobre_ruina'] += 1; continue
    kept.append(t)
trees = kept

# novas árvores na área nova, com densidade variando por ruído
pool = sorted(usage.items())
weights = pool                     # só as árvores que o designer usou, na mesma proporção
tot = sum(n for _, n in weights)
def pick_sprite():
    r = rng.uniform(0, tot)
    for sid, n in weights:
        r -= n
        if r <= 0: return sid
    return weights[-1][0]

def noise(x, y, s=14):
    gx, gy = x / s, y / s
    ix, iy = int(gx), int(gy)
    def h(a, b): return (math.sin(a * 127.1 + b * 311.7 + SEED) * 43758.5453) % 1
    fx, fy = gx - ix, gy - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * fx
    b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * fx
    return a + (b - a) * fy

def in_original(x, y): return OX <= x <= OX + 100 and OY <= y <= H - 1
TRAIL_HALO = {(x + dx, y + dy) for x, y in TRAIL for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
occupied_props = set(grid['props']) | set(grid['props2'])

cands = []
for _ in range(int(9000 * W * H / 15625)):          # tentativas proporcionais à área
    sid = pick_sprite()
    sp = plant_sp[sid]
    bx, by, bx1, by1 = bbox(sp)
    gx = rng.randint(-bx + 0, W - 1 - bx1 + 0) if False else rng.randint(0, W - 1 - (bx1 - bx))
    gy = rng.randint(0, H - 1 - (by1 - by))
    cells = {(gx + ax - bx, gy + ay - by): (ax, ay) for ax, ay in sp}
    base = {(x, y) for x, y in cells if y >= gy + (by1 - by) - 1}
    bxm = sum(x for x, _ in base) / len(base); bym = gy + (by1 - by)
    if in_original(bxm, bym):
        continue
    # bosques densos onde o ruído é alto, clareiras onde é baixo; bordas do mapa mais fechadas
    density = noise(bxm, bym, s=22)
    edge = min(bxm, bym, W - 1 - bxm, H - 1 - bym)
    want = (0.0 if density < 0.32 else 0.25 + 1.2 * (density - 0.32)) + (0.4 if edge < 10 else 0)
    if rng.random() > want:
        continue
    cs = set(cells)
    if cs & TRAIL or cs & RUIN_HALO or cs & PROTECT or cs & occupied_props:
        continue
    if any(in_original(x, y) for x, y in base):
        continue
    cands.append({'sid': sid, 'cells': cells, 'orig': False})

# ------------------------------------------------------------------ profundidade
# Quem está mais ao sul fica na camada de cima. Duas camadas: uma árvore só entra se puder
# ficar acima de todas as que encosta.
def base_y(t): return max(y for _, y in t['cells'])
allt = trees + cands
rng.shuffle(cands)
allt.sort(key=lambda t: (base_y(t), 0 if t['orig'] else 1))
low, high = {}, {}          # célula -> índice da árvore
placed = []
conflicts_orig = 0
for t in allt:
    cs = set(t['cells'])
    hit_low = {low[c] for c in cs if c in low}
    hit_high = {high[c] for c in cs if c in high}
    if not t['orig']:
        # espaçamento entre troncos das novas árvores
        bt = base_rows(t, 3)
        if any(c in low or c in high for c in bt):
            continue
        if len(hit_low) + len(hit_high) > 1:
            continue
    if not hit_low and not hit_high:
        dest = low
    elif not hit_high:
        dest = high
    elif t['orig']:
        # árvore original presa entre outras duas: sai inteira (recortar deixaria um buraco)
        conflicts_orig += 1
        continue
    else:
        continue
    idx = len(placed); placed.append(t)
    for c in t['cells']:
        dest[c] = idx
    t['layer'] = 'arvores 2' if dest is low else 'arvores'

for t in placed:
    for c, (ax, ay) in t['cells'].items():
        grid[t['layer']][c] = ('Plants', ax, ay)
n_orig = sum(1 for t in placed if t['orig']); n_new = len(placed) - n_orig
print('árvores originais mantidas', n_orig, 'novas', n_new, 'removidas', dict(removed),
      'originais com conflito triplo', conflicts_orig)

# ------------------------------------------------------------------ ruínas -> camadas
for layer, cells in RUINS:
    for c, v in cells.items():
        if inb(*c):
            grid[layer][c] = v

# pedrinhas na área nova
for _ in range(int(W * H * 0.006)):
    x, y = rng.randrange(W), rng.randrange(H)
    c = (x, y)
    if in_original(x, y) or c in TRAIL or c in RUIN_HALO or c in PROTECT:
        continue
    if c in grid['props'] or c in grid['arvores 2'] or c in grid['arvores']:
        continue
    grid['props'][c] = ('Props',) + rng.choice(single)

# ------------------------------------------------------------------ exportação
def gid(v):
    tex, ax, ay = v
    assert (ax, ay) in OPAQUE[tex], f'tile vazio {v}'
    return FIRST[tex] + ay * COLS[tex] + ax

layers_json = []
for i, name in enumerate(LAYERS, 1):
    data = [gid(grid[name][(x, y)]) if (x, y) in grid[name] else 0 for y in range(H) for x in range(W)]
    layers_json.append({'id': i, 'name': name, 'type': 'tilelayer', 'width': W, 'height': H,
                        'x': 0, 'y': 0, 'opacity': 1, 'visible': True, 'data': data})
tilesets = []
for n, f, c, r in TS:
    tilesets.append({'firstgid': f, 'columns': c, 'name': n, 'image': f'../tilesets/{n}.png',
                     'imagewidth': c * 16, 'imageheight': r * 16, 'margin': 0, 'spacing': 0,
                     'tilewidth': 16, 'tileheight': 16, 'tilecount': c * r})
tmj = {'compressionlevel': -1, 'infinite': False, 'width': W, 'height': H,
       'tilewidth': 16, 'tileheight': 16, 'orientation': 'orthogonal', 'renderorder': 'right-down',
       'type': 'map', 'version': '1.10', 'tiledversion': '1.11.0',
       'nextlayerid': len(LAYERS) + 1, 'nextobjectid': 1,
       'layers': layers_json, 'tilesets': tilesets}
json.dump(tmj, open(OUT_TMJ, 'w', encoding='utf-8'), separators=(',', ':'))

# preview
atl = {n: Image.open(os.path.join(ASSETS, n + '.png')).convert('RGBA') for n, *_ in TS}
img = Image.new('RGBA', (W * 16, H * 16), (11, 29, 58, 255))
for name in LAYERS:
    for (x, y), (tex, ax, ay) in grid[name].items():
        img.alpha_composite(atl[tex].crop((ax * 16, ay * 16, ax * 16 + 16, ay * 16 + 16)), (x * 16, y * 16))
# portal animado (quadro 0) só no preview, na posição em que o jogo o desenha
sheet_path = os.path.join(ASSETS, 'portal-Sheet.png')
if os.path.exists(sheet_path):
    fr = Image.open(sheet_path).convert('RGBA').crop((0, 0, 192, 112))
    img.alpha_composite(fr, (PORTAL_PX[0] - 96, PORTAL_PX[1] - 56))
img.save(OUT_PNG)
print('ok', OUT_TMJ)
