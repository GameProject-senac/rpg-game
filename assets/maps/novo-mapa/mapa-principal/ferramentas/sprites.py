"""Segmentação de sprites no atlas por pixel (alpha), com fusão de fragmentos pequenos."""
import numpy as np
from PIL import Image
from scipy import ndimage

def segment(atlas_path, min_px=60, dilate=2):
    a = np.array(Image.open(atlas_path).convert('RGBA'))[:, :, 3] > 0
    # dilata um pouco para juntar folhas/fiapos soltos do mesmo sprite
    grown = ndimage.binary_dilation(a, iterations=dilate)
    lab, n = ndimage.label(grown, structure=np.ones((3, 3)))
    lab = np.where(a, lab, 0)
    H, W = a.shape[0] // 16, a.shape[1] // 16
    # tile -> sprite dominante
    tile_sprite = {}
    for ty in range(H):
        for tx in range(W):
            blk = lab[ty*16:ty*16+16, tx*16:tx*16+16]
            v = blk[blk > 0]
            if v.size:
                ids, cnt = np.unique(v, return_counts=True)
                tile_sprite[(tx, ty)] = int(ids[cnt.argmax()])
    sprites = {}
    for t, s in tile_sprite.items():
        sprites.setdefault(s, set()).add(t)
    # sprites minúsculos (1 tile com poucos pixels) ficam como estão: são pedrinhas/tufos reais
    return tile_sprite, sprites
