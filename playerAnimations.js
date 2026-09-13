/**
 * playerAnimations.js
 * Centraliza o registro das animações do Player no AnimationManager global do Phaser.
 */
export function ensurePlayerAnimations(scene) {
    if (!scene.textures.exists('player')) {
        console.warn('[playerAnimations] Textura "player" ainda não carregada no TextureManager.');
        return false;
    }

    if (scene.anims.exists('player-idle-down')) {
        return true; // Já registradas globalmente
    }

    console.log('[playerAnimations] Registrando animações globais do player...');

    scene.anims.create({
        key: 'player-idle-down',
        frames: scene.anims.generateFrameNumbers('player', { start: 0, end: 5 }),
        frameRate: 8,
        repeat: -1
    });
    scene.anims.create({
        key: 'player-idle-side',
        frames: scene.anims.generateFrameNumbers('player', { start: 6, end: 11 }),
        frameRate: 8,
        repeat: -1
    });
    scene.anims.create({
        key: 'player-idle-up',
        frames: scene.anims.generateFrameNumbers('player', { start: 12, end: 17 }),
        frameRate: 8,
        repeat: -1
    });
    scene.anims.create({
        key: 'player-walk-down',
        frames: scene.anims.generateFrameNumbers('player', { start: 18, end: 23 }),
        frameRate: 8,
        repeat: -1
    });
    scene.anims.create({
        key: 'player-walk-side',
        frames: scene.anims.generateFrameNumbers('player', { start: 24, end: 29 }),
        frameRate: 8,
        repeat: -1
    });
    scene.anims.create({
        key: 'player-walk-up',
        frames: scene.anims.generateFrameNumbers('player', { start: 30, end: 35 }),
        frameRate: 8,
        repeat: -1
    });

    console.log('[playerAnimations] Animações registradas com sucesso!');
    return true;
}
