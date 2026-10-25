/**
 * 命中反馈（P2）：飘字、命中火花、斩击、死亡碎裂、闪白、震屏、顿帧。
 *
 * 全部走对象池：飘字 24、火花 24、碎片 40（《设计文档》§2.7 性能预算）。
 */

import Phaser from 'phaser';
import type { Vec2 } from '../core/contracts';
import type { ElementType } from '../core/contracts';
import {
  DAMAGE_TEXT_LIFE_MS,
  DEATH_BURST_PARTICLES,
  DEPTH,
  FONT_FAMILY,
  HITSTOP_MAX_MS,
  HITSTOP_PHYSICS_SCALE,
  HIT_FLASH_MS,
  MELEE_ARC_FADE_MS,
  MELEE_ARC_FILL_ALPHA,
  MELEE_ARC_HOLD_MS,
  MELEE_ARC_STROKE_ALPHA,
  POOL_SIZE,
  SHAKE_MAX_MS,
  DATA_FALLBACK,
} from '../core/constants';
import { TEX_KEYS } from '../core/keys';
import { rand } from '../core/rng';
import { clamp, degToRad, hexToInt, TAU } from '../core/util';
import { css, ELEMENT_COLOR_INDEX, PALETTE } from '../gfx/palette';
import { ObjectPool } from '../systems/Pool';

const TEXT_COLOR: Record<ElementType, string> = {
  physical: css(5),
  fire: css(8),
  poison: css(10),
  lightning: css(9),
  ice: css(11),
};

export class FxSystem {
  private readonly scene: Phaser.Scene;
  private readonly textPool: ObjectPool<Phaser.GameObjects.Text>;
  private readonly sparkPool: ObjectPool<Phaser.GameObjects.Image>;
  private readonly particlePool: ObjectPool<Phaser.GameObjects.Image>;
 /** 近战扇形轨迹()：用 Graphics 现画，半径/角度与命中判定共用同一组参数 */
  private readonly arcPool: Phaser.GameObjects.Graphics[] = [];
  private arcCursor = 0;
  private hitStopToken = 0;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.textPool = new ObjectPool<Phaser.GameObjects.Text>(
      () =>
        scene.add
        .text(0, 0, '', { fontFamily: FONT_FAMILY, fontSize: '16px', color: css(5) })
          .setOrigin(0.5, 1)
          .setDepth(DEPTH.DAMAGE_TEXT)
          .setActive(false)
          .setVisible(false),
      (item) => item.setActive(false).setVisible(false),
      POOL_SIZE.DAMAGE_TEXT,
    );

    this.sparkPool = new ObjectPool<Phaser.GameObjects.Image>(
      () =>
        scene.add
          .image(0, 0, TEX_KEYS.FX_HIT)
          .setDepth(DEPTH.VFX)
          .setActive(false)
          .setVisible(false),
      (item) => item.setActive(false).setVisible(false),
      POOL_SIZE.HIT_FX,
    );

    this.particlePool = new ObjectPool<Phaser.GameObjects.Image>(
      () =>
        scene.add
          .image(0, 0, TEX_KEYS.PIXEL)
          .setDepth(DEPTH.VFX)
          .setActive(false)
          .setVisible(false),
      (item) => item.setActive(false).setVisible(false).setScale(1),
      POOL_SIZE.HIT_FX,
    );

