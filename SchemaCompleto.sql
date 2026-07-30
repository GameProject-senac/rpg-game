CREATE DATABASE IF NOT EXISTS jogo_pi;
USE jogo_pi;

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
    chance FLOAT DEFAULT 1.0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome_inimigo VARCHAR(100),
    vida INT NOT NULL,
    defesa INT DEFAULT 0,
    ataque INT DEFAULT 0,
    experiencia_dropada INT DEFAULT 0,
    nivel INT DEFAULT 1
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
    experiencia INT DEFAULT 0,
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

CREATE TABLE inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    personagem_id INT NOT NULL,
    item_id INT NOT NULL,
    quantidade INT DEFAULT 1,
    equipado BOOLEAN DEFAULT FALSE,
    sku VARCHAR(50) UNIQUE,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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

-- 4. Inserts
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