-- Dados de teste do Pacote 1 (fase2_spec.md §1.5).
-- Valores arbitrários de teste — não alterar/"balancear".

INSERT INTO jogadores (username, senha_hash) VALUES ('teste', 'placeholder');

INSERT INTO personagens (jogadores_id, nome, classe, nivel, hp_atual, hp_max, dano_base, defesa_base)
VALUES
  (1, 'Guerreiro Teste', 'guerreiro', 1, 100, 100, 25, 5),
  (1, 'Mago Teste',      'mago',      1, 60,  60,  40, 3),
  (1, 'Arqueiro Teste',  'arqueiro',  1, 70,  70,  35, 3),
  (1, 'Suporte Teste',   'suporte',   1, 80,  80,  20, 4),
  (1, 'Tanque Teste',    'tanque',    1, 150, 150, 15, 8);
