/**
 * enemyAnimations.js
 * Centraliza o registro das animações de inimigos (Slime e Skeleton).
 */
export function ensureEnemyAnimations(scene) {
    // Registra animações do Slime se a textura existir e ainda não tiverem sido criadas
    if (scene.textures.exists('slime') && !scene.anims.exists('slime-idle-down')) {
        console.log('[enemyAnimations] Registrando animações do Slime...');

        // Slime: 7 colunas, 32x32
        // Linha 0 (0..3): Idle Down
        // Linha 1 (7..10): Idle Side
        // Linha 2 (14..17): Idle Up
        // Linha 3 (21..26): Walk Down
        // Linha 4 (28..33): Walk Side
        // Linha 5 (35..40): Walk Up
        scene.anims.create({
            key: 'slime-idle-down',
            frames: scene.anims.generateFrameNumbers('slime', { start: 0, end: 3 }),
            frameRate: 6,
            repeat: -1
        });
        scene.anims.create({
            key: 'slime-idle-side',
            frames: scene.anims.generateFrameNumbers('slime', { start: 7, end: 10 }),
            frameRate: 6,
            repeat: -1
        });
        scene.anims.create({
            key: 'slime-idle-up',
            frames: scene.anims.generateFrameNumbers('slime', { start: 14, end: 17 }),
            frameRate: 6,
            repeat: -1
        });
        scene.anims.create({
            key: 'slime-walk-down',
            frames: scene.anims.generateFrameNumbers('slime', { start: 21, end: 26 }),
            frameRate: 8,
            repeat: -1
        });
        scene.anims.create({
            key: 'slime-walk-side',
            frames: scene.anims.generateFrameNumbers('slime', { start: 28, end: 33 }),
            frameRate: 8,
            repeat: -1
        });
        scene.anims.create({
            key: 'slime-walk-up',
            frames: scene.anims.generateFrameNumbers('slime', { start: 35, end: 40 }),
            frameRate: 8,
            repeat: -1
        });
    }

    // Registra animações do Skeleton se a textura existir e ainda não tiverem sido criadas
    if (scene.textures.exists('skeleton') && !scene.anims.exists('skeleton-idle-down')) {
        console.log('[enemyAnimations] Registrando animações do Skeleton...');

        // Skeleton: 6 colunas, 48x48
        // Linha 0 (0..5): Idle Down
        // Linha 1 (6..11): Idle Side
        // Linha 2 (12..17): Idle Up
        // Linha 3 (18..23): Walk Down
        // Linha 4 (24..29): Walk Side
        // Linha 5 (30..35): Walk Up
        scene.anims.create({
            key: 'skeleton-idle-down',
            frames: scene.anims.generateFrameNumbers('skeleton', { start: 0, end: 5 }),
            frameRate: 6,
            repeat: -1
        });
        scene.anims.create({
            key: 'skeleton-idle-side',
            frames: scene.anims.generateFrameNumbers('skeleton', { start: 6, end: 11 }),
            frameRate: 6,
            repeat: -1
        });
        scene.anims.create({
            key: 'skeleton-idle-up',
            frames: scene.anims.generateFrameNumbers('skeleton', { start: 12, end: 17 }),
            frameRate: 6,
            repeat: -1
        });
        scene.anims.create({
            key: 'skeleton-walk-down',
            frames: scene.anims.generateFrameNumbers('skeleton', { start: 18, end: 23 }),
            frameRate: 8,
            repeat: -1
        });
        scene.anims.create({
            key: 'skeleton-walk-side',
            frames: scene.anims.generateFrameNumbers('skeleton', { start: 24, end: 29 }),
            frameRate: 8,
            repeat: -1
        });
        scene.anims.create({
            key: 'skeleton-walk-up',
            frames: scene.anims.generateFrameNumbers('skeleton', { start: 30, end: 35 }),
            frameRate: 8,
            repeat: -1
        });
    }
}
