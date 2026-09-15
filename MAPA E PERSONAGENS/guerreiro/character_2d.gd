extends CharacterBody2D

@export var speed: float = 300.0

func _physics_process(delta: float) -> void:
	var input_vector = Vector2.ZERO

	# Controles pelas setas
	if Input.is_key_pressed(KEY_RIGHT):
		input_vector.x += 1
	if Input.is_key_pressed(KEY_LEFT):
		input_vector.x -= 1
	if Input.is_key_pressed(KEY_DOWN):
		input_vector.y += 1
	if Input.is_key_pressed(KEY_UP):
		input_vector.y -= 1

	# Controles alternativos pelas teclas WASD
	if Input.is_key_pressed(KEY_D):
		input_vector.x += 1
	if Input.is_key_pressed(KEY_A):
		input_vector.x -= 1
	if Input.is_key_pressed(KEY_S):
		input_vector.y += 1
	if Input.is_key_pressed(KEY_W):
		input_vector.y -= 1

	# Aplica o movimento direto
	velocity = input_vector.normalized() * speed
	move_and_slide()
