import { Boot } from './Boot.js';
import { Preload } from './Preload.js';
import { MainMenu } from './MainMenu.js';
import { Loading } from './Loading.js';
import { HubCentral } from './HubCentral.js';
import { ExploracaoCombate } from './ExploracaoCombate.js';
import { UIScene } from './UIScene.js';

const config = {
    type: Phaser.AUTO,
    width: 1920,
    height: 920,
    backgroundColor: '#0a0a0a',
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    // A ordem aqui não dita quem roda primeiro (o Phaser pega a primeira da lista),
    // mas cadastra todas no sistema FSM.
    scene: [Boot, Preload, MainMenu, Loading, HubCentral, ExploracaoCombate, UIScene]
};

const game = new Phaser.Game(config);
window.__game = game;