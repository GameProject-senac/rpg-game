extends Node

class_name WorldGenerator

@onready var ground: TileMapLayer = $"../Ground"

@export_group("Mapa")
@export var map_width := 200
@export var map_height := 200

@export_group("Seeds")
@export var world_seed := 12345

@export_group("Noise")

@export var terrain_frequency := 0.015
@export var detail_frequency := 0.08
@export var river_frequency := 0.006

var terrain_noise : FastNoiseLite
var detail_noise : FastNoiseLite
var river_noise : FastNoiseLite

#========================================================
# TILES
#========================================================

const WATER:Array[Vector2i] = [
	Vector2i(1,9),
	Vector2i(2,9),
	Vector2i(1,10),
	Vector2i(2,10)
]

const SAND:Array[Vector2i] = [
	Vector2i(1,2),
	Vector2i(2,2)
]

const GRASS:Array[Vector2i] = [
	Vector2i(1,5),
	Vector2i(2,5),
	Vector2i(1,6),
	Vector2i(2,6)
]

const DIRT:Array[Vector2i] = [
	Vector2i(1,14),
	Vector2i(2,14)
]

func _ready():

	create_noises()

	generate_world()

#========================================================

func create_noises():

	terrain_noise = FastNoiseLite.new()

	terrain_noise.seed = world_seed
	terrain_noise.frequency = terrain_frequency
	terrain_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	terrain_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	terrain_noise.fractal_octaves = 5

	detail_noise = FastNoiseLite.new()

	detail_noise.seed = world_seed + 999
	detail_noise.frequency = detail_frequency
	detail_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX

	river_noise = FastNoiseLite.new()

	river_noise.seed = world_seed + 5000
	river_noise.frequency = river_frequency
	river_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH

#========================================================

func generate_world():

	ground.clear()

	for x in range(map_width):

		for y in range(map_height):

			var h = terrain_noise.get_noise_2d(x,y)

			var d = detail_noise.get_noise_2d(x,y) * 0.10

			var r = river_noise.get_noise_2d(x,y)

			var value = h + d

			var tile = get_tile(value,r,x,y)

			ground.set_cell(
				Vector2i(x,y),
				0,
				tile
			)

#========================================================

func get_tile(height:float,river:float,x:int,y:int)->Vector2i:

	#==========================
	# RIOS
	#==========================

	if abs(river) < 0.018 and height > -0.40:
		return random_tile(WATER,x,y)

	#==========================
	# OCEANO
	#==========================

	if height < -0.58:
		return random_tile(WATER,x,y)

	#==========================
	# PRAIA
	#==========================

	elif height < -0.45:
		return random_tile(SAND,x,y)

	#==========================
	# GRAMA
	#==========================

	elif height < 0.35:
		return random_tile(GRASS,x,y)

	#==========================
	# TERRA ALTA
	#==========================

	return random_tile(DIRT,x,y)

#========================================================

func random_tile(list:Array[Vector2i],x:int,y:int)->Vector2i:

	var rng = RandomNumberGenerator.new()

	rng.seed = world_seed + x * 912367 + y * 123777

	return list[rng.randi_range(0,list.size()-1)]
