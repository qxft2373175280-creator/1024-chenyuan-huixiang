/**
 * 战斗训练场（P2 自测场景，不属于正式流程）。
 *
 * 目的：在 P4 的 GameScene 落地前，能独立验收 M1 / P2-S1~S5 的全部条目：
 * WASD 移动、左键攻击、三类 AI、Boss 阶段、命中反馈、重开不泄漏。
 *
 * 正式流程里的 `?debug=sandbox` 由 P4 在 GameScene 里实现；本场景可以直接复用这里的刷怪与建墙逻辑。
 */

import Phaser from 'phaser';
import { DATA_FALLBACK, DEPTH, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH, MAP_COLS, MAP_ROWS, TILE_PX } from '../core/constants';
import { bus } from '../core/events';
import { SCENE_KEYS, TEX_KEYS } from '../core/keys';
import { log } from '../core/logger';
import { clearRunScopedServices, getService } from '../core/services';
import { getWeaponDef } from '../data';
import { EnemyService } from '../entities/Enemy';
import { PlayerService } from '../entities/Player';
import { installCombat } from '../systems/CombatSystem';
import { installBuild } from '../systems/WeaponSystem';

const PLAYER_START_TILE = { x: 20, y: 14 };

export class SandboxScene extends Phaser.Scene {
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private statusText!: Phaser.GameObjects.Text;
  private enemyText!: Phaser.GameObjects.Text;
  private deadText!: Phaser.GameObjects.Text;
  private playerServiceRef: PlayerService | null = null;
  private enemyServiceRef: EnemyService | null = null;
  private lastStatusLine = '';
  private playerDead = false;
  private continuousSpawn = false;

  constructor() {
    super(SCENE_KEYS.SANDBOX);
  }

  create(): void {
    this.playerDead = false;
    this.lastStatusLine = '';
    this.continuousSpawn = new URLSearchParams(window.location.search).get('debug') === 'sandbox';

    this.physics.world.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.cameras.main.setBackgroundColor('#0b0d17');
    this.cameras.main.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);

    installCombat(this);
    installBuild(this);

    this.buildArena();

    this.playerServiceRef = getService(this, 'player') as unknown as PlayerService;
    this.enemyServiceRef = getService(this, 'enemy') as unknown as EnemyService;

    this.playerServiceRef.create(PLAYER_START_TILE.x, PLAYER_START_TILE.y);
    const playerSprite = this.playerServiceRef.getSprite();
    if (playerSprite) {
      this.physics.add.collider(playerSprite, this.walls);
      this.cameras.main.startFollow(playerSprite, true, 0.12, 0.12);
    }
    this.physics.add.collider(this.enemyServiceRef.getGroup(), this.walls);

