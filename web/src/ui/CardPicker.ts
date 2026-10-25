/**
 * 三选一卡面：卡面渲染 + 焦点 + 键盘操作。
 * 纯展示 + 回调，不做奖励结算（那是 DropSystem 的事）。
 */

import Phaser from 'phaser';
import type { RewardOffer } from '../core/contracts';
import { DEPTH, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { PALETTE, css } from '../gfx/palette';
import { hexToInt } from '../core/util';
import { rarityColor, UI_COLOR } from './Widgets';

const CARD_WIDTH = 268;
const CARD_HEIGHT = 340;
const CARD_GAP = 26;

const RARITY_LABEL: Record<string, string> = { common: '普通', rare: '稀有', epic: '史诗' };

export class CardPicker {
  private readonly scene: Phaser.Scene;
  private readonly offers: RewardOffer[];
  private readonly cards: Phaser.GameObjects.Container[] = [];
  private readonly borders: Phaser.GameObjects.Rectangle[] = [];
  private readonly onConfirm: (offer: RewardOffer) => void;
  private focusIndex = 0;
  private locked = false;

  constructor(scene: Phaser.Scene, offers: RewardOffer[], onConfirm: (offer: RewardOffer) => void) {
    this.scene = scene;
    this.offers = offers;
    this.onConfirm = onConfirm;

    const count = Math.max(1, offers.length);
    const totalWidth = count * CARD_WIDTH + (count - 1) * CARD_GAP;
    const startX = GAME_WIDTH / 2 - totalWidth / 2 + CARD_WIDTH / 2;
    const y = GAME_HEIGHT / 2 + 10;

    offers.forEach((offer, index) => {
      const x = startX + index * (CARD_WIDTH + CARD_GAP);
      const card = this.buildCard(offer, index, x, y);
      this.cards.push(card.root);
      this.borders.push(card.border);
   // 注意：容器没有 setSize（width/height = 0 → displayOrigin = 0），所以命中区必须用居中矩形。
   // 若以后给 container 调 setSize，这里要同步改成 (0, 0, CARD_WIDTH, CARD_HEIGHT)。
      card.root.setInteractive(
        new Phaser.Geom.Rectangle(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT),
        Phaser.Geom.Rectangle.Contains,
      );
      card.root.on('pointerover', () => this.setFocus(index));
      card.root.on('pointerdown', () => this.confirm());
    });

    this.setFocus(0);
  }

  focusNext(): void {
    this.setFocus((this.focusIndex + 1) % this.cards.length);
  }

  focusPrev(): void {
    this.setFocus((this.focusIndex - 1 + this.cards.length) % this.cards.length);
  }

  focusIndexAt(index: number): void {
    if (index < 0 || index >= this.cards.length) return;
    this.setFocus(index);
  }

  confirm(): void {
    if (this.locked) return;
    const offer = this.offers[this.focusIndex];
    if (!offer) return;
    this.locked = true;
    this.onConfirm(offer);
  }

  destroy(): void {
    for (const card of this.cards) card.destroy();
    this.cards.length = 0;
    this.borders.length = 0;
  }

  private setFocus(index: number): void {
    this.focusIndex = index;
    this.borders.forEach((border, borderIndex) => {
      const active = borderIndex === index;
      const offer = this.offers[borderIndex];
      const color = offer ? rarityColor(offer.rarity) : PALETTE[4];
      border.setStrokeStyle(active ? 4 : 2, hexToInt(color), active ? 1 : 0.6);
      this.cards[borderIndex]?.setScale(active ? 1.03 : 1);
    });
  }

  private buildCard(
    offer: RewardOffer,
    index: number,
    x: number,
    y: number,
  ): { root: Phaser.GameObjects.Container; border: Phaser.GameObjects.Rectangle } {
    const container = this.scene.add.container(x, y).setDepth(DEPTH.OVERLAY + 1);
    const rarity = rarityColor(offer.rarity);
    const border = this.scene.add
      .rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, UI_COLOR.panel, 0.97)
      .setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(rarity).color, 0.8);
    container.add(border);

    const icon = this.scene.add.image(0, -CARD_HEIGHT / 2 + 74, offer.textureKey);
    icon.setDisplaySize(96, 96);
    container.add(icon);

    const title = this.scene.add
      .text(0, -CARD_HEIGHT / 2 + 138, offer.title, {
        fontFamily: FONT_FAMILY,
        fontSize: '24px',
        color: css(6),
      })
      .setOrigin(0.5);
    container.add(title);

    const rarityText = this.scene.add
      .text(0, -CARD_HEIGHT / 2 + 166, RARITY_LABEL[offer.rarity ?? 'common'] ?? '', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        color: rarity,
      })
      .setOrigin(0.5);
    container.add(rarityText);

    const description = this.scene.add
      .text(0, -18, offer.description, {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        color: css(5),
        align: 'center',
        wordWrap: { width: CARD_WIDTH - 44 },
      })
      .setOrigin(0.5);
    container.add(description);

    const footer =
      offer.cost !== undefined ? `${offer.cost} 金币` : offer.kind === 'card' ? '装到武器卡槽' : '立即生效';
    const footerText = this.scene.add
      .text(0, CARD_HEIGHT / 2 - 40, footer, {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        color: offer.cost !== undefined ? css(9) : css(4),
      })
      .setOrigin(0.5);
    container.add(footerText);

    const badge = this.scene.add
      .text(-CARD_WIDTH / 2 + 16, -CARD_HEIGHT / 2 + 16, `${index + 1}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        color: css(0),
      })
      .setOrigin(0.5);
    const badgeBg = this.scene.add.rectangle(-CARD_WIDTH / 2 + 16, -CARD_HEIGHT / 2 + 16, 26, 26, UI_COLOR.accent, 0.9);
    container.add(badgeBg);
    container.add(badge);

    return { root: container, border };
  }
}
