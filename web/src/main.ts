/**
 * 入口：Phaser 配置 + 全局服务注册 + 首屏 loading 收尾 + 全局错误兜底
 * 负责人：P1
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './core/constants';
import { log } from './core/logger';
import { setGlobalService } from './core/services';
import { BootScene } from './scenes/BootScene';
import { ForgeScene } from './scenes/ForgeScene';
import { GameScene } from './scenes/GameScene';
import { LoadoutScene } from './scenes/LoadoutScene';
import { MenuScene } from './scenes/MenuScene';
import { ResultScene } from './scenes/ResultScene';
import { RewardScene } from './scenes/RewardScene';
import { SandboxScene } from './scenes/SandboxScene';
import { SlotScene } from './scenes/SlotScene';
import { StageSelectScene } from './scenes/StageSelectScene';
import { TitleScene } from './scenes/TitleScene';
import { TutorialScene } from './scenes/TutorialScene';
import { AudioManager } from './systems/AudioManager';
import { SaveSystem } from './systems/SaveSystem';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0b0d17',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [
    BootScene,
    TitleScene,
    SlotScene,
    MenuScene,
    ForgeScene,
    LoadoutScene,
    StageSelectScene,
    GameScene,
    TutorialScene,
    RewardScene,
    ResultScene,
    SandboxScene,
  ],
};

const game = new Phaser.Game(config);

// ---------- 开发期调试钩子（DEV 才有，生产构建不带） ----------
// 验收/联调脚本用：window.__game.scene.getScene('Game') + import('/src/core/services.ts')
if (import.meta.env.DEV) {
  (window as unknown as { __game?: Phaser.Game }).__game = game;
}

// ---------- 全局服务（跨场景、跨局保留） ----------
const save = new SaveSystem();
setGlobalService(game, 'save', save);

const audio = new AudioManager(save);
setGlobalService(game, 'audio', audio);

// ---------- 首屏 DOM loading 收尾 ----------
function hideDomBootOverlay(): void {
  const overlay = document.getElementById('boot-overlay');
  if (!overlay) return;
  overlay.classList.add('is-hidden');
  // 仅用于 DOM 首屏淡出（不是游戏内计时器）
  window.setTimeout(() => overlay.remove(), 420);
}

function showFatal(message: string): void {
  const overlay = document.getElementById('boot-overlay');
  const fatal = document.getElementById('boot-fatal');
  if (!overlay || !fatal) return;
  overlay.classList.remove('is-hidden');
  fatal.style.display = 'block';
  fatal.textContent = `启动失败：${message}\n\n请截图这段信息，或按 F5 重试。`;
}

game.events.once(Phaser.Core.Events.READY, () => {
  log.p1.info(`Phaser ${Phaser.VERSION} 已就绪`);
  hideDomBootOverlay();
});

// 浏览器自动播放策略：首次交互后解锁音频
const unlockAudio = (): void => {
  audio.unlock();
};
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// ---------- 全局错误兜底：不允许白屏 ----------
window.addEventListener('error', (event) => {
  log.p1.error('未捕获错误', event.error ?? event.message);
  showFatal(event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  log.p1.error('未处理的 Promise 拒绝', event.reason);
  showFatal(String(event.reason));
});
