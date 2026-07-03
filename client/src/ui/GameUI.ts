import { ITEMS } from '../../../shared/config/items';
import { MAGES } from '../../../shared/config/mages';
import type { SelectionState } from '../../../shared/protocol';
import type { ItemId, MageId } from '../../../shared/types';

export interface HudData {
  hp: number; maxHp: number; shield: number; dash: number; special: number; active?: number;
  items: ItemId[]; bossHp?: number; bossMaxHp?: number; phaseLabel: string; players?: Array<{ name: string; playerIndex: number; alive: boolean }>;
}

export class GameUI {
  readonly root: HTMLElement;
  private overlay!: HTMLElement;
  private hud!: HTMLElement;
  private toast!: HTMLElement;
  onSelectMage?: (id: MageId) => void;
  onSelectItem?: (id: ItemId) => void;
  onRestart?: () => void;
  onCreateRoom?: (name: string) => void;
  onJoinRoom?: (name: string, roomId: string) => void;
  onStartGame?: () => void;

  constructor(host: HTMLElement) {
    host.innerHTML = `<div id="viewport"></div><div id="hud"></div><div id="overlay"></div><div id="toast"></div><div class="controls">WASD mover · Mouse ou setas/IJKL mirar · Clique/Enter atacar · Espaço dash · Q especial · E item</div>`;
    this.root = host.querySelector('#viewport')!;
    this.overlay = host.querySelector('#overlay')!;
    this.hud = host.querySelector('#hud')!;
    this.toast = host.querySelector('#toast')!;
  }

  showLoading(): void {
    this.overlay.className = 'overlay visible loading';
    this.overlay.innerHTML = `<div class="sigil">✦</div><h1>MAGE <span>ROYALE</span></h1><p>Forjando o reino...</p><div class="loader"><i></i></div>`;
    this.hud.innerHTML = '';
  }

