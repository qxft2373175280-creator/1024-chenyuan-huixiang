/**
 * 装备 / 卡牌（R2 主界面入口）
 *
 * 允许改：起始主手武器、开局预装卡牌（受该武器卡槽数限制）。
 * 改动写进存档 `loadout`，下一局开局生效（不改变已经开始的这一局）。
 */
import Phaser from 'phaser';
import type { ISaveService } from '../core/contracts';
import { readLoadout } from '../core/profile-contracts';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { SCENE_KEYS } from '../core/keys';
import { getService } from '../core/services';
import { allCards, allWeapons, getMenuGuide, getPlayerDef, getWeaponDef } from '../data';
import { log } from '../core/logger';
import { PALETTE, css } from '../gfx/palette';
import { addText, addTitle, createBackground, createButton } from '../gfx/UiKit';
import { label } from '../ui/Widgets';

export class LoadoutScene extends Phaser.Scene {
  private save!: ISaveService;
  private infoText!: Phaser.GameObjects.Text;
  private lastInfo = '';

  constructor() {
    super(SCENE_KEYS.LOADOUT);
  }

  create(): void {
    this.save = getService(this, 'save');
    createBackground(this);
    addTitle(this, GAME_WIDTH / 2, 104, '装 备 / 卡 牌', '选择起始主手武器与开局预装卡牌（下一局生效）');

    const data = this.save.get();
    const startWeapons = getPlayerDef().startWeapons ?? [];
    const unlockedWeapons = new Set<string>(startWeapons);
    for (const id of data.forge.unlocked) {
      if (allWeapons().some((weapon) => weapon.id === id)) unlockedWeapons.add(id);
    }
    const unlockedCards = new Set<string>(data.seen?.cards ?? []);
    for (const id of data.forge.unlocked) {
      if (allCards().some((card) => card.id === id)) unlockedCards.add(id);
    }
    const loadout = readLoadout(data, startWeapons);
    const weaponDef = getWeaponDef(loadout.primary);
    const maxCards = weaponDef.cardSlots;

    // 武器列表
    label(this, 120, 188, `主手武器（已解锁 ${unlockedWeapons.size} 把）`, 18, PALETTE[9], 0, 0.5);
    [...unlockedWeapons].forEach((weaponId, index) => {
      const def = getWeaponDef(weaponId);
      const active = weaponId === loadout.primary;
      const x = 260 + (index % 3) * 320;
      const y = 240 + Math.floor(index / 3) * 66;
      const handle = createButton(this, x, y, 290, 52, `${active ? '✔ ' : ''}${def.name}（${def.category === 'melee' ? '近战' : def.category === 'ranged' ? '远程' : '元素'}）`, () => {
        loadout.primary = weaponId;
        loadout.cards = loadout.cards.slice(0, Math.min(loadout.cards.length, def.cardSlots));
        data.loadout = loadout;
        this.save.commit();
        this.scene.restart();
      }, { accent: active ? PALETTE[10] : PALETTE[4], fontSize: 16 });
      handle.container.setDepth(DEPTH.HUD);
    });

    // 卡牌列表（P2-2：未解锁的卡也列出来，明确显示锁定原因，避免玩家困惑）
    const lockedReason = getMenuGuide().loadout?.lockedReason ?? '未解锁：先去锻造台解锁';
    const allCardDefs = allCards();
    label(this, 120, 400, `开局预装卡牌（${loadout.cards.length} / ${maxCards} 张 ｜ 已解锁 ${unlockedCards.size} / ${allCardDefs.length} 张）`, 18, PALETTE[9], 0, 0.5);
    if (unlockedCards.size === 0) {
      addText(this, GAME_WIDTH / 2, 432, lockedReason, {
        fontSize: 15,
        color: PALETTE[8],
        align: 'center',
      })
        .setOrigin(0.5)
        .setDepth(DEPTH.HUD);
    }
    {
      allCardDefs.forEach((card, index) => {
        const unlocked = unlockedCards.has(card.id);
        const active = loadout.cards.includes(card.id);
        const x = 240 + (index % 4) * 250;
        const y = 470 + Math.floor(index / 4) * 62;
        const text = unlocked ? `${active ? '✔ ' : ''}${card.name}` : `🔒 ${card.name}（未解锁）`;
        const handle = createButton(this, x, y, 230, 50, text, () => {
          if (!unlocked) {
            this.flashInfo(`${card.name}：${lockedReason}`);
            return;
          }
          const cardService = getService(this, 'card');
          if (active) {
            loadout.cards = loadout.cards.filter((id) => id !== card.id);
          } else {
            if (loadout.cards.length >= maxCards) {
              this.flashInfo(`卡槽已满（${maxCards} 张）`);
              return;
            }
            // 只借用 canInstall 的「类别适用 + 槽位 + 去重」规则，不真的建武器实例
            const verdict = cardService.canInstall(
              { defId: loadout.primary, cardIds: [...loadout.cards] } as unknown as Parameters<typeof cardService.canInstall>[0],
              card.id,
            );
            if (!verdict.ok) {
              this.flashInfo(verdict.reason ?? '这张卡不适用于当前武器');
              return;
            }
            loadout.cards = [...loadout.cards, card.id];
          }
          data.loadout = loadout;
          this.save.commit();
          this.scene.restart();
        }, { accent: unlocked ? (active ? PALETTE[10] : PALETTE[4]) : PALETTE[2], fontSize: unlocked ? 15 : 13 });
        handle.container.setDepth(DEPTH.HUD);
      });
      addText(this, GAME_WIDTH / 2, 400 + 24 + Math.ceil(allCardDefs.length / 4) * 62 + 6, lockedReason, {
        fontSize: 13,
        color: PALETTE[3],
        align: 'center',
      })
        .setOrigin(0.5)
        .setDepth(DEPTH.HUD);
    }

    this.infoText = addText(this, GAME_WIDTH / 2, GAME_HEIGHT - 148, `当前：${weaponDef.name} ｜ 预装 ${loadout.cards.length} 张卡`, {
      fontSize: 16,
      color: PALETTE[6],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);

    const back = createButton(this, GAME_WIDTH / 2 - 130, GAME_HEIGHT - 70, 230, 52, '返回主界面', () => {
      this.scene.start(SCENE_KEYS.MENU);
    }, { fontSize: 18 });
    back.container.setDepth(DEPTH.HUD);
    const start = createButton(this, GAME_WIDTH / 2 + 130, GAME_HEIGHT - 70, 230, 52, '直接开始一局', () => {
      this.scene.start(SCENE_KEYS.GAME, { fresh: true, replay: false });
    }, { fontSize: 18, accent: PALETTE[12] });
    start.container.setDepth(DEPTH.HUD);

    this.input.keyboard?.on('keydown-ESC', () => this.scene.start(SCENE_KEYS.MENU));
    if (import.meta.env.DEV) {
      (window as unknown as { __loadout?: () => Record<string, unknown> }).__loadout = () => this.debugLoadout();
    }
    log.p4.info('装备界面就绪', { primary: loadout.primary, cards: loadout.cards });
  }

  private flashInfo(text: string): void {
    this.lastInfo = text;
    this.infoText.setText(text).setColor(css(8));
  }

  /** 验收脚本用 */
  debugLoadout(): Record<string, unknown> {
    const data = this.save.get();
    const loadout = readLoadout(data, getPlayerDef().startWeapons ?? []);
    const weapon = getWeaponDef(loadout.primary);
    const unlockedCards = new Set<string>(data.seen?.cards ?? []);
    for (const id of data.forge.unlocked) {
      if (allCards().some((card) => card.id === id)) unlockedCards.add(id);
    }
    return {
      primary: loadout.primary,
      cards: loadout.cards,
      cardSlots: weapon.cardSlots,
      cardCount: loadout.cards.length,
      totalCards: allCards().length,
      unlockedCount: unlockedCards.size,
      lockedCount: allCards().length - unlockedCards.size,
      lockedReason: getMenuGuide().loadout?.lockedReason ?? '',
      lastInfo: this.lastInfo,
    };
  }
}
