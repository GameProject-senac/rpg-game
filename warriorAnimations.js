/**
 * warriorAnimations.js
 * Centraliza o registro das animações da classe Guerreiro no AnimationManager global do Phaser.
 */
export function ensureWarriorAnimations(scene) {
    if (!scene.textures.exists('warrior-idle')) {
        console.warn('[warriorAnimations] Textura "warrior-idle" ainda não carregada no TextureManager.');
        return false;
    }

    if (scene.anims.exists('warrior-idle')) {
        return true; // Já registradas globalmente
    }

    console.log('[warriorAnimations] Registrando animações globais do Guerreiro...');

    // Idle
    scene.anims.create({
        key: 'warrior-idle',
        frames: scene.anims.generateFrameNumbers('warrior-idle', { start: 0, end: 7 }),
        frameRate: 10,
        repeat: -1
    });

    scene.anims.create({
        key: 'warrior-idle2',
        frames: scene.anims.generateFrameNumbers('warrior-idle2', { start: 0, end: 9 }),
        frameRate: 10,
        repeat: 0
    });

    // Locomoção
    scene.anims.create({
        key: 'warrior-run',
        frames: scene.anims.generateFrameNumbers('warrior-run', { start: 0, end: 11 }),
        frameRate: 12,
        repeat: -1
    });

    scene.anims.create({
        key: 'warrior-run-skill',
        frames: scene.anims.generateFrameNumbers('warrior-run-skill', { start: 0, end: 8 }),
        frameRate: 12,
        repeat: -1
    });

    // Combate / Ataques
    scene.anims.create({
        key: 'warrior-attack1',
        frames: scene.anims.generateFrameNumbers('warrior-attack1', { start: 0, end: 12 }),
        frameRate: 12,
        repeat: 0
    });

    scene.anims.create({
        key: 'warrior-attack2',
        frames: scene.anims.generateFrameNumbers('warrior-attack2', { start: 0, end: 12 }),
        frameRate: 12,
        repeat: 0
    });

    scene.anims.create({
        key: 'warrior-crit',
        frames: scene.anims.generateFrameNumbers('warrior-crit', { start: 0, end: 12 }),
        frameRate: 12,
        repeat: 0
    });

    // Habilidades / Magias
    scene.anims.create({
        key: 'warrior-spell-decisive',
        frames: scene.anims.generateFrameNumbers('warrior-spell-decisive', { start: 0, end: 6 }),
        frameRate: 10,
        repeat: 0
    });

    scene.anims.create({
        key: 'warrior-spell-demacian',
        frames: scene.anims.generateFrameNumbers('warrior-spell-demacian', { start: 0, end: 9 }),
        frameRate: 10,
        repeat: 0
    });

    scene.anims.create({
        key: 'warrior-spell-judgement',
        frames: scene.anims.generateFrameNumbers('warrior-spell-judgement', { start: 0, end: 18 }),
        frameRate: 12,
        repeat: 0
    });

    // Emotes / Especiais
    scene.anims.create({
        key: 'warrior-taunt',
        frames: scene.anims.generateFrameNumbers('warrior-taunt', { start: 0, end: 24 }),
        frameRate: 10,
        repeat: 0
    });

    scene.anims.create({
        key: 'warrior-dance-start',
        frames: scene.anims.generateFrameNumbers('warrior-dance-start', { start: 0, end: 16 }),
        frameRate: 10,
        repeat: 0
    });

    scene.anims.create({
        key: 'warrior-dance-loop',
        frames: scene.anims.generateFrameNumbers('warrior-dance-loop', { start: 0, end: 28 }),
        frameRate: 10,
        repeat: -1
    });

    console.log('[warriorAnimations] Animações do Guerreiro registradas com sucesso!');
    return true;
}
