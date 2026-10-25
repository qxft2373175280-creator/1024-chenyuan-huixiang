/**
 * 局外锻造台：武器 / 卡牌 / 敌人图鉴 + 蓝图解锁
 * 负责人：P1
 *
 * 实现说明：切换页签 / 购买后统一用 scene.restart({ tab }) 重建，
 * 避免手工追踪并销毁上百个 GameObject（P1 阶段的稳妥做法）。
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../core/constants';
import type { ISaveService } from '../core/contracts';
import { SCENE_KEYS } from '../core/keys';
import { getService } from '../core/services';
import { getUrlParam } from '../core/util';
import { allCards, allEnemies, allUnlocks, allWeapons, formatCardText, getUnlockDef } from '../data';
import { PALETTE, rarityColor, tagColor } from '../gfx/palette';
import { addText, createBackground, createButton, createPanel, showToast } from '../gfx/UiKit';

type Tab = 'weapons' | 'cards' | 'enemies' | 'unlocks';

const TABS: { key: Tab; label: string }[] = [
  { key: 'weapons', label: '武器图鉴' },
  { key: 'cards', label: '卡牌图鉴' },
  { key: 'enemies', label: '敌人图鉴' },
  { key: 'unlocks', label: '蓝图解锁' },
];

const CATEGORY_LABEL: Record<string, string> = {
  melee: '近战',
  ranged: '远程',
  elemental: '元素',
};

const AI_LABEL: Record<string, string> = {
  chaser: '直线追击',
  shooter: '远程喷吐',
  charger: '蓄力冲锋',
  boss: 'Boss：阶段战',
};

export class ForgeScene extends Phaser.Scene {
  private save!: ISaveService;
  private tab: Tab = 'weapons';

  constructor() {
    super(SCENE_KEYS.FORGE);
  }

  init(data: { tab?: Tab }): void {
    if (data?.tab) this.tab = data.tab;
  }

  create(): void {
    this.save = getService(this, 'save');
    // 调试入口：?scene=forge&tab=cards 直接看对应页签
    const urlTab = getUrlParam('tab');
    if (urlTab && TABS.some((item) => item.key === urlTab)) {
      this.tab = urlTab as Tab;
    }
    createBackground(this);

    addText(this, 48, 28, '锻造台', { fontSize: 32, color: PALETTE[6], bold: true });
    addText(this, 48, 70, '图鉴收藏 + 蓝图解锁 · 刷新页面不会丢失', {
      fontSize: 13,
      color: PALETTE[4],
    });
    addText(this, GAME_WIDTH - 330, 38, `材料 ${this.save.get().forge.materials}`, {
      fontSize: 20,
      color: PALETTE[9],
      bold: true,
    });
    createButton(this, GAME_WIDTH - 110, 54, 150, 46, '返 回', () => this.scene.start(SCENE_KEYS.MENU));

    TABS.forEach((item, index) => {
      const active = item.key === this.tab;
      createButton(this, 220 + index * 196, 132, 176, 42, item.label, () => this.switchTab(item.key), {
        accent: active ? PALETTE[9] : PALETTE[12],
        active,
        fontSize: 17,
      });
    });

    if (this.tab === 'weapons') this.renderWeapons();
    else if (this.tab === 'cards') this.renderCards();
    else if (this.tab === 'enemies') this.renderEnemies();
    else this.renderUnlocks();

    this.input.keyboard?.on('keydown-ESC', () => this.scene.start(SCENE_KEYS.MENU));
    this.input.keyboard?.on('keydown-TAB', () => {
      const index = TABS.findIndex((item) => item.key === this.tab);
      this.switchTab(TABS[(index + 1) % TABS.length].key);
    });
  }

  private switchTab(tab: Tab): void {
    if (this.tab === tab) return;
    this.scene.restart({ tab });
  }

  /* ---------------- 武器图鉴 ---------------- */

  private renderWeapons(): void {
    const weapons = allWeapons();
    const cellWidth = 380;
    const cellHeight = 232;
    const startX = 30;
    const startY = 182;

    weapons.forEach((weapon, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = startX + column * (cellWidth + 40);
      const y = startY + row * (cellHeight + 20);
      const isEvolution = !weapon.evolvesTo;
      const hidden = isEvolution && !this.save.hasSeen('weapon', weapon.id);

      createPanel(this, x, y, cellWidth, cellHeight, { border: hidden ? PALETTE[2] : PALETTE[3] });
      const icon = this.add.image(x + 52, y + 66, weapon.textureKey).setScale(2);
      if (hidden) icon.setTint(PALETTE[1]);

      addText(this, x + 96, y + 26, hidden ? '？？？' : weapon.name, {
        fontSize: 24,
        color: hidden ? PALETTE[4] : PALETTE[6],
        bold: true,
      });
      addText(this, x + 96, y + 60, `${CATEGORY_LABEL[weapon.category] ?? weapon.category}　卡槽 ${weapon.cardSlots}`, {
        fontSize: 13,
        color: PALETTE[4],
      });

      if (hidden) {
        addText(this, x + 24, y + 120, '进化形态：装备并升满对应武器后解锁', {
          fontSize: 13,
          color: PALETTE[2],
          wordWrap: cellWidth - 48,
        });
        return;
      }

      addText(
        this,
        x + 24,
        y + 104,
        `伤害 ${weapon.baseDamage}　攻速 ${weapon.attackSpeed.toFixed(1)}/s　范围 ${weapon.range} 格`,
        { fontSize: 13, color: PALETTE[5] },
      );
      addText(this, x + 24, y + 126, `连击 ${weapon.comboHits}　暴击 ${Math.round(weapon.critChance * 100)}%`, {
        fontSize: 13,
        color: PALETTE[5],
      });
      addText(this, x + 24, y + 152, weapon.description, {
        fontSize: 12,
        color: PALETTE[4],
        wordWrap: cellWidth - 48,
      });
      if (weapon.evolvesTo) {
        const target = allWeapons().find((item) => item.id === weapon.evolvesTo);
        addText(this, x + 24, y + 196, `进化 → ${target?.name ?? weapon.evolvesTo}（需 Lv3 + 经验）`, {
          fontSize: 12,
          color: PALETTE[13],
        });
      } else {
        addText(this, x + 24, y + 196, '进化形态', { fontSize: 12, color: PALETTE[13] });
      }
    });
  }

  /* ---------------- 卡牌图鉴 ---------------- */

  private renderCards(): void {
    const cards = allCards();
    const cellWidth = 228;
    const cellHeight = 262;
    const startX = 42;
    const startY = 178;

    cards.forEach((card, index) => {
      const column = index % 5;
      const row = Math.floor(index / 5);
      const x = startX + column * (cellWidth + 14);
      const y = startY + row * (cellHeight + 14);
      const lockedByBlueprint = card.unlock !== undefined && !this.save.isUnlocked(card.unlock);
      const seen = this.save.hasSeen('card', card.id);

      createPanel(this, x, y, cellWidth, cellHeight, {
        border: lockedByBlueprint ? PALETTE[2] : rarityColor(card.rarity),
      });
      const icon = this.add.image(x + cellWidth / 2, y + 56, card.textureKey).setScale(1);
      if (lockedByBlueprint || !seen) icon.setTint(PALETTE[2]);

      addText(this, x + 14, y + 100, card.name, {
        fontSize: 18,
        color: lockedByBlueprint ? PALETTE[2] : PALETTE[6],
        bold: true,
      });
      addText(this, x + 14, y + 126, card.tags.map((tag) => `#${tag}`).join(' '), {
        fontSize: 11,
        color: tagColor(card.tags),
      });
      addText(this, x + 14, y + 148, formatCardText(card), {
        fontSize: 12,
        color: lockedByBlueprint ? PALETTE[2] : PALETTE[5],
        wordWrap: cellWidth - 28,
      });

      if (lockedByBlueprint) {
        this.add.image(x + cellWidth - 30, y + 28, 'ui_lock').setTint(PALETTE[4]);
        addText(this, x + 14, y + cellHeight - 28, '需蓝图解锁', { fontSize: 11, color: PALETTE[7] });
      } else {
        const rarityLabel = card.rarity === 'epic' ? '史诗' : card.rarity === 'rare' ? '稀有' : '普通';
        addText(this, x + cellWidth - 62, y + cellHeight - 28, rarityLabel, {
          fontSize: 11,
          color: rarityColor(card.rarity),
        });
      }
    });

    addText(
      this,
      42,
      742,
      '流派：毒爆（毒刃/疫爆）· 弹幕（分裂弹/弹幕狂欢/连锁闪电）· 暴击处决（弱点瞄准/处决）· 近战旋风（旋风斩/长刃）',
      { fontSize: 12, color: PALETTE[3] },
    );
  }

  /* ---------------- 敌人图鉴 ---------------- */

  private renderEnemies(): void {
    const enemies = allEnemies();
    const cellWidth = 228;
    const cellHeight = 300;
    const startX = 42;
    const startY = 186;

    enemies.forEach((enemy, index) => {
      const x = startX + index * (cellWidth + 14);
      const y = startY;
      const seen = this.save.hasSeen('enemy', enemy.id);

      createPanel(this, x, y, cellWidth, cellHeight, {
        border: enemy.isBoss ? PALETTE[13] : enemy.elite ? PALETTE[8] : PALETTE[3],
      });
      const icon = this.add.image(x + cellWidth / 2, y + 74, enemy.textureKey);
      icon.setDisplaySize(96, 96);
      if (!seen) icon.setTint(PALETTE[2]);

      addText(this, x + 14, y + 128, enemy.name, {
        fontSize: 19,
        color: seen ? PALETTE[6] : PALETTE[3],
        bold: true,
      });
      addText(this, x + 14, y + 156, AI_LABEL[enemy.ai] ?? enemy.ai, { fontSize: 12, color: PALETTE[11] });
      addText(this, x + 14, y + 180, `生命 ${enemy.maxHp}　速度 ${enemy.speed}`, {
        fontSize: 12,
        color: PALETTE[5],
      });
      addText(this, x + 14, y + 202, `接触伤害 ${enemy.contactDamage}　经验 ${enemy.exp}`, {
        fontSize: 12,
        color: PALETTE[5],
      });
      addText(this, x + 14, y + 224, `金币 ${enemy.gold}　材料率 ${Math.round(enemy.materialChance * 100)}%`, {
        fontSize: 12,
        color: PALETTE[5],
      });
      if (enemy.isBoss) {
        addText(this, x + 14, y + 254, 'Boss · 半血进入二阶段', { fontSize: 12, color: PALETTE[13] });
      } else if (enemy.elite) {
        addText(this, x + 14, y + 254, '精英怪', { fontSize: 12, color: PALETTE[8] });
      } else {
        addText(this, x + 14, y + 254, seen ? '已遭遇' : '尚未遭遇', {
          fontSize: 12,
          color: PALETTE[3],
        });
      }
    });
  }

  /* ---------------- 蓝图解锁 ---------------- */

  private renderUnlocks(): void {
    const unlocks = allUnlocks();
    const startX = 80;
    const startY = 180;
    const rowWidth = 1120;
    const rowHeight = 74;

    unlocks.forEach((unlock, index) => {
      const y = startY + index * (rowHeight + 10);
      const owned = this.save.isUnlocked(unlock.id);
      const missingRequirement = unlock.requires.some((requirement) => !this.save.isUnlocked(requirement));

      createPanel(this, startX, y, rowWidth, rowHeight, {
        border: owned ? PALETTE[10] : missingRequirement ? PALETTE[2] : PALETTE[3],
      });
      addText(this, startX + 24, y + 12, unlock.name, {
        fontSize: 20,
        color: owned ? PALETTE[10] : PALETTE[6],
        bold: true,
      });
      addText(this, startX + 24, y + 42, unlock.description, {
        fontSize: 13,
        color: PALETTE[4],
        wordWrap: 620,
      });
      addText(this, startX + rowWidth - 340, y + 26, `花费 ${unlock.cost} 材料`, {
        fontSize: 15,
        color: missingRequirement ? PALETTE[2] : PALETTE[9],
      });

      if (owned) {
        addText(this, startX + rowWidth - 150, y + 26, '已解锁', {
          fontSize: 18,
          color: PALETTE[10],
          bold: true,
        });
      } else if (missingRequirement) {
        addText(this, startX + rowWidth - 180, y + 26, '需前置', { fontSize: 16, color: PALETTE[2] });
      } else {
        createButton(this, startX + rowWidth - 110, y + 37, 160, 46, '购 买', () => this.tryUnlock(unlock.id), {
          accent: PALETTE[9],
          fontSize: 18,
        });
      }
    });
  }

  private tryUnlock(id: string): void {
    const unlock = getUnlockDef(id);
    if (this.save.isUnlocked(id)) {
      showToast(this, '已经解锁过了', PALETTE[4]);
      return;
    }
    if (unlock.requires.some((requirement) => !this.save.isUnlocked(requirement))) {
      showToast(this, '需要先解锁前置蓝图', PALETTE[7]);
      return;
    }
    if (this.save.get().forge.materials < unlock.cost) {
      showToast(this, `材料不足：需要 ${unlock.cost}，当前 ${this.save.get().forge.materials}`, PALETTE[7]);
      return;
    }
    if (this.save.unlock(id)) {
      showToast(this, `已解锁：${unlock.name}`, PALETTE[10]);
      this.scene.restart({ tab: this.tab });
    }
  }
}
