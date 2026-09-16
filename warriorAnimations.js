/**
 * warriorAnimations.js
 * Centraliza o registro das animações da classe Guerreiro no AnimationManager global do Phaser.
 * Suporta o novo pack 8-direcional (Grid 15 colunas x 8 linhas de 128x128).
 */

const DIRECTIONS = {
    'right':      { start: 0,   end: 14 },
    'down-right': { start: 15,  end: 29 },
    'down':       { start: 30,  end: 44 },
    'down-left':  { start: 45,  end: 59 },
    'left':       { start: 60,  end: 74 },
    'up-left':    { start: 75,  end: 89 },
    'up':         { start: 90,  end: 104 },
    'up-right':   { start: 105, end: 119 }
};

function register8Dir(scene, animPrefix, textureKey, frameRate, repeat) {
    if (!scene.textures.exists(textureKey)) {
        console.warn(`[warriorAnimations] Textura "${textureKey}" não encontrada.`);
        return;
    }

    for (const [dir, range] of Object.entries(DIRECTIONS)) {
        const animKey = `${animPrefix}-${dir}`;
        if (!scene.anims.exists(animKey)) {
            scene.anims.create({
                key: animKey,
                frames: scene.anims.generateFrameNumbers(textureKey, { start: range.start, end: range.end }),
                frameRate: frameRate,
                repeat: repeat
            });
        }
    }

    // Fallback sem direção explícita (usa 'down' como padrão)
    if (!scene.anims.exists(animPrefix)) {
        scene.anims.create({
            key: animPrefix,
            frames: scene.anims.generateFrameNumbers(textureKey, { start: DIRECTIONS.down.start, end: DIRECTIONS.down.end }),
            frameRate: frameRate,
            repeat: repeat
        });
    }
}

export function ensureWarriorAnimations(scene) {
    if (!scene.textures.exists('warrior-idle')) {
        console.warn('[warriorAnimations] Textura "warrior-idle" ainda não carregada no TextureManager.');
        return false;
    }

    if (scene.anims.exists('warrior-idle-down')) {
        return true; // Já registradas globalmente
    }

    console.log('[warriorAnimations] Registrando animações 8-direcionais do Guerreiro...');

    // 1. Locomoção e Parado
    register8Dir(scene, 'warrior-idle',  'warrior-idle',  10, -1);
    register8Dir(scene, 'warrior-idle2', 'warrior-idle2', 10,  0);
    register8Dir(scene, 'warrior-walk',  'warrior-walk',  12, -1);
    register8Dir(scene, 'warrior-run',   'warrior-run',   15, -1);

    // 2. Combate Corpo a Corpo
    register8Dir(scene, 'warrior-melee',  'warrior-melee',  16, 0);
    register8Dir(scene, 'warrior-melee2', 'warrior-melee2', 16, 0);
    register8Dir(scene, 'warrior-spin',   'warrior-spin',   16, 0);

    // 3. Defesa, Mobilidade e Especiais
    register8Dir(scene, 'warrior-block',   'warrior-block',   14, 0);
    register8Dir(scene, 'warrior-roll',    'warrior-roll',    18, 0);
    register8Dir(scene, 'warrior-special', 'warrior-special', 15, 0);
    register8Dir(scene, 'warrior-kick',    'warrior-kick',    15, 0);

    // 4. Reações a Dano e Morte
    register8Dir(scene, 'warrior-hit', 'warrior-hit', 14, 0);
    register8Dir(scene, 'warrior-die', 'warrior-die', 12, 0);

    // Aliases para compatibilidade com os atalhos de habilidades anteriores
    const aliases = [
        { from: 'warrior-attack1',        to: 'warrior-melee-down' },
        { from: 'warrior-attack2',        to: 'warrior-melee2-down' },
        { from: 'warrior-crit',           to: 'warrior-special-down' },
        { from: 'warrior-spell-decisive', to: 'warrior-special-down' },
        { from: 'warrior-spell-judgement',to: 'warrior-spin-down' },
        { from: 'warrior-spell-demacian', to: 'warrior-kick-down' },
        { from: 'warrior-taunt',          to: 'warrior-block-down' },
        { from: 'warrior-dance-start',    to: 'warrior-idle2-down' },
        { from: 'warrior-dance-loop',     to: 'warrior-spin-down' }
    ];

    aliases.forEach(a => {
        if (!scene.anims.exists(a.from) && scene.anims.exists(a.to)) {
            const targetAnim = scene.anims.get(a.to);
            scene.anims.create({
                key: a.from,
                frames: targetAnim.frames,
                frameRate: targetAnim.frameRate,
                repeat: targetAnim.repeat
            });
        }
    });

    console.log('[warriorAnimations] Animações 8-direcionais do Guerreiro registradas com sucesso!');
    return true;
}
