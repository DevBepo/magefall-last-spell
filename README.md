# Magefall: Last Spell

Um arena roguelite 3D experimental para quatro amigos. O grupo enfrenta três bosses, escolhe itens entre as lutas e termina a partida em um confronto PvP. A simulação multiplayer é autoritativa no servidor.

> Este é um projeto pequeno, experimental e deliberadamente bobo, feito para jogar entre amigos e publicado como projeto de portfólio. Não espere matchmaking, persistência ou a robustez de um jogo comercial.

## Stack

- Three.js, TypeScript e Vite no client
- Node.js, Express e Socket.IO no servidor
- Vitest para testes unitários
- Playwright para o fluxo multiplayer de ponta a ponta

## Controles

- `WASD`: movimento
- Mouse: mira
- Clique esquerdo: ataque
- `Espaço`: dash
- `Q`: habilidade especial

## Rodando localmente

Requisitos: Node.js 20 ou mais recente e npm.

```bash
npm install
npm run dev
```

O Vite abre em `http://127.0.0.1:5173` e encaminha o Socket.IO para o servidor em `http://127.0.0.1:3000`.

### Modo offline

Com o ambiente de desenvolvimento rodando, abra:

```text
http://127.0.0.1:5173/?offline=1
```

### Multiplayer com 2 jogadores

Abra a URL abaixo em dois navegadores, perfis ou janelas anônimas diferentes:

```text
http://127.0.0.1:5173/?test=1&players=2
```

### Multiplayer com 4 jogadores

Para uma partida normal, abra `http://127.0.0.1:5173/` em quatro perfis e escolha quatro magos diferentes. Para acelerar o fluxo em desenvolvimento, use em quatro perfis:

```text
http://127.0.0.1:5173/?test=1&players=4
```

O parâmetro `?test=1&players=2` ou `?test=1&players=4` reduz o número necessário de jogadores no ambiente de desenvolvimento. Nesse modo, a tecla `K` derrota o boss atual ou encerra o PvP em favor de quem a pressionou. O servidor só aceita essa ação quando `ALLOW_TEST_MODE=true`; os scripts `dev` e `dev:e2e` já definem essa variável. `npm start` não habilita o modo de teste.

## Testes e validação

```bash
npm run typecheck
npm run test:unit
npm run test:e2e
npm run build
npm run check
```

`npm run check` executa typecheck, testes unitários e o build. O teste E2E abre quatro contextos de navegador e percorre seleção, bosses, itens, PvP, vencedor e reset.

## Build e produção local

```bash
npm run build
npm start
```

O build gera `dist/client` e `dist/server`. O processo Node serve o client estático, o endpoint `/health` e o Socket.IO na porta definida por `PORT` (ou `3000` localmente).

## Deploy no Railway

1. Crie um novo projeto no Railway a partir deste repositório.
2. Não configure variáveis secretas: o jogo não precisa delas.
3. O Railway usará `npm run build` no build e `npm start` para iniciar o serviço.
4. Mantenha apenas uma réplica, pois a sala e a partida vivem em memória.
5. Use `/health` como healthcheck, se a plataforma não ler automaticamente o `railway.json`.

O Railway fornece `PORT` automaticamente. Não habilite `ALLOW_TEST_MODE` em produção.

## Arquitetura e limitações conhecidas

- Há uma única `GameRoom` em memória, limitada a quatro conexões.
- A simulação roda no servidor a 20 Hz, com snapshots a 12 Hz.
- O client envia somente comandos; o servidor controla posições, colisões, HP, cooldowns, itens, bosses, projéteis, fases e vencedor.
- A reconexão usa um token aleatório no `localStorage` por até 30 segundos.
- Não há login, nickname, matchmaking, banco de dados nem persistência.
- Reiniciar o processo encerra a partida atual; múltiplas réplicas não compartilham estado.
- O modo offline é separado da simulação multiplayer e serve para testes rápidos.

## Licença

Distribuído sob a licença MIT. Consulte [LICENSE](LICENSE).
