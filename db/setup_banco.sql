-- =====================================================================
-- setup_banco.sql — Kit de montagem portátil do banco jogo_pi
-- FASE A / PASSO A1 — schema oficial + adições de Itens + dados mínimos
--
-- ATENÇÃO: este script é DESTRUTIVO. A primeira linha apaga o banco
-- jogo_pi inteiro (se existir) e recria do zero. NÃO rode isto num banco
-- que tenha dados a preservar. É um kit de teste portátil, pensado pra
-- rodar igual nos dois PCs (casa/curso) e sempre terminar no mesmo estado.
-- =====================================================================

DROP DATABASE IF EXISTS jogo_pi;
CREATE DATABASE IF NOT EXISTS jogo_pi;
USE jogo_pi;

-- =====================================================================
-- 1. SCHEMA OFICIAL — as 14 tabelas do script da equipe (SchemaCompleto.sql),
--    reproduzidas como entregues. Única mudança estrutural: a tabela de
--    inventário foi renomeada de `inventory` para `inventario` (decisão do
--    líder técnico) — ela é tabela-folha (as FKs saem dela, nada referencia
--    ela de volta), então o rename é seguro e não afeta as demais tabelas.
-- =====================================================================

-- 1. Tabelas Base (Sem Dependências)
CREATE TABLE jogadores (
    id INT PRIMARY KEY AUTO_INCREMENT,
    Nome VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    Senha VARCHAR(255) NOT NULL,
    roles VARCHAR(255) NOT NULL COMMENT 'sys_admin | admin | user',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    current_map_id INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE Itens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    descricao VARCHAR(150) NOT NULL,
    localizacao VARCHAR(50),
    chance FLOAT DEFAULT 1.0,
    -- ---------------------------------------------------------------
    -- ADIÇÕES (decisão do líder técnico, fora do script original):
    --
    -- tipo VARCHAR(30): categoriza o item (Equipamento agora;
    -- Consumível/Material no futuro). É propriedade do item, então mora
    -- no catálogo Itens — o filtro de inventário do Round 3 lê o tipo
    -- daqui em vez de inferir por nome.
    --
    -- bonus_dano/bonus_defesa/bonus_hp INT DEFAULT 0: efeito do item nos
    -- atributos. Diferente do XP (regra fixa, fica no código), o bônus
    -- de item é conteúdo que muda por instância (espada +10, +15,
    -- upgradeável) — por isso mora no BANCO. O recálculo de atributos do
    -- servidor passa a ler os bônus DAQUI, não do ITENS hardcoded.
    -- ---------------------------------------------------------------
    tipo VARCHAR(30),
    bonus_dano INT DEFAULT 0,
    bonus_defesa INT DEFAULT 0,
    bonus_hp INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome_inimigo VARCHAR(100),
    vida INT NOT NULL,
    defesa INT DEFAULT 0,
    ataque INT DEFAULT 0,
    -- experiencia_dropada é DECIMAL, não INT (decisão do dono do projeto,
    -- Loot & Inimigos Passo 1a): passou a ser o MULTIPLICADOR de XP do tipo
    -- de mob (XP = dano_efetivo × 0.1 × experiencia_dropada, ver Passo 1c),
    -- não um valor fixo de XP por abate — por isso precisa de casas decimais
    -- (1.3, 1.6...). DECIMAL(4,2) cobre 0.00–99.99, sobra pra multiplicadores
    -- de boss bem acima de 1.0.
    --
    -- ⚠️ Aviso pro Passo 1c: mysql2 devolve coluna DECIMAL como STRING, não
    -- number (mesmo gotcha já visto em personagens.experiencia, ver AGENTS.md
    -- §07). Qualquer leitura de experiencia_dropada que alimente a conta de
    -- XP precisa de Number(...) explícito antes de multiplicar, senão vira
    -- concatenação de string / NaN.
    experiencia_dropada DECIMAL(4,2) DEFAULT 0.00,
    is_boss BOOLEAN DEFAULT FALSE,
    nivel INT DEFAULT 1,
    -- peso_spawn: Loot & Inimigos Passo 2a. Peso relativo de sorteio (maior =
    -- mais frequente); consumido pelo sorteio ponderado do Passo 2b. Fica no
    -- banco porque raridade é balanceamento que a equipe calibra, não algo
    -- hardcoded no jogo.
    peso_spawn INT NOT NULL DEFAULT 10 COMMENT 'Peso relativo de sorteio (maior = mais frequente). Elite baixo = raro.'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE skills (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    tipo VARCHAR(50) COMMENT 'Ativa | Passiva',
    is_common BOOLEAN DEFAULT FALSE COMMENT 'TRUE para skills comuns'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE table_nivel (
    nivel INT PRIMARY KEY,
    xp_necessaria BIGINT NOT NULL -- Trocado para BIGINT devido ao nível 21
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Tabelas Dependentes dos Níveis Primários

CREATE TABLE personagens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    jogadores_id INT NOT NULL,
    nome VARCHAR(50) NOT NULL,
    classe VARCHAR(30) NOT NULL,
    nivel INT DEFAULT 1,
    experiencia DECIMAL(12,2) NOT NULL DEFAULT 0, -- DECIMAL, não FLOAT: XP de golpe (dano×0.1) acumula sem erro de arredondamento binário
    hp_atual INT NOT NULL,
    hp_max INT NOT NULL,
    dano_base INT NOT NULL,
    defesa_base INT NOT NULL,
    posicao_x FLOAT DEFAULT 100.0,
    posicao_y FLOAT DEFAULT 100.0,
    cena_atual VARCHAR(50) DEFAULT 'HubCentral',
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_personagem_jogador FOREIGN KEY (jogadores_id) REFERENCES jogadores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE map (
    id INT PRIMARY KEY AUTO_INCREMENT,
    Nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    tipo VARCHAR(50),
    width INT,
    height INT,
    max_player INT DEFAULT 4,
    difficulty_level INT DEFAULT 1,
    jogadores_id INT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (jogadores_id) REFERENCES jogadores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE skill_levels (
    skill_id INT,
    nivel INT,
    damage INT NOT NULL,
    mana_cost INT NOT NULL,
    cooldown FLOAT NOT NULL,
    PRIMARY KEY (skill_id, nivel),
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE class_skills (
    classe VARCHAR(30) NOT NULL,
    skill_id INT NOT NULL,
    PRIMARY KEY (classe, skill_id),
    CONSTRAINT fk_classskills_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE skill_tree (
    skill_id INT NOT NULL,
    required_skill_id INT NOT NULL,
    required_level INT DEFAULT 1,
    PRIMARY KEY (skill_id, required_skill_id),
    CONSTRAINT fk_tree_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
    CONSTRAINT fk_tree_req_skill FOREIGN KEY (required_skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE personagem_skills (
    personagem_id INT NOT NULL,
    skill_id INT NOT NULL,
    nivel_atual INT DEFAULT 1,
    PRIMARY KEY (personagem_id, skill_id),
    CONSTRAINT fk_pskills_personagem FOREIGN KEY (personagem_id) REFERENCES personagens(id) ON DELETE CASCADE,
    CONSTRAINT fk_pskills_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Tabelas de Inventário e Relacionamentos Complexos (Reordenadas após 'Itens' e 'personagens')

CREATE TABLE inventario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    personagem_id INT NOT NULL,
    item_id INT NOT NULL,
    slot_index INT NOT NULL,
    quantidade INT DEFAULT 1,
    equipado BOOLEAN DEFAULT FALSE,
    sku VARCHAR(50) UNIQUE,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_inventario_personagem_slot (personagem_id, slot_index),
    CONSTRAINT fk_inventario_personagem FOREIGN KEY (personagem_id) REFERENCES personagens(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventario_item FOREIGN KEY (item_id) REFERENCES Itens(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE map_items (
    map_id INT NOT NULL,
    item_id INT NOT NULL,
    posicao_x FLOAT DEFAULT 0.0,
    posicao_y FLOAT DEFAULT 0.0,
    quantidade INT DEFAULT 1,
    tempo_respawn_segundos INT DEFAULT 60,
    PRIMARY KEY (map_id, item_id, posicao_x, posicao_y),
    CONSTRAINT fk_mapitems_map FOREIGN KEY (map_id) REFERENCES map(id) ON DELETE CASCADE,
    CONSTRAINT fk_mapitems_item FOREIGN KEY (item_id) REFERENCES Itens(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mob_drops (
    mob_id INT NOT NULL,
    item_id INT NOT NULL,
    quantidade_min INT DEFAULT 1,
    quantidade_max INT DEFAULT 1,
    chance_drop FLOAT DEFAULT 1.0,
    PRIMARY KEY (mob_id, item_id),
    CONSTRAINT fk_mobdrops_mob FOREIGN KEY (mob_id) REFERENCES mobs(id) ON DELETE CASCADE,
    CONSTRAINT fk_mobdrops_item FOREIGN KEY (item_id) REFERENCES Itens(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Inserts — table_nivel (do script oficial, como entregue)
INSERT INTO table_nivel (nivel, xp_necessaria) VALUES
(1, 0),
(2, 100),
(3, 125),
(4, 150),
(5, 175),
(6, 200),
(7, 225),
(8, 250),
(9, 275),
(10, 300),
(11, 325),
(12, 350),
(13, 375),
(14, 400),
(15, 425),
(16, 1450),
(17, 1600),
(18, 1750),
(19, 1800),
(20, 2500),
(21, 99999999999);

-- =====================================================================
-- 2. POPULAR O MÍNIMO — dados de teste
-- =====================================================================

-- Itens: espada e escudo de treino, mais o catálogo dos ícones em assets/inventory/Itens.
INSERT INTO Itens (nome, descricao, localizacao, chance, tipo, bonus_dano, bonus_defesa, bonus_hp) VALUES
('espada', 'Espada simples para combate corpo a corpo.', NULL, 1.0, 'Equipamento', 10, 0, 0),
('escudo_improvisado', 'Escudo improvisado de treino', NULL, 1.0, 'Equipamento', 0, 5, 20),
('Anel', 'Anel simples que completa o equipamento.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('arco', 'Arco leve para ataques à distância.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('botasAtirador', 'Botas leves para manter a mobilidade do atirador.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('botasGuerreiro', 'Botas reforçadas para o combate corpo a corpo.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('botasMago', 'Botas leves usadas por magos em expedições.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('botasSuporte', 'Botas resistentes para acompanhar o grupo.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('botasTank', 'Botas pesadas feitas para suportar impactos.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('cajadoMago', 'Cajado utilizado por magos em combate.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('cajadoSuporte', 'Cajado usado para auxiliar os aliados.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('calçaAtirador', 'Calça leve para manter a agilidade do atirador.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('calçaGuerreiro', 'Calça reforçada para uso em combate.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('calçaMago', 'Calça leve usada por magos.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('calçaSuporte', 'Calça resistente para acompanhar o grupo.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('calçaTank', 'Calça acolchoada para proteger o tanque.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('capaceteGuerreiro', 'Capacete reforçado para proteger o guerreiro.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('capaceteTank', 'Capacete pesado com foco em proteção.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('capuz', 'Capuz simples que cobre a cabeça.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('chapéuMago', 'Chapéu tradicional usado por magos.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('clava', 'Clava pesada para ataques corpo a corpo.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('escudo', 'Escudo usado para bloquear ataques.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('flecha', 'Munição compatível com arcos.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('lança', 'Lança de alcance médio para combate.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('marreta', 'Marreta pesada para golpes de impacto.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('peitoralAtirador', 'Peitoral leve para manter a agilidade.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('peitoralGuerreiro', 'Peitoral reforçado para o guerreiro.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('peitoralMago', 'Peitoral leve usado por magos.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('peitoralSuporte', 'Peitoral resistente para funções de suporte.', NULL, 1.0, 'Equipamento', 0, 0, 0),
('peitoralTank', 'Peitoral pesado com foco em proteção.', NULL, 1.0, 'Equipamento', 0, 0, 0);

-- mobs: 5 tipos de teste (Loot & Inimigos, Passo 1a + Passo 2a — valores
-- provisórios do dono do projeto). 'Comum' é 50hp/15atk/2def, o baseline
-- original do inimigo único de antes do Passo 1; 'Elite' é o boss/raro
-- do Passo 2 (mais durão, XP alto, peso_spawn baixo = raro).
-- experiencia_dropada aqui é multiplicador de XP, não XP fixo (ver comentário
-- na CREATE TABLE mobs acima) — consumido só a partir do Passo 1c.
-- peso_spawn é o peso relativo do sorteio ponderado (Passo 2b); peso total
-- dos 5 tipos comuns = 95, Elite = ~5% de chance. Boss tem peso 0 e is_boss=TRUE (P3 Sub-passo C1).
INSERT INTO mobs (nome_inimigo, vida, defesa, ataque, experiencia_dropada, nivel, peso_spawn, is_boss) VALUES
('Comum', 50, 2, 15, 1.0, 1, 30, FALSE),
('Fraco', 70, 3, 18, 1.3, 1, 25, FALSE),
('Medio', 100, 4, 22, 1.6, 1, 20, FALSE),
('Forte', 140, 6, 28, 2.0, 1, 15, FALSE),
('Elite', 250, 10, 40, 3.5, 1, 5, FALSE),
('Boss', 1000, 15, 60, 5.0, 5, 0, TRUE);

-- mob_drops: drops de teste (Loot & Inimigos, Passo 4a — valores provisórios do
-- dono do projeto). Inimigo mais forte dropa com mais chance; Elite tem 2 linhas
-- (dropa espada E escudo, chances independentes). mob_id resolvido por subquery
-- pelo nome, não hardcoded — não depende da ordem/AUTO_INCREMENT do INSERT acima.
INSERT INTO mob_drops (mob_id, item_id, quantidade_min, quantidade_max, chance_drop)
SELECT id, 1, 1, 1, 0.20 FROM mobs WHERE nome_inimigo = 'Comum'
UNION ALL SELECT id, 1, 1, 1, 0.30 FROM mobs WHERE nome_inimigo = 'Fraco'
UNION ALL SELECT id, 2, 1, 1, 0.40 FROM mobs WHERE nome_inimigo = 'Medio'
UNION ALL SELECT id, 2, 1, 1, 0.60 FROM mobs WHERE nome_inimigo = 'Forte'
UNION ALL SELECT id, 1, 1, 1, 0.80 FROM mobs WHERE nome_inimigo = 'Elite'
UNION ALL SELECT id, 2, 1, 1, 0.80 FROM mobs WHERE nome_inimigo = 'Elite';

-- jogadores: 1 jogador de teste
INSERT INTO jogadores (Nome, email, Senha, roles, is_active) VALUES
('Jogador Teste', 'teste@jogo-pi.local', 'senha_teste_123', 'user', TRUE);

-- personagens: os 5 de teste, nível 1, XP 0, atributos-base conforme
-- CLASSES em server.js (linhas 18-24). hp_atual = hp_max (HP cheio).
INSERT INTO personagens (jogadores_id, nome, classe, nivel, experiencia, hp_atual, hp_max, dano_base, defesa_base) VALUES
((SELECT id FROM jogadores WHERE email = 'teste@jogo-pi.local'), 'Guerreiro Teste', 'guerreiro', 1, 0, 100, 100, 25, 5),
((SELECT id FROM jogadores WHERE email = 'teste@jogo-pi.local'), 'Mago Teste',      'mago',      1, 0, 60,  60,  40, 3),
((SELECT id FROM jogadores WHERE email = 'teste@jogo-pi.local'), 'Arqueiro Teste',  'arqueiro',  1, 0, 70,  70,  35, 3),
((SELECT id FROM jogadores WHERE email = 'teste@jogo-pi.local'), 'Suporte Teste',   'suporte',   1, 0, 80,  80,  20, 4),
((SELECT id FROM jogadores WHERE email = 'teste@jogo-pi.local'), 'Tanque Teste',    'tanque',    1, 0, 150, 150, 15, 8);

INSERT INTO inventario (personagem_id, item_id, quantidade, equipado, slot_index) VALUES
(
    (SELECT id FROM personagens WHERE nome = 'Guerreiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'espada'), 1, TRUE, 0
),
(
    (SELECT id FROM personagens WHERE nome = 'Guerreiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'capaceteGuerreiro'), 1, TRUE, 16
),
(
    (SELECT id FROM personagens WHERE nome = 'Guerreiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'peitoralGuerreiro'), 1, TRUE, 15
),
(
    (SELECT id FROM personagens WHERE nome = 'Guerreiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'calçaGuerreiro'), 1, TRUE, 17
),
(
    (SELECT id FROM personagens WHERE nome = 'Guerreiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'botasGuerreiro'), 1, TRUE, 18
),
(
    (SELECT id FROM personagens WHERE nome = 'Mago Teste'),
    (SELECT id FROM Itens WHERE nome = 'cajadoMago'), 1, TRUE, 0
),
(
    (SELECT id FROM personagens WHERE nome = 'Mago Teste'),
    (SELECT id FROM Itens WHERE nome = 'chapéuMago'), 1, TRUE, 16
),
(
    (SELECT id FROM personagens WHERE nome = 'Mago Teste'),
    (SELECT id FROM Itens WHERE nome = 'peitoralMago'), 1, TRUE, 15
),
(
    (SELECT id FROM personagens WHERE nome = 'Mago Teste'),
    (SELECT id FROM Itens WHERE nome = 'calçaMago'), 1, TRUE, 17
),
(
    (SELECT id FROM personagens WHERE nome = 'Mago Teste'),
    (SELECT id FROM Itens WHERE nome = 'botasMago'), 1, TRUE, 18
),
(
    (SELECT id FROM personagens WHERE nome = 'Arqueiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'arco'), 1, TRUE, 0
),
(
    (SELECT id FROM personagens WHERE nome = 'Arqueiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'flecha'), 1, FALSE, 1
),
(
    (SELECT id FROM personagens WHERE nome = 'Arqueiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'peitoralAtirador'), 1, TRUE, 15
),
(
    (SELECT id FROM personagens WHERE nome = 'Arqueiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'calçaAtirador'), 1, TRUE, 17
),
(
    (SELECT id FROM personagens WHERE nome = 'Arqueiro Teste'),
    (SELECT id FROM Itens WHERE nome = 'botasAtirador'), 1, TRUE, 18
),
(
    (SELECT id FROM personagens WHERE nome = 'Suporte Teste'),
    (SELECT id FROM Itens WHERE nome = 'cajadoSuporte'), 1, TRUE, 0
),
(
    (SELECT id FROM personagens WHERE nome = 'Suporte Teste'),
    (SELECT id FROM Itens WHERE nome = 'capuz'), 1, TRUE, 16
),
(
    (SELECT id FROM personagens WHERE nome = 'Suporte Teste'),
    (SELECT id FROM Itens WHERE nome = 'peitoralSuporte'), 1, TRUE, 15
),
(
    (SELECT id FROM personagens WHERE nome = 'Suporte Teste'),
    (SELECT id FROM Itens WHERE nome = 'calçaSuporte'), 1, TRUE, 17
),
(
    (SELECT id FROM personagens WHERE nome = 'Suporte Teste'),
    (SELECT id FROM Itens WHERE nome = 'botasSuporte'), 1, TRUE, 18
),
(
    (SELECT id FROM personagens WHERE nome = 'Suporte Teste'),
    (SELECT id FROM Itens WHERE nome = 'Anel'), 1, TRUE, 1
),
(
    (SELECT id FROM personagens WHERE nome = 'Tanque Teste'),
    (SELECT id FROM Itens WHERE nome = 'escudo_improvisado'), 1, TRUE, 0
),
(
    (SELECT id FROM personagens WHERE nome = 'Tanque Teste'),
    (SELECT id FROM Itens WHERE nome = 'marreta'), 1, TRUE, 1
),
(
    (SELECT id FROM personagens WHERE nome = 'Tanque Teste'),
    (SELECT id FROM Itens WHERE nome = 'capaceteTank'), 1, TRUE, 16
),
(
    (SELECT id FROM personagens WHERE nome = 'Tanque Teste'),
    (SELECT id FROM Itens WHERE nome = 'peitoralTank'), 1, TRUE, 15
),
(
    (SELECT id FROM personagens WHERE nome = 'Tanque Teste'),
    (SELECT id FROM Itens WHERE nome = 'calçaTank'), 1, TRUE, 17
),
(
    (SELECT id FROM personagens WHERE nome = 'Tanque Teste'),
    (SELECT id FROM Itens WHERE nome = 'botasTank'), 1, TRUE, 18
);





GRANT ALL PRIVILEGES ON jogo_pi.* TO 'rpg_app'@'localhost';
FLUSH PRIVILEGES;
