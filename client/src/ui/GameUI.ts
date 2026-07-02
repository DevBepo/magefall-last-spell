import { ITEMS } from '../../../shared/config/items';
import { MAGES } from '../../../shared/config/mages';
import type { ItemId, MageId } from '../../../shared/types';

export interface HudData {
  hp: number; maxHp: number; shield: number; dash: number; special: number;
  items: ItemId[]; bossHp?: number; bossMaxHp?: number; phaseLabel: string;
}

export class GameUI {
  readonly root: HTMLElement;
  private overlay!: HTMLElement;
  private hud!: HTMLElement;
  private toast!: HTMLElement;
  onSelectMage?: (id: MageId) => void;
  onSelectItem?: (id: ItemId) => void;
  onRestart?: () => void;

  constructor(host: HTMLElement) {
    host.innerHTML = `<div id="viewport"></div><div id="hud"></div><div id="overlay"></div><div id="toast"></div><div class="controls">WASD mover · Mouse mirar · Clique atacar · Espaço dash · Q especial</div>`;
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

  showMageSelection(taken: MageId[] = [], playerCount?: number, requiredPlayers = 4): void {
    const cards = (Object.keys(MAGES) as MageId[]).map(id => {
      const m = MAGES[id];
      const occupied = taken.includes(id);
      return `<button class="mage-card ${id}" data-mage="${id}" ${occupied ? 'disabled' : ''}><span class="element">${id === 'ice' ? '❄' : id === 'fire' ? '♨' : id === 'shadow' ? '◈' : '✦'}</span><strong>${m.name}</strong><small>${m.title}</small><p>${m.description}</p><em>${occupied ? 'Ocupado' : `Escolher ${m.name}`}</em></button>`;
    }).join('');
    this.overlay.className = 'overlay visible selection';
    this.overlay.innerHTML = `<div class="eyebrow">ESCOLHA SEU CAMPEÃO${playerCount === undefined ? '' : ` · ${playerCount}/${requiredPlayers} CONECTADOS`}</div><h2>Quatro caminhos. Uma coroa.</h2><div class="mage-grid">${cards}</div>`;
    this.overlay.querySelectorAll<HTMLElement>('[data-mage]').forEach(b => b.onclick = () => this.onSelectMage?.(b.dataset.mage as MageId));
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

  showResult(won: boolean, mage: MageId, items: ItemId[]): void {
    this.overlay.className = `overlay visible result ${won ? 'win' : 'loss'}`;
    this.overlay.innerHTML = `<div class="crown">${won ? '♛' : '☠'}</div><div class="eyebrow">${won ? 'ÚLTIMO MAGO VIVO' : 'O REINO COBROU SEU PREÇO'}</div><h2>${won ? 'Vitória arcana!' : 'Derrota'}</h2><p>${MAGES[mage].name} encerrou a partida com ${items.length} relíquias.</p><div class="result-items">${items.map(id => `<span title="${ITEMS[id].name}">${ITEMS[id].icon}</span>`).join('')}</div><button id="restart">Jogar novamente</button>`;
    this.overlay.querySelector<HTMLElement>('#restart')!.onclick = () => this.onRestart?.();
  }

  hideOverlay(): void { this.overlay.className = 'overlay'; }

  updateHud(data: HudData): void {
    const hpPct = Math.max(0, data.hp / data.maxHp * 100);
    const boss = data.bossHp !== undefined && data.bossMaxHp ? `<div class="boss"><label>${data.phaseLabel}</label><div><i style="width:${Math.max(0, data.bossHp / data.bossMaxHp * 100)}%"></i></div><small>${Math.ceil(data.bossHp)} / ${data.bossMaxHp}</small></div>` : `<div class="phase">${data.phaseLabel}</div>`;
    this.hud.innerHTML = `${boss}<div class="status"><div class="portrait">✦</div><div class="health"><label>VIDA ${Math.ceil(data.hp)} / ${data.maxHp}${data.shield ? ` · ESCUDO ${Math.ceil(data.shield)}` : ''}</label><div><i style="width:${hpPct}%"></i></div></div></div><div class="abilities"><div><kbd>ESPAÇO</kbd><b>Dash</b><i style="--cd:${data.dash}"></i></div><div><kbd>Q</kbd><b>Especial</b><i style="--cd:${data.special}"></i></div></div><div class="inventory">${[0, 1, 2].map(i => data.items[i] ? `<span title="${ITEMS[data.items[i]!].name}">${ITEMS[data.items[i]!].icon}</span>` : '<span class="empty">+</span>').join('')}</div>`;
  }

  message(text: string, duration = 1800): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    window.setTimeout(() => this.toast.classList.remove('show'), duration);
  }
}
