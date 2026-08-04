extends Node2D
class_name WorldGenerator

# ==========================================================
# REFERÊNCIAS
# ==========================================================

@export var ground_layer: TileMapLayer

# ==========================================================
# MAPA
# ==========================================================

@export_group("Mapa")

@export var map_width := 100
@export var map_height := 100

# ==========================================================
# NOISE
# ==========================================================

@export_group("Noise")

@export var world_seed := 12345
@export var frequency := 0.05

var noise := FastNoiseLite.new()

# ==========================================================
# TILES
# ALTERE PARA AS POSIÇÕES DO SEU TILESET
# ==========================================================

const WATER = [
	Vector2i(1, 9),
	Vector2i(2, 9),
	Vector2i(1, 10),
	Vector2i(2, 10)
]

const SAND = [
	Vector2i(1, 2),
	Vector2i(2, 2)
]

const GRASS = [
	Vector2i(1, 5),
	Vector2i(2, 5),
	Vector2i(1, 6),
	Vector2i(2, 6)
]

const DIRT = [
	Vector2i(1, 14),
	Vector2i(2, 14),
]

func _ready():

	configure_noise()

	generate_world()

# ==========================================================

func configure_noise():

	noise.seed = seed

	noise.frequency = frequency

	noise.noise_type = FastNoiseLite.TYPE_PERLIN

	noise.fractal_type = FastNoiseLite.FRACTAL_FBM

	noise.fractal_octaves = 4

	noise.fractal_gain = 0.5

	noise.fractal_lacunarity = 2.0

# ==========================================================

func generate_world():

	if ground_layer == TileMapLayer:

		push_error("Ground Layer não atribuída.")

		return

	ground_layer.clear()

	for x in range(map_width):

		for y in range(map_height):

			var n = noise.get_noise_2d(x,y)

			var atlas = choose_tile(n,x,y)

			ground_layer.set_cell(
				Vector2i(x,y),
				0,
				atlas
			)

# ==========================================================

func choose_tile(value:float,x:int,y:int)->Vector2i:

	if value < -0.65:
		return random_tile(WATER,x,y)

	elif value < -0.50:
		return random_tile(SAND,x,y)

	elif value < 0.30:
		return random_tile(GRASS,x,y)

	return random_tile(DIRT,x,y)

# ==========================================================

func random_tile(list:Array,x:int,y:int)->Vector2i:

	var hash_value = abs((x * 73856093) ^ (y * 19349663) ^ seed)

	return list[hash_value % list.size()]
