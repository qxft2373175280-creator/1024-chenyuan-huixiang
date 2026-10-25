/**
 * HUD（P4-S3）：血条 / 双武器槽 / 卡槽 / 金币材料 / 房间进度 / 冲刺冷却 / Boss 血条 / 波次 / toast / 房间名。
 *
 * 硬性要求（§8.3.4）：全部 `setScrollFactor(0)` + `DEPTH.HUD`；**只订阅事件，不轮询服务**；
 * 文本只在值变化时 setText。
 */

import Phaser from 'phaser';
import type { EventHandler } from '../core/events';
import type { RewardOffer } from '../core/contracts';
import { bus } from '../core/events';
import { tryGetService } from '../core/services';
import { DEPTH, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { TEX_KEYS, TEX_PREFIX } from '../core/keys';
import { getCardDef, getEnemyDef, getLevelScaling, getPlayerDef, getWeaponDef } from '../data';
import { PALETTE, css } from '../gfx/palette';
import { hexToInt } from '../core/util';
import { rarityColor, UI_COLOR } from './Widgets';

const HP_BAR_WIDTH = 236;
const EXP_BAR_WIDTH = 150;
const BOSS_BAR_WIDTH = Math.floor(GAME_WIDTH * 0.6);

const ROOM_TYPE_LABEL: Record<string, string> = {
  combat: '战斗房',
  elite: '精英房',
  treasure: '宝箱房',
  shop: '商店',
  boss: 'BOSS',
};

/** 初始武器图标：取 player.json 的起始主手，不在 HUD 里写死贴图 key */
function defaultWeaponTexture(): string {
  const startWeapon = getPlayerDef().startWeapons[0];
  return startWeapon ? `${TEX_PREFIX.WEAPON}${startWeapon}` : TEX_KEYS.UI_PANEL;
}

interface WeaponSlotView {
  name: Phaser.GameObjects.Text;
  level: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
  expFill: Phaser.GameObjects.Rectangle;
  highlight: Phaser.GameObjects.Rectangle;
  cardIcons: Phaser.GameObjects.Rectangle[];
  expNext: number;
}

export class HUD {
  private readonly scene: Phaser.Scene;
  private readonly hpFill: Phaser.GameObjects.Rectangle;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly slots: Record<'primary' | 'secondary', WeaponSlotView>;
  private readonly runText: Phaser.GameObjects.Text;
  private readonly waveText: Phaser.GameObjects.Text;
  private readonly roomText: Phaser.GameObjects.Text;
  private readonly toastText: Phaser.GameObjects.Text;
  private readonly promptText: Phaser.GameObjects.Text;
  private readonly dashFill: Phaser.GameObjects.Rectangle;
  private readonly bossGroup: Phaser.GameObjects.GameObject[];
  private readonly bossFill: Phaser.GameObjects.Rectangle;
  private readonly bossName: Phaser.GameObjects.Text;
  private lastHpText = '';
  private lastRunText = '';
  private toastTween: Phaser.Tweens.Tween | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const add = scene.add;
    const stick = <T extends Phaser.GameObjects.GameObject & { setScrollFactor(x: number): T; setDepth(d: number): T }>(
      object: T,
      depth: number,
    ): T => object.setScrollFactor(0).setDepth(depth);

    // 血条
    stick(add.rectangle(24, 20, 240, 20, UI_COLOR.panelDeep, 0.78).setOrigin(0, 0), DEPTH.HUD);
    this.hpFill = stick(add.rectangle(26, 22, HP_BAR_WIDTH, 16, 0x5fd97b, 0.95).setOrigin(0, 0), DEPTH.HUD + 1);
    this.hpText = stick(
      add.text(34, 30, '', { fontFamily: FONT_FAMILY, fontSize: '13px', color: css(0) }).setOrigin(0, 0.5),
      DEPTH.HUD + 2,
    );

    // 双武器槽
    this.slots = {
      primary: this.buildSlot(54),
      secondary: this.buildSlot(92),
    };
    this.slots.primary.highlight.setVisible(true);

    // 右上：金币 / 材料 / 房间
    this.runText = stick(
      add.text(GAME_WIDTH - 24, 20, '', { fontFamily: FONT_FAMILY, fontSize: '16px', color: css(5) }).setOrigin(1, 0),
      DEPTH.HUD,
    );

    // 波次提示
    this.waveText = stick(
      add.text(GAME_WIDTH / 2, 108, '', { fontFamily: FONT_FAMILY, fontSize: '15px', color: css(4) }).setOrigin(0.5),
      DEPTH.HUD,
    );

    // 房间名（大字，进出淡入淡出）
    this.roomText = stick(
      add
        .text(GAME_WIDTH / 2, 300, '', { fontFamily: FONT_FAMILY, fontSize: '42px', color: css(6) })
        .setOrigin(0.5)
        .setAlpha(0),
      DEPTH.TEXT,
    );

    // Toast
    this.toastText = stick(
      add.text(GAME_WIDTH / 2, GAME_HEIGHT - 168, '', { fontFamily: FONT_FAMILY, fontSize: '18px', color: css(9) })
        .setOrigin(0.5)
        .setAlpha(0),
      DEPTH.TEXT,
    );

    // 交互提示
    this.promptText = stick(
      add
        .text(GAME_WIDTH / 2, GAME_HEIGHT - 96, '', { fontFamily: FONT_FAMILY, fontSize: '16px', color: css(6) })
        .setOrigin(0.5)
        .setAlpha(0),
      DEPTH.HUD,
    );

    // 冲刺冷却（右下）
    stick(add.rectangle(GAME_WIDTH - 124, GAME_HEIGHT - 30, 100, 10, UI_COLOR.panelDeep, 0.8).setOrigin(0, 0), DEPTH.HUD);
    this.dashFill = stick(add.rectangle(GAME_WIDTH - 122, GAME_HEIGHT - 28, 96, 6, 0x3bd6c6, 0.95).setOrigin(0, 0), DEPTH.HUD + 1);
    stick(
      add.text(GAME_WIDTH - 134, GAME_HEIGHT - 25, '冲刺', { fontFamily: FONT_FAMILY, fontSize: '12px', color: css(4) }).setOrigin(1, 0.5),
      DEPTH.HUD + 1,
    );

    // Boss 血条
    const bossBg = stick(
      add.rectangle(GAME_WIDTH / 2, 34, BOSS_BAR_WIDTH + 4, 18, UI_COLOR.panelDeep, 0.85).setOrigin(0.5),
      DEPTH.HUD,
    );
    this.bossFill = stick(add.rectangle(GAME_WIDTH / 2 - BOSS_BAR_WIDTH / 2, 34, BOSS_BAR_WIDTH, 12, 0xd94f4f, 0.95).setOrigin(0, 0.5), DEPTH.HUD + 1);
    this.bossName = stick(
      add
        .text(GAME_WIDTH / 2, 14, getEnemyDef('boss_warden').name, {
          fontFamily: FONT_FAMILY,
          fontSize: '15px',
          color: css(7),
        })
        .setOrigin(0.5),
      DEPTH.HUD + 1,
    );
    this.bossGroup = [bossBg, this.bossFill, this.bossName];
    this.setBossVisible(false);

    // 事件订阅（全部成对在 destroy 里清理）
    bus.on('player:stats', this.onPlayerStats, this);
    bus.on('player:dash', this.onDash, this);
    bus.on('weapon:state', this.onWeaponState, this);
    bus.on('weapon:changed', this.onWeaponChanged, this);
    bus.on('weapon:evolved', this.onWeaponEvolved, this);
    bus.on('weapon:level', this.onWeaponLevel, this);
    bus.on('run:stats', this.onRunStats, this);
    bus.on('room:wave', this.onWave, this);
    bus.on('room:entered', this.onRoomEntered, this);
    bus.on('boss:hp', this.onBossHp, this);
    bus.on('boss:phase', this.onBossPhase, this);
    bus.on('ui:toast', this.onToast, this);
    bus.on('reward:offers', this.onRewardOffers, this);
  }

  /* ============================ 对外 ============================ */

  showPrompt(text: string | null): void {
    if (text) {
      this.promptText.setText(text).setAlpha(1);
    } else {
      this.promptText.setAlpha(0);
    }
  }

  hideBossBar(): void {
    this.setBossVisible(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    bus.offAll(this);
    if (this.toastTween) this.toastTween.stop();
  }

  /* ============================ 事件 ============================ */

  private readonly onPlayerStats: EventHandler<'player:stats'> = (payload) => {
    const ratio = payload.maxHp > 0 ? Math.max(0, payload.hp / payload.maxHp) : 0;
    this.hpFill.scaleX = ratio;
    this.hpFill.setFillStyle(ratio > 0.5 ? 0x5fd97b : ratio > 0.25 ? 0xf2d33b : 0xd94f4f, 0.95);
    const text = `${Math.ceil(payload.hp)} / ${payload.maxHp}`;
    if (text !== this.lastHpText) {
      this.lastHpText = text;
      this.hpText.setText(text);
    }
  };

  private readonly onDash: EventHandler<'player:dash'> = (payload) => {
    this.dashFill.scaleX = Phaser.Math.Clamp(1 - payload.cooldownRatio, 0, 1);
  };

  private readonly onWeaponState: EventHandler<'weapon:state'> = (payload) => {
    this.applyWeaponState(payload);
  };

  /**
   * 首次装备时 P3 的 create() 还不发 weapon:state（那时实例没挂到槽位），
   * 这里在 weapon:changed 之后主动从服务补一次，避免武器槽一直显示「—」（BUG-008）。
   */
  private readonly onWeaponChanged: EventHandler<'weapon:changed'> = (payload) => {
    this.slots.primary.highlight.setVisible(payload.slot === 'primary');
    this.slots.secondary.highlight.setVisible(payload.slot === 'secondary');
    const player = tryGetService(this.scene, 'player');
    if (!player) return;
    let inst;
    try {
      inst = player.getWeapon(payload.slot);
    } catch {
      return;
    }
    if (!inst) return;
    const upgrade = tryGetService(this.scene, 'upgrade');
    this.applyWeaponState({
      slot: payload.slot,
      defId: inst.defId,
      level: inst.level,
      exp: inst.exp,
      next: upgrade ? upgrade.expToNext(inst) : 0,
      canEvolve: upgrade ? upgrade.canEvolve(inst) : false,
      cardIds: [...inst.cardIds],
    });
  };

  private applyWeaponState(payload: {
    slot: 'primary' | 'secondary';
    defId: string;
    level: number;
    exp: number;
    next: number;
    canEvolve: boolean;
    cardIds: string[];
  }): void {
    const slot = this.slots[payload.slot];
    if (!slot) return;
    let name = payload.defId;
    let textureKey = defaultWeaponTexture();
    try {
      const def = getWeaponDef(payload.defId);
      name = def.name;
      textureKey = def.textureKey;
    } catch {
      /* 用 id 兜底 */
    }
    slot.name.setText(name);
    slot.icon.setTexture(textureKey);
    // COMBAT-01：等级 + 经验数值（原来只有一根进度条，看不出还差多少）
    const star = payload.canEvolve ? ' ★' : '';
    const expText = payload.next > 0 ? `${payload.exp}/${payload.next}` : 'MAX';
    slot.level.setText(`Lv.${payload.level}${star} · ${expText}`);
    slot.expNext = payload.next;
    const ratio = payload.next > 0 ? Phaser.Math.Clamp(payload.exp / payload.next, 0, 1) : 0;
    slot.expFill.scaleX = ratio;
    this.renderCardIcons(slot, payload.cardIds);
  }

  /**
   * COMBAT-01：升级反馈。
   * 效果百分比由 weapons.json/levelScaling 的相邻两级比出来，不在代码里写死数值。
   */
  private readonly onWeaponLevel: EventHandler<'weapon:level'> = (payload) => {
    const slot = this.slots[payload.slot];
    const scaling = getLevelScaling();
    const prevDamage = scaling.damageMul[payload.level - 2] ?? payload.damageMul;
    const prevSpeed = scaling.attackSpeedMul[payload.level - 2] ?? payload.attackSpeedMul;
    const damagePct = Math.round((payload.damageMul / prevDamage - 1) * 100);
    const speedPct = Math.round((payload.attackSpeedMul / prevSpeed - 1) * 100);
    let name = payload.defId;
    try {
      name = getWeaponDef(payload.defId).name;
    } catch {
      /* 用 id 兜底 */
    }
    const effects = [`伤害 +${damagePct}%`];
    if (speedPct > 0) effects.push(`攻速 +${speedPct}%`);
    this.toast(`${name} 升到 Lv.${payload.level} ｜ ${effects.join(' ｜ ')}`, PALETTE[9]);
    if (!slot) return;
    this.scene.tweens.killTweensOf(slot.highlight);
    slot.highlight.setVisible(true).setAlpha(0.55);
    this.scene.tweens.add({
      targets: slot.highlight,
      alpha: payload.slot === 'primary' ? 0.14 : 0,
      duration: 420,
      ease: 'Quad.easeOut',
    });
  };

  private readonly onWeaponEvolved: EventHandler<'weapon:evolved'> = (payload) => {
    let name = payload.to;
    try {
      name = getWeaponDef(payload.to).name;
    } catch {
      /* 兜底 */
    }
    this.toast(`进化 · ${name}`, PALETTE[9]);
    const slot = this.slots[payload.slot];
    slot.name.setText(name);
  };

  private readonly onRunStats: EventHandler<'run:stats'> = (payload) => {
    const room = Math.min(payload.roomIndex + 1, payload.totalRooms);
    const text = `金币 ${payload.gold} ｜ 材料 ${payload.materials} ｜ 房间 ${room}/${payload.totalRooms}`;
    if (text === this.lastRunText) return;
    this.lastRunText = text;
    this.runText.setText(text);
  };

  private readonly onWave: EventHandler<'room:wave'> = (payload) => {
    if (payload.total <= 1) {
      this.waveText.setText('');
      return;
    }
    this.waveText.setText(`第 ${payload.current} / ${payload.total} 波`);
  };

  private readonly onRoomEntered: EventHandler<'room:entered'> = (payload) => {
    const typeLabel = ROOM_TYPE_LABEL[payload.type] ?? payload.type;
    this.roomText.setText(`${typeLabel} · 第 ${payload.index + 1} 房`).setAlpha(0).setScale(0.9);
    this.scene.tweens.add({ targets: this.roomText, alpha: 1, scale: 1, duration: 220, yoyo: true, hold: 900 });
    this.waveText.setText('');
    if (payload.type !== 'boss') this.setBossVisible(false);
  };

  private readonly onBossHp: EventHandler<'boss:hp'> = (payload) => {
    this.setBossVisible(true);
    const ratio = payload.maxHp > 0 ? Math.max(0, payload.hp / payload.maxHp) : 0;
    this.bossFill.scaleX = ratio;
  };

  private readonly onBossPhase: EventHandler<'boss:phase'> = (payload) => {
    if (payload.announce) this.toast(payload.announce, PALETTE[9]);
  };

  private readonly onToast: EventHandler<'ui:toast'> = (payload) => {
    this.toast(payload.text, payload.color ?? PALETTE[9]);
  };

  private readonly onRewardOffers: EventHandler<'reward:offers'> = () => {
    // 预留：奖励来源提示；当前由 RewardScene 自己画
  };

  /* ============================ 内部 ============================ */

  private buildSlot(y: number): WeaponSlotView {
    const add = this.scene.add;
    const highlight = add
      .rectangle(24, y - 2, 320, 34, UI_COLOR.info, 0.14)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD)
      .setVisible(false);
    const icon = add
      .image(40, y + 16, defaultWeaponTexture())
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD + 1)
      .setDisplaySize(22, 22);
    const name = add
      .text(58, y + 4, '—', { fontFamily: FONT_FAMILY, fontSize: '15px', color: css(5) })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD + 1);
    const level = add
      .text(250, y + 4, 'Lv.1', { fontFamily: FONT_FAMILY, fontSize: '13px', color: css(9) })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD + 1);
    add.rectangle(58, y + 24, EXP_BAR_WIDTH, 5, UI_COLOR.panelDeep, 0.8).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.HUD);
    const expFill = add
      .rectangle(58, y + 24, EXP_BAR_WIDTH, 5, 0x3f7ff2, 0.95)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD + 1);
    expFill.scaleX = 0;

    const cardIcons: Phaser.GameObjects.Rectangle[] = [];
    for (let index = 0; index < 4; index += 1) {
      const cardIcon = add
        .rectangle(196 + index * 16, y + 22, 12, 12, UI_COLOR.border, 0.9)
        .setScrollFactor(0)
        .setDepth(DEPTH.HUD + 1)
        .setVisible(false);
      cardIcons.push(cardIcon);
    }

    return { name, level, icon, expFill, highlight, cardIcons, expNext: 0 };
  }

  private renderCardIcons(slot: WeaponSlotView, cardIds: string[]): void {
    slot.cardIcons.forEach((icon, index) => {
      const cardId = cardIds[index];
      if (!cardId) {
        icon.setVisible(false);
        return;
      }
      let color = css(4);
      try {
        color = rarityColor(getCardDef(cardId).rarity);
      } catch {
        /* 兜底 */
      }
      icon.setVisible(true).setFillStyle(hexToInt(color), 0.95);
    });
  }

  private setBossVisible(visible: boolean): void {
    for (const object of this.bossGroup) {
      (object as unknown as Phaser.GameObjects.Components.Visible).setVisible(visible);
    }
  }

  private toast(text: string, color: number | string): void {
    this.toastText.setText(text).setColor(typeof color === 'number' ? css(color) : color).setAlpha(1);
    if (this.toastTween) this.toastTween.stop();
    this.toastTween = this.scene.tweens.add({
      targets: this.toastText,
      alpha: 0,
      delay: 1400,
      duration: 500,
    });
  }
}

/** 供结算页展示奖励文案（RewardScene 也用它） */
export function describeOffer(offer: RewardOffer): string {
  return offer.cost !== undefined ? `${offer.description}（${offer.cost} 金币）` : offer.description;
}

/** 玩家拾取半径（开箱/商店交互距离）：来自 player.json，不写死 */
export function interactRadius(): number {
  return getPlayerDef().pickupRadius;
}
