import type Phaser from 'phaser';
import type {
  IUpgradeService,
  WeaponDef,
  WeaponExpResult,
  WeaponInstance,
} from '../core/contracts';
import { bus } from '../core/events';
import { DATA_FALLBACK } from '../core/constants';
import { getService } from '../core/services';
import { getLevelScaling, getWeaponDef } from '../data';
import type { WeaponSystem } from './WeaponSystem';

const MAX_LEVEL = 3;

/** 经验、升级、进化。进化只换 defId，已装卡牌全部保留。 */
export class UpgradeSystem implements IUpgradeService {
  private readonly scene: Phaser.Scene;
  private readonly weapon: WeaponSystem;

  constructor(scene: Phaser.Scene, weapon: WeaponSystem) {
    this.scene = scene;
    this.weapon = weapon;
  }

  expToNext(inst: WeaponInstance): number {
    const def = getWeaponDef(inst.defId);
    if (inst.evolved) return 0;
    if (inst.level < MAX_LEVEL) return def.expToLevel[inst.level - 1] ?? DATA_FALLBACK.NO_BONUS;
    return def.expToEvolve;
  }

  addExp(inst: WeaponInstance, amount: number): WeaponExpResult {
    if (inst.evolved) {
      return { levelUp: false, evolved: false, level: inst.level, exp: 0, next: 0 };
    }

    const def = getWeaponDef(inst.defId);
    let level = inst.level;
    let exp = inst.exp + Math.max(0, amount);
    let levelUp = false;

    while (level < MAX_LEVEL) {
      const need = def.expToLevel[level - 1] ?? DATA_FALLBACK.NO_BONUS;
      if (need <= 0 || exp < need) break;
      exp -= need;
      level += 1;
      levelUp = true;
    }

  // 满 Lv3 后经验只累计到进化所需值，HUD 进度条不会超过 100%
    if (level >= MAX_LEVEL) exp = Math.min(exp, def.expToEvolve);

    inst.level = level;
    inst.exp = exp;

    if (levelUp) {
      this.weapon.recompute(inst);
      getService(this.scene, 'audio').play('sfx_levelup');
   //：升级广播（HUD 显示等级变化 + 本次升级效果）
      const scaling = getLevelScaling();
      const damageMul = scaling.damageMul[level - 1] ?? DATA_FALLBACK.NO_MULTIPLIER;
      const attackSpeedMul = scaling.attackSpeedMul[level - 1] ?? DATA_FALLBACK.NO_MULTIPLIER;
      bus.emit('weapon:level', {
        slot: this.weapon.slotOf(inst),
        defId: inst.defId,
        level,
        damageMul,
        attackSpeedMul,
      });
    }
    this.weapon.notifyState(inst);

    return {
      levelUp,
      evolved: false,
      level,
      exp,
      next: this.expToNext(inst),
    };
  }

  canEvolve(inst: WeaponInstance): boolean {
    const def = getWeaponDef(inst.defId);
    return (
      !inst.evolved &&
      inst.level === MAX_LEVEL &&
      def.evolvesTo !== undefined &&
      def.expToEvolve > 0 &&
      inst.exp >= def.expToEvolve
    );
  }

  evolutionTarget(inst: WeaponInstance): WeaponDef | null {
    if (!this.canEvolve(inst)) return null;
    const def = getWeaponDef(inst.defId);
    return def.evolvesTo ? getWeaponDef(def.evolvesTo) : null;
  }

  evolve(inst: WeaponInstance): boolean {
    const target = this.evolutionTarget(inst);
    if (!target) return false;

    const from = inst.defId;
    const slot = this.weapon.slotOf(inst);

    inst.defId = target.id;
    inst.evolved = true;
    inst.level = MAX_LEVEL;
    inst.exp = 0;
  // 换形态后不继承旧形态的连击段，避免进化完第一刀直接算第 3 段
    inst.comboIndex = 0;
    inst.comboExpireAt = 0;
    this.weapon.recompute(inst);

    bus.emit('weapon:evolved', { slot, from, to: target.id });
    this.weapon.notifyState(inst);
    getService(this.scene, 'audio').play('sfx_evolve');
    return true;
  }
}