  showHome(): void {
    const saved = localStorage.getItem('mage-name') ?? '';
    this.overlay.className = 'overlay visible room-home'; this.hud.innerHTML = '';
    this.overlay.innerHTML = `<div class="sigil">✦</div><h1>MAGEFALL: <span>LAST SPELL</span></h1><p>Crie uma sala privada ou entre com o código de seus amigos.</p><div class="room-form"><label>Nome <input id="player-name" maxlength="16" value="${this.escape(saved)}" placeholder="Player 1"></label><button id="create-room">Criar sala</button><div class="join-row"><input id="room-code" maxlength="6" placeholder="CÓDIGO" autocomplete="off"><button id="join-room">Entrar em sala</button></div></div><div class="home-controls">WASD mover · Mouse ou setas/IJKL mirar · Clique/Enter atacar · Espaço dash · Q especial · E relíquia</div>`;
    const name = () => (this.overlay.querySelector<HTMLInputElement>('#player-name')?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
    this.overlay.querySelector<HTMLElement>('#create-room')!.onclick = () => this.onCreateRoom?.(name());
    this.overlay.querySelector<HTMLElement>('#join-room')!.onclick = () => this.onJoinRoom?.(name(), this.overlay.querySelector<HTMLInputElement>('#room-code')?.value ?? '');
  }

  showMageSelection(state?: SelectionState, playerId?: string): void {
    const cards = (Object.keys(MAGES) as MageId[]).map(id => {
      const m = MAGES[id];
      return `<button class="mage-card ${id}" data-mage="${id}"><span class="mage-preview"><i class="head"></i><i class="body"></i><i class="staff"></i><i class="pedestal"></i></span><strong>${m.name}</strong><small>${m.title}</small><p>${m.description}</p><em>Escolher ${m.name}</em></button>`;
    }).join('');
    this.overlay.className = 'overlay visible selection';
    const me = state?.players.find(p => p.id === playerId); const connected = state?.players.filter(p => p.connected) ?? [];
    const roster = state ? `<div class="lobby-panel"><div><b>SALA <button id="copy-code" title="Copiar código">${state.roomId}</button></b><small>${connected.length}/${state.maxPlayers} jogadores · mínimo ${state.minPlayers}</small></div><ul>${state.players.map(p => `<li class="player-${p.playerIndex}"><span>P${p.playerIndex}</span><strong>${this.escape(p.name)}</strong><em>${p.isHost ? 'HOST' : ''}</em><small>${p.mage ? MAGES[p.mage].name : 'Escolhendo...'}</small></li>`).join('')}</ul>${me?.isHost ? `<button id="start-game" ${state.canStart ? '' : 'disabled'}>Iniciar partida</button>` : '<p>Aguardando host iniciar</p>'}</div>` : '';
    this.overlay.innerHTML = `<div class="eyebrow">MAGEFALL: LAST SPELL</div><h2>Escolha seu último feitiço</h2>${roster}<div class="mage-grid">${cards}</div><div class="selection-controls">Magos podem repetir · escolha pode ser alterada antes da partida</div>`;
    this.overlay.querySelectorAll<HTMLElement>('[data-mage]').forEach(b => b.onclick = () => this.onSelectMage?.(b.dataset.mage as MageId));
    this.overlay.querySelector<HTMLElement>('#start-game')?.addEventListener('click', () => this.onStartGame?.());
    this.overlay.querySelector<HTMLElement>('#copy-code')?.addEventListener('click', () => { if (state) void navigator.clipboard?.writeText(state.roomId); this.message('Código copiado'); });
  }

  showConnection(title: string, message: string, allowOffline = false): void {
    this.overlay.className = 'overlay visible loading';
    this.overlay.innerHTML = `<div class="sigil">✦</div><h2>${title}</h2><p>${message}</p>${allowOffline ? '<button id="offline">Jogar offline</button>' : ''}`;
    this.overlay.querySelector<HTMLElement>('#offline')?.addEventListener('click', () => { location.href = `${location.pathname}?offline=1`; });
  }

  showItemChoice(level: number, ids: ItemId[]): void {
    this.overlay.className = 'overlay visible items-screen';
    this.overlay.innerHTML = `<div class="eyebrow">BOSS ${level} DERROTADO</div><h2>Escolha uma relíquia</h2><p class="subtitle">Sua build levará exatamente três relíquias à arena final.</p><div class="item-grid">${ids.map(id => {
      const it = ITEMS[id];
      return `<button class="item-card" data-item="${id}" style="--item:${it.color}"><span>${it.icon}</span><strong>${it.name}</strong><p>${it.description}</p><em>Reivindicar</em></button>`;
    }).join('')}</div>`;
    this.overlay.querySelectorAll<HTMLElement>('[data-item]').forEach(b => b.onclick = () => this.onSelectItem?.(b.dataset.item as ItemId));
  }

  showResult(won: boolean, mage: MageId, items: ItemId[], winnerName = 'Você', canRestart = true): void {
    this.overlay.className = `overlay visible result ${won ? 'win' : 'loss'}`;
    this.overlay.innerHTML = `<div class="crown">${won ? '♛' : '☠'}</div><div class="eyebrow">${won ? 'ÚLTIMO MAGO VIVO' : 'O REINO COBROU SEU PREÇO'}</div><h2>${won ? 'Vitória arcana!' : 'Derrota'}</h2><p>${this.escape(winnerName)} venceu. Você terminou como ${MAGES[mage].name} com ${items.length} relíquias.</p><div class="result-items">${items.map(id => `<span title="${ITEMS[id].name}">${ITEMS[id].icon}</span>`).join('')}</div>${canRestart ? '<button id="restart">Voltar ao lobby</button>' : '<p>Aguardando o host voltar ao lobby</p>'}`;
    this.overlay.querySelector<HTMLElement>('#restart')?.addEventListener('click', () => this.onRestart?.());
  }

  hideOverlay(): void { this.overlay.className = 'overlay'; }

  updateHud(data: HudData): void {
    const hpPct = Math.max(0, data.hp / data.maxHp * 100);
    const boss = data.bossHp !== undefined && data.bossMaxHp ? `<div class="boss"><label>${data.phaseLabel}</label><div><i style="width:${Math.max(0, data.bossHp / data.bossMaxHp * 100)}%"></i></div><small>${Math.ceil(data.bossHp)} / ${data.bossMaxHp}</small></div>` : `<div class="phase">${data.phaseLabel}</div>`;
    const active = data.items.find(id => ITEMS[id].active);
    this.hud.innerHTML = `${boss}<div class="status"><div class="portrait">✦</div><div class="health"><label>VIDA ${Math.ceil(data.hp)} / ${data.maxHp}${data.shield ? ` · ESCUDO ${Math.ceil(data.shield)}` : ''}</label><div><i style="width:${hpPct}%"></i></div></div></div><div class="abilities"><div><kbd>ESPAÇO</kbd><b>Dash</b><i style="--cd:${data.dash}"></i></div><div><kbd>Q</kbd><b>Especial</b><i style="--cd:${data.special}"></i></div>${active ? `<div><kbd>E</kbd><b>${ITEMS[active].name}</b><i style="--cd:${data.active ?? 0}"></i></div>` : ''}</div><div class="inventory">${[0, 1, 2].map(i => data.items[i] ? `<span title="${ITEMS[data.items[i]!].name}">${ITEMS[data.items[i]!].icon}</span>` : '<span class="empty">+</span>').join('')}</div>`;
    if (data.players) this.hud.insertAdjacentHTML('beforeend', `<div class="hud-roster">${data.players.map(p => `<span class="player-${p.playerIndex} ${p.alive ? '' : 'dead'}">P${p.playerIndex} ${this.escape(p.name)}</span>`).join('')}</div>`);
  }

  message(text: string, duration = 1800): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    window.setTimeout(() => this.toast.classList.remove('show'), duration);
  }

  private escape(text: string): string { const span = document.createElement('span'); span.textContent = text; return span.innerHTML; }
}