    for (let index = 0; index < POOL_SIZE.MELEE_ARC; index += 1) {
      this.arcPool.push(
        scene.add
          .graphics()
          .setDepth(DEPTH.VFX + 1)
          .setActive(false)
          .setVisible(false),
      );
    }
  }

 /** 伤害飘字：暴击更大更黄（《设计文档》§6.3.1 步骤 11） */
  damageNumber(at: Vec2, amount: number, crit: boolean, element: ElementType): void {
    const text = this.textPool.acquire();
    if (!text) return;
    this.scene.tweens.killTweensOf(text);
    text
      .setPosition(at.x, at.y - 8)
      .setActive(true)
      .setVisible(true)
      .setAlpha(1)
      .setScale(1)
      .setFontSize(crit ? 24 : 15)
      .setColor(crit ? css(9) : TEXT_COLOR[element])
      .setText(crit ? `${Math.round(amount)}!` : `${Math.round(amount)}`);
    text.setDepth(DEPTH.DAMAGE_TEXT);
    this.scene.tweens.add({
      targets: text,
      y: at.y - 46,
      alpha: 0,
      duration: DAMAGE_TEXT_LIFE_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => this.textPool.release(text),
    });
  }

 /** 命中火花 */
  hitSpark(at: Vec2, crit: boolean): void {
    const spark = this.sparkPool.acquire();
    if (!spark) return;
    this.scene.tweens.killTweensOf(spark);
    spark
      .setTexture(TEX_KEYS.FX_HIT)
      .setPosition(at.x, at.y)
      .setActive(true)
      .setVisible(true)
      .setAlpha(0.95)
      .setScale(crit ? 0.9 : 0.55)
      .setRotation(rand() * TAU)
      .clearTint();
    this.scene.tweens.add({
      targets: spark,
      alpha: 0,
      scale: crit ? 1.4 : 0.9,
      duration: 140,
      ease: 'Quad.easeOut',
      onComplete: () => this.sparkPool.release(spark),
    });
  }

 /**
  * 近战扇形轨迹()。
  *
  * 关键约束：`at / aimRad / rangePx / arcDeg` 必须与 CombatSystem.meleeArc 的判定参数完全一致，
  * 因此这个函数只负责「按判定参数画出来」，不自己做任何角度/距离换算。
  * 角度按 Phaser 约定：0 朝右，rotation 直接等于 aimRad。
  */
  meleeArcTrail(at: Vec2, aimRad: number, rangePx: number, arcDeg: number, tint: number): void {
    if (this.destroyed || this.arcPool.length === 0) return;
    const graphic = this.arcPool[this.arcCursor % this.arcPool.length];
    this.arcCursor += 1;
    if (!graphic) return;
    this.scene.tweens.killTweensOf(graphic);

    const halfRad = degToRad(arcDeg) / 2;
    const fullCircle = arcDeg >= 359;
    graphic
      .clear()
      .setPosition(at.x, at.y)
      .setRotation(aimRad)
      .setActive(true)
      .setVisible(true)
      .setAlpha(1);

    if (fullCircle) {
      graphic.fillStyle(tint, MELEE_ARC_FILL_ALPHA).fillCircle(0, 0, rangePx);
      graphic.lineStyle(2, tint, MELEE_ARC_STROKE_ALPHA).strokeCircle(0, 0, rangePx);
    } else {
      graphic.fillStyle(tint, MELEE_ARC_FILL_ALPHA);
      graphic.beginPath();
      graphic.slice(0, 0, rangePx, -halfRad, halfRad, false);
      graphic.fillPath();
      graphic.lineStyle(2, tint, MELEE_ARC_STROKE_ALPHA);
      graphic.beginPath();
      graphic.arc(0, 0, rangePx, -halfRad, halfRad, false);
      graphic.strokePath();
    }

    this.scene.tweens.add({
      targets: graphic,
      alpha: 0,
      delay: MELEE_ARC_HOLD_MS,
      duration: MELEE_ARC_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        graphic.setActive(false).setVisible(false);
      },
    });
  }

 /** 当前存活的伤害飘字数量（测试脚本用它判断「未命中不显示数字」） */
  activeDamageTexts(): number {
    return this.textPool.activeCount();
  }

 /** 当前正在显示的近战扇形数量 */
  activeMeleeArcs(): number {
    let count = 0;
    for (const graphic of this.arcPool) {
      if (graphic.active) count += 1;
    }
    return count;
  }

 /** 中毒跳字用的小绿泡 */
  poisonTick(at: Vec2, tint: number): void {
    const particle = this.particlePool.acquire();
    if (!particle) return;
    this.scene.tweens.killTweensOf(particle);
    particle
      .setPosition(at.x + (rand() - 0.5) * 10, at.y + (rand() - 0.5) * 10)
      .setActive(true)
      .setVisible(true)
      .setAlpha(0.9)
      .setScale(0.5)
      .setTint(tint);
    this.scene.tweens.add({
      targets: particle,
      y: particle.y - 18,
      alpha: 0,
      duration: 320,
      ease: 'Quad.easeOut',
      onComplete: () => this.particlePool.release(particle),
    });
  }

 /** 元素弹拖尾（按调色板索引上色） */
  trailPuff(x: number, y: number, colorIndex: number): void {
    const particle = this.particlePool.acquire();
    if (!particle) return;
    this.scene.tweens.killTweensOf(particle);
    particle
      .setPosition(x, y)
      .setActive(true)
      .setVisible(true)
      .setAlpha(0.5)
      .setScale(0.5)
      .setTint(hexToInt(PALETTE[colorIndex] ?? PALETTE[5]));
    this.scene.tweens.add({
      targets: particle,
      alpha: 0,
      scale: 0.1,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => this.particlePool.release(particle),
    });
  }

 /** 死亡碎裂 */
  deathBurst(at: Vec2, element: ElementType): void {
    const tint = hexToInt(PALETTE[ELEMENT_COLOR_INDEX[element] ?? DATA_FALLBACK.ELEMENT_COLOR_FALLBACK_INDEX]);
    for (let index = 0; index < DEATH_BURST_PARTICLES; index += 1) {
      const particle = this.particlePool.acquire();
      if (!particle) break;
      this.scene.tweens.killTweensOf(particle);
      const angle = rand() * TAU;
      const distance = 18 + rand() * 26;
      particle
        .setPosition(at.x, at.y)
        .setActive(true)
        .setVisible(true)
        .setAlpha(0.95)
        .setScale(0.4 + rand() * 0.4)
        .setTint(tint);
      this.scene.tweens.add({
        targets: particle,
        x: at.x + Math.cos(angle) * distance,
        y: at.y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.05,
        duration: 260 + rand() * 140,
        ease: 'Quad.easeOut',
        onComplete: () => this.particlePool.release(particle),
      });
    }
  }

 /** 受击闪白（90ms 后恢复） */
  flash(sprite: Phaser.GameObjects.Sprite): void {
    if (!sprite.active) return;
    sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      if (!sprite.active) return;
      sprite.clearTint();
    });
  }

  shake(durationMs: number, intensity: number): void {
    this.scene.cameras.main.shake(clamp(durationMs, 0, SHAKE_MAX_MS), clamp(intensity, 0, 0.05));
  }

 /** 顿帧：物理世界整体减速，手感上「卡一下」 */
  hitStop(durationMs: number): void {
    const duration = clamp(durationMs, 0, HITSTOP_MAX_MS);
    if (duration <= 0 || this.destroyed) return;
    const world = this.scene.physics.world;
    world.timeScale = HITSTOP_PHYSICS_SCALE;
    this.hitStopToken += 1;
    const token = this.hitStopToken;
    this.scene.time.delayedCall(duration, () => {
      if (this.destroyed || token !== this.hitStopToken) return;
      world.timeScale = 1;
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.hitStopToken += 1;
    if (this.scene.physics && this.scene.physics.world) {
      this.scene.physics.world.timeScale = 1;
    }
    this.textPool.clear();
    this.sparkPool.clear();
    this.particlePool.clear();
    for (const graphic of this.arcPool) {
      this.scene.tweens.killTweensOf(graphic);
      graphic.destroy();
    }
    this.arcPool.length = 0;
  }
}
