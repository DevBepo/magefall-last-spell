import './styles/main.css';
import { GameClient } from './game/GameClient';
import { OnlineGameClient } from './game/OnlineGameClient';

const host = document.querySelector<HTMLElement>('#app');
if (!host) throw new Error('App root not found');

const game = new URLSearchParams(location.search).has('offline') ? new GameClient(host) : new OnlineGameClient(host);
game.start();
