# Magefall: Last Spell

**Release v0.1.0**

Um arena roguelite 3D experimental para grupos de amigos. Cada grupo cria uma sala privada, cada jogador enfrenta três bosses em um farm solo local e os jogadores prontos terminam a rodada em um PvP autoritativo no servidor.

## Fluxo online

`lobby → farm solo → espera → PvP`

O farm não é cooperativo: cada navegador mantém sua própria instância de bosses, minions, projéteis e escolhas. Ao terminar, o cliente envia dois itens passivos, uma relíquia ativa e stats resumidos; o servidor valida IDs, ordem e limites. A espera mostra quem ainda está farmando. O host pode iniciar com todos ou antecipar com pelo menos dois prontos; quem não terminou fica fora daquela rodada.

Protocolo principal: `start_game`, `farm_progress`, `farm_completed`, `start_pvp`, `room_state`, `farm_status_updated`, `farm_completed_ack`, `farm_completed_rejected`, `snapshot` e `game_over`. Snapshots de combate são usados somente no PvP.

No modo `?test=1`, `K` elimina rapidamente o boss da instância local. Para testar início parcial, conclua o farm em dois navegadores e use **Iniciar PvP** no navegador host; os demais permanecem fora até o reset.

Limitação conhecida: jogadores não prontos não possuem modo espectador da rodada antecipada e permanecem na espera até o host resetar.

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
- `Setas` ou `IJKL`: mira alternativa sem mouse
- `Enter`: ataque pelo teclado
- `Espaço`: dash
- `Q`: habilidade especial
- `E`: usa a relíquia ativa obtida após o terceiro boss

## Rodando localmente

Requisitos: Node.js 20 ou mais recente e npm.

```bash
npm install
npm run dev
```

O Vite abre em `http://127.0.0.1:5173` e encaminha o Socket.IO para o servidor em `http://127.0.0.1:3000`.

### Salas privadas

1. Um jogador informa seu nome e clica em **Criar sala**.
2. Ele compartilha o código de cinco caracteres mostrado no lobby.
3. Os amigos informam seus nomes e usam **Entrar em sala** com esse código.
4. Cada participante escolhe qualquer mago; magos podem se repetir.
5. O host inicia manualmente quando ao menos dois jogadores tiverem escolhido.

Cada sala aceita de 2 a 6 jogadores; quatro é a quantidade recomendada. A primeira pessoa é host. Se ela desconectar, o jogador conectado mais antigo assume. Não existem salas públicas, lista de salas, entrada aleatória ou matchmaking.

### Modo offline

Com o ambiente de desenvolvimento rodando, abra:

```text
http://127.0.0.1:5173/?offline=1
```

### Multiplayer com 2 jogadores

Abra a URL abaixo em dois navegadores, perfis ou janelas anônimas diferentes. Crie a sala no primeiro, entre pelo código no segundo, escolha os magos e inicie como host:

```text
http://127.0.0.1:5173/?test=1&players=2
```

### Multiplayer com 4 jogadores

Para uma partida normal, abra `http://127.0.0.1:5173/` em quatro perfis, entre na mesma sala privada e escolha os magos (repetidos são permitidos). Para acelerar o fluxo em desenvolvimento, use em quatro perfis:

```text
http://127.0.0.1:5173/?test=1&players=4
```

O parâmetro `?test=1&players=2` ou `?test=1&players=4` reduz o número necessário de jogadores no ambiente de desenvolvimento. Nesse modo, a tecla `K` derrota o boss atual ou encerra o PvP em favor de quem a pressionou. O servidor só aceita essa ação quando `ALLOW_TEST_MODE=true`; os scripts `dev` e `dev:e2e` já definem essa variável. `npm start` não habilita o modo de teste.

## Testes e validação

### Diagnóstico de desempenho

Adicione `?debug=1` à URL para mostrar FPS, RTT, taxa e tamanho dos snapshots, entidades, buffer de interpolação e estado do Socket.IO. O overlay é apenas diagnóstico e não altera gameplay. Exemplo: `http://127.0.0.1:5173/?debug=1`.

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

Depois de iniciar, abra `http://127.0.0.1:3000/`. Para conferir o healthcheck:

```bash
curl http://127.0.0.1:3000/health
```

O resultado esperado é HTTP 200 com `{ "ok": true, ... }`. Client, API de saúde e Socket.IO usam a mesma origem em produção; URLs desconhecidas retornam `index.html` para suportar navegação direta sem interceptar `/health` ou `/socket.io`.

## Deploy no Railway

1. Crie um novo projeto no Railway a partir deste repositório.
2. Não configure variáveis secretas: o jogo não precisa delas.
3. O Railway usará `npm run build` no build e `npm start` para iniciar o serviço.
4. Mantenha apenas uma réplica, pois a sala e a partida vivem em memória.
5. Use `/health` como healthcheck, se a plataforma não ler automaticamente o `railway.json`.

O Railway fornece `PORT` automaticamente. Não habilite `ALLOW_TEST_MODE` em produção.

Após o deploy, gere um domínio público em **Settings → Networking** e valide `/health` nesse domínio. Não configure volume, banco ou Redis para o MVP. Scaling horizontal deve permanecer desativado: múltiplas réplicas criariam estados de sala independentes.

## Arquitetura e limitações conhecidas

- Há um `RoomManager` em memória, com uma `GameRoom` isolada para cada código privado e até seis conexões por sala.
- Durante o PvP, a simulação roda no servidor a 20 Hz.
- O farm roda localmente. No PvP, o client envia somente comandos e o servidor controla posições, colisões, HP, cooldowns, itens, projéteis, mortes e vencedor.
- A reconexão usa um token aleatório no `localStorage` por até 30 segundos.
- Nicknames são locais e não exigem conta. Não há login, matchmaking, descoberta pública, banco de dados nem persistência.
- Reiniciar o processo encerra a partida atual; múltiplas réplicas não compartilham estado.
- O modo offline é separado da simulação multiplayer e serve para testes rápidos.

## Licença

Distribuído sob a licença MIT. Consulte [LICENSE](LICENSE).
