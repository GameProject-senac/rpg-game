import re, base64, struct
def decode_tscn(path):
    tscn = open(path, encoding='utf-8').read()
    ext = dict((i, p) for p, i in re.findall(r'path="([^"]+)" id="([^"]+)"', tscn))
    src_tex = {m.group(1): m.group(2) for m in re.finditer(
        r'\[sub_resource type="TileSetAtlasSource" id="([^"]+)"\]\s*\ntexture = ExtResource\("([^"]+)"\)', tscn)}
    ts_tex = {}
    for m in re.finditer(r'\[sub_resource type="TileSet" id="([^"]+)"\]((?:\n(?!\[).*)*)', tscn):
        s = re.search(r'sources/\d+ = SubResource\("([^"]+)"\)', m.group(2))
        ts_tex[m.group(1)] = ext[src_tex[s.group(1)]].split('/')[-1].split('.')[0]
    out = {}
    for m in re.finditer(r'\[node name="([^"]+)" type="TileMapLayer"[^\]]*\]((?:\n(?!\[).*)*)', tscn):
        body = m.group(2)
        data = base64.b64decode(re.search(r'tile_map_data = PackedByteArray\("([^"]*)"\)', body).group(1))
        ts = re.search(r'tile_set = SubResource\("([^"]+)"\)', body).group(1)
        cells = []
        for o in range(2, len(data), 12):
            x, y, sid, ax, ay, alt = struct.unpack_from('<hhHHHH', data, o)
            cells.append((x, y, ax, ay))          # alternativas só mudam colisão -> tile base
        out[m.group(1)] = (ts_tex[ts], cells)
    return out