    this.buildHud();
    this.spawnWave();
    this.bindDebugKeys();
    this.bindEvents();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    log.p2.info('训练场就绪', { continuousSpawn: this.continuousSpawn });
  }

  override update(): void {
    this.refreshStatus();
  }

  /* ============================ 建场 ============================ */

  private buildArena(): void {
    this.add
      .tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, TEX_KEYS.TILE_FLOOR)
      .setDepth(DEPTH.FLOOR);

    this.walls = this.physics.add.staticGroup();
    for (let x = 0; x < MAP_COLS; x += 1) {
      this.addWall(x, 0);
      this.addWall(x, MAP_ROWS - 1);
    }
    for (let y = 1; y < MAP_ROWS - 1; y += 1) {
      this.addWall(0, y);
      this.addWall(MAP_COLS - 1, y);
    }
    const pillars: [number, number][] = [
      [8, 6],
      [30, 6],
      [8, 16],
      [30, 16],
    ];
    for (const [px, py] of pillars) {
      for (let dx = 0; dx < 3; dx += 1) {
        for (let dy = 0; dy < 3; dy += 1) {
          this.addWall(px + dx, py + dy);
        }
      }
    }
  }

  private addWall(tileX: number, tileY: number): void {
    const wall = this.walls.create(
      tileX * TILE_PX + TILE_PX / 2,
      tileY * TILE_PX + TILE_PX / 2,
      TEX_KEYS.TILE_WALL,
    ) as Phaser.Physics.Arcade.Sprite;
    wall.setDepth(DEPTH.WALL);
    wall.refreshBody();
  }

  /* ============================ HUD（P2 调试用，正式 HUD 归 P4） ============================ */

  private buildHud(): void {
    this.statusText = this.add
      .text(20, 18, '', { fontFamily: FONT_FAMILY, fontSize: '18px', color: '#c7d0dd' })
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD);
    this.enemyText = this.add
      .text(GAME_WIDTH - 20, 18, '', { fontFamily: FONT_FAMILY, fontSize: '16px', color: '#6f7d95' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD);
    this.add
      .text(
        20,
        GAME_HEIGHT - 34,
        '训练场：F1 史莱姆 ｜ F2 喷吐者 ｜ F3 冲锋兽 ｜ F4 Boss ｜ F5 清场 ｜ R 重开 ｜ Esc 回菜单',
        { fontFamily: FONT_FAMILY, fontSize: '14px', color: '#4a5a74' },
      )
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD);
    this.deadText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '40px',
        color: '#d94f4f',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.OVERLAY)
      .setVisible(false);
  }

  private refreshStatus(): void {
    const player = this.playerServiceRef;
    if (!player) return;
    const hp = player.getHp();
    const weapon = player.getWeapon(player.getActiveSlot());
    // 显示中文名 + 等级 + 卡槽（原来直接打 defId，联调时不好认）
    const def = getWeaponDef(weapon.defId);
    const line =
      `HP ${Math.ceil(hp.hp)}/${hp.maxHp}  ｜  ${player.getActiveSlot() === 'primary' ? '主手' : '副手'}：` +
      `${def.name} Lv.${weapon.level}  ｜  卡槽 ${weapon.cardIds.length}/${def.cardSlots}`;
    if (line !== this.lastStatusLine) {
      this.lastStatusLine = line;
      this.statusText.setText(line);
    }
    const alive = this.enemyServiceRef ? this.enemyServiceRef.aliveCount() : DATA_FALLBACK.NO_BONUS;
    this.enemyText.setText(`场上敌人 ${alive}`);
  }

  /* ============================ 刷怪 ============================ */

  private spawnWave(): void {
    const enemy = this.enemyServiceRef;
    if (!enemy) return;
    const centerX = GAME_WIDTH / 2;
    const centerY = GAME_HEIGHT / 2;
    enemy.spawn('enemy_slime', centerX - 220, centerY - 160);
    enemy.spawn('enemy_slime', centerX + 220, centerY - 160);
    enemy.spawn('enemy_spitter', centerX, centerY - 240);
    enemy.spawn('enemy_charger', centerX + 260, centerY + 140);
  }

  private bindDebugKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.on('keydown-F1', () => this.spawnRandom('enemy_slime'));
    keyboard.on('keydown-F2', () => this.spawnRandom('enemy_spitter'));
    keyboard.on('keydown-F3', () => this.spawnRandom('enemy_charger'));
    keyboard.on('keydown-F4', () => this.spawnBoss());
    keyboard.on('keydown-F5', () => this.enemyServiceRef?.clearAll());
    keyboard.on('keydown-R', () => this.scene.restart());
    keyboard.on('keydown-ESC', () => this.scene.start(SCENE_KEYS.MENU));

    if (this.continuousSpawn) {
      this.time.addEvent({
        delay: 1600,
        loop: true,
        callback: () => this.spawnRandom('enemy_slime'),
      });
    }
  }

  private spawnRandom(defId: string): void {
    if (this.playerDead) return;
    const angle = Math.random() * Math.PI * 2;
    const radius = 240 + Math.random() * 120;
    const x = Phaser.Math.Clamp(GAME_WIDTH / 2 + Math.cos(angle) * radius, TILE_PX * 2, GAME_WIDTH - TILE_PX * 2);
    const y = Phaser.Math.Clamp(GAME_HEIGHT / 2 + Math.sin(angle) * radius, TILE_PX * 2, GAME_HEIGHT - TILE_PX * 2);
    this.enemyServiceRef?.spawn(defId, x, y);
  }

  private spawnBoss(): void {
    this.enemyServiceRef?.spawn('boss_warden', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 180);
  }

  /* ============================ 事件 ============================ */

  private bindEvents(): void {
    bus.on('player:died', this.onPlayerDied, this);
    bus.on('enemy:died', this.onEnemyDied, this);
    bus.on('boss:phase', this.onBossPhase, this);
  }

  private onPlayerDied(): void {
    this.playerDead = true;
    this.deadText.setText('你倒下了 ｜ 按 R 重开').setVisible(true);
  }

  private onEnemyDied(payload: { enemyId: string; exp: number; gold: number; material: number }): void {
    // P4 在正式流程里做这件事：击杀 → 武器经验
    this.playerServiceRef?.giveWeaponExp(payload.exp);
  }

  private onBossPhase(payload: { index: number; announce: string }): void {
    if (!payload.announce) return;
    const text = this.add
      .text(GAME_WIDTH / 2, 140, payload.announce, {
        fontFamily: FONT_FAMILY,
        fontSize: '32px',
        color: '#f2d33b',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.TEXT)
      .setAlpha(0);
    this.tweens.add({
      targets: text,
      alpha: 1,
      duration: 200,
      yoyo: true,
      hold: 900,
      onComplete: () => text.destroy(),
    });
  }

  /* ============================ 清理 ============================ */

  private cleanup(): void {
    bus.offAll(this);
    if (this.time) this.time.removeAllEvents();
    if (this.tweens) this.tweens.killAll();
    clearRunScopedServices(this);
    this.playerServiceRef = null;
    this.enemyServiceRef = null;
    log.p2.info('训练场清理完成');
  }
}
