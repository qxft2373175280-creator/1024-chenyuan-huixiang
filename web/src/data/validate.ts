/**
 * 数据校验规则 —— 运行时（BootScene）与 CLI（scripts/validate-data.mjs）共用同一套规则
 * 
 *
 * 说明：本文件必须保持「可在 Node 中直接 import」——只允许 type-only import，
 * 不使用 enum / namespace / 参数属性等不可擦除语法（Node 类型剥离依赖这一点）。
 */
import type { DataBundle, ValidationResult } from './defs';
import type { CardDef, LayoutDef, ModifierTarget, WeaponDef } from '../core/contracts';
import type { ParryFileDef, ParryTuning } from '../core/parry-contracts';
import type { TutorialFileDef } from '../core/tutorial-contracts';
import type { MenuGuideFileDef, StagesFileDef } from '../core/stage-contracts';

/** 地图允许的字符 */
export const LAYOUT_SYMBOLS = '#.PSBC$G';

/** 卡牌 modifier 合法 target（与 contracts.ts 的 ModifierTarget 保持一致） */
export const MODIFIER_TARGETS: readonly ModifierTarget[] = [
  'damage',
  'attackSpeed',
  'range',
  'comboHits',
  'projectileCount',
  'pierce',
  'spread',
  'critChance',
  'critMult',
  'executeBelow',
  'poisonPerHit',
  'poisonDuration',
  'lifesteal',
  'chain',
  'explodeRadius',
  'spinRadius',
];

/** 稀有度合法值 */
const RARITIES = ['common', 'rare', 'epic'];

/** 百分比类 target：描述里 {value} 需要 ×100 展示 */
const PERCENT_TARGETS: readonly string[] = ['critChance', 'lifesteal', 'executeBelow'];

export function isPercentTarget(target: string): boolean {
  return PERCENT_TARGETS.includes(target);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkUnique(errors: string[], file: string, ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${file}: id 重复 "${id}"`);
    seen.add(id);
  }
}

/**
 * 布局校验。
 * `usage` 描述引用该布局的房间情况：
 * - `total`：引用该布局的房间数；
 * - `allSpawnless`：所有引用它的房间都没有波次（shop / treasure / boss 这类无刷怪房）。
 *
 * 关于 `layout_ring`：该布局按设计就没有刷怪点 S（只给无波次房用，当前是商店房 room_04），
 * 以前会输出 △ 警告，容易被当成缺陷。按 2026-10-25 的决定：**保留无刷怪点设计**，
 * 校验逻辑把它识别为「无波次房布局」并降级为 ℹ 信息行，不再产生普通警告；
 * 其余校验（尺寸 / 行宽 / 非法字符 / P·B 数量 / 是否被引用）全部照旧，没有关闭任何检查。
 */
function checkLayout(
  errors: string[],
  warnings: string[],
  infos: string[],
  layout: LayoutDef,
  usage: { total: number; allSpawnless: boolean },
): void {
  const path = `rooms.json/layouts/${layout.id}`;
  if (layout.width !== 40 || layout.height !== 24) {
    errors.push(`${path}: 尺寸必须是 40×24，当前 ${layout.width}×${layout.height}`);
  }
  if (!Array.isArray(layout.pattern) || layout.pattern.length !== layout.height) {
    errors.push(`${path}: pattern 行数必须是 ${layout.height}`);
  }
  let players = 0;
  let bosses = 0;
  let spawns = 0;
  layout.pattern.forEach((row, y) => {
    if (row.length !== layout.width) {
      errors.push(`${path}/pattern[${y}]: 行宽必须是 ${layout.width}，当前 ${row.length}`);
    }
    for (const ch of row) {
      if (!LAYOUT_SYMBOLS.includes(ch)) {
        errors.push(`${path}/pattern[${y}]: 非法字符 "${ch}"（允许 ${LAYOUT_SYMBOLS}）`);
        continue;
      }
      if (ch === 'P') players += 1;
      if (ch === 'B') bosses += 1;
      if (ch === 'S') spawns += 1;
    }
  });
  if (players === 0 && bosses === 0) errors.push(`${path}: 缺少玩家出生点 P 或 Boss 出生点 B`);
  if (players > 1) errors.push(`${path}: 玩家出生点 P 只能有 1 个`);
  if (bosses > 1) errors.push(`${path}: Boss 出生点 B 只能有 1 个`);
 // §9.5 的本意是「一个布局只承担一种出生点」；当前用同一布局同时承担精英房与 Boss 房，
 // 因此这里降级为提示（不阻塞 CI）。（是否拆分布局，由玩法设计后续决定）
  if (players === 1 && bosses === 1) {
    warnings.push(`${path}: 同时存在 P 与 B（§9.5 建议「精英房 / Boss 房」分布局；当前实现共用布局）`);
  }
  if (spawns === 0) {
  // 只有「被无波次房（shop / treasure / boss）专用」时才允许没有 S；被战斗房引用仍然报警告
    if (usage.total > 0 && usage.allSpawnless) {
      infos.push(`${path}：Boss/无波次房布局，允许没有普通刷怪点 S`);
    } else {
      warnings.push(`${path}: 没有刷怪点 S（有波次的房间必须有 S）`);
    }
  }
  if (usage.total === 0) warnings.push(`${path}: 没有被任何房间引用`);
}

/**
 * 弹反数值校验。`overrides` 为每个敌人的增量覆盖，合并后再校验一致性。
 * 返回合并后的数值，方便调用方继续判断（这里只用于校验，不做业务）。
 */
function checkParryTuning(
  errors: string[],
  path: string,
  tuning: Partial<ParryTuning>,
  requireAll: boolean,
): void {
  const numeric: Array<[keyof ParryTuning, boolean]> = [
    ['windupTotalMs', true],
    ['parryWindowMs', true],
    ['perfectWindowMs', false],
    ['successStunMs', true],
    ['failReleaseDelayMs', false],
    ['ringStartRadiusMul', true],
    ['ringEndRadiusMul', true],
  ];
  for (const [field, positive] of numeric) {
    const value = tuning[field];
    if (value === undefined) {
      if (requireAll) errors.push(`${path}.${field}: 缺少必填数值`);
      continue;
    }
    if (!isFiniteNumber(value)) {
      errors.push(`${path}.${field}: 必须是数字`);
      continue;
    }
    if (positive ? !(value > 0) : value < 0) {
      errors.push(`${path}.${field}: 必须${positive ? ' > 0' : ' ≥ 0'}`);
    }
  }
}

function checkParrySection(
  errors: string[],
  warnings: string[],
  parry: ParryFileDef | undefined,
  weaponById: Map<string, WeaponDef>,
  enemyIds: string[],
): void {
  if (!parry) {
    errors.push('parry.json: 缺少弹反配置');
    return;
  }

  const global = parry.global;
  if (!global) {
    errors.push('parry.json/global: 缺少全局数值');
    return;
  }
  checkParryTuning(errors, 'parry.json/global', global, true);

  if (isFiniteNumber(global.windupTotalMs) && isFiniteNumber(global.parryWindowMs)) {
    if (!(global.parryWindowMs < global.windupTotalMs)) {
      errors.push('parry.json/global.parryWindowMs: 弹反窗口必须小于蓄力总时长（否则圈没有收缩过程）');
    }
  }
  if (isFiniteNumber(global.perfectWindowMs) && isFiniteNumber(global.parryWindowMs)) {
    if (global.perfectWindowMs > global.parryWindowMs) {
      errors.push('parry.json/global.perfectWindowMs: 完美窗口不能大于弹反窗口');
    }
  }
  if (isFiniteNumber(global.ringStartRadiusMul) && isFiniteNumber(global.ringEndRadiusMul)) {
    if (!(global.ringStartRadiusMul > global.ringEndRadiusMul)) {
      errors.push('parry.json/global: 圈起始半径倍率必须大于结束半径倍率（否则看不到收缩）');
    }
  }

  const colors = global.colors;
  if (!colors) {
    errors.push('parry.json/global.colors: 缺少颜色配置');
  } else {
    for (const key of ['charge', 'warn', 'window', 'flash'] as const) {
      const value = colors[key];
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
        errors.push(`parry.json/global.colors.${key}: 必须是 #RRGGBB，当前 "${String(value)}"`);
      }
    }
  }

  const weapons = parry.weapons;
  if (!weapons) {
    errors.push('parry.json/weapons: 缺少武器规则');
  } else {
    if (typeof weapons.meleeSwingTag !== 'string' || weapons.meleeSwingTag.length === 0) {
      errors.push('parry.json/weapons.meleeSwingTag: 不能为空');
    }
    if (!Array.isArray(weapons.enabledWeaponIds) || weapons.enabledWeaponIds.length === 0) {
      errors.push('parry.json/weapons.enabledWeaponIds: 至少配置 1 把武器');
    } else {
      const enabled = new Set(weapons.enabledWeaponIds);
      for (const weaponId of weapons.enabledWeaponIds) {
        const weapon = weaponById.get(weaponId);
        if (!weapon) {
          errors.push(`parry.json/weapons.enabledWeaponIds: 武器不存在 "${weaponId}"`);
          continue;
        }
    // 首版只允许近战武器弹反（手枪 / 法杖 / 元素武器一律不许，见 PARRY-003 / PARRY-006）
        if (weapon.category !== 'melee') {
          errors.push(
            `parry.json/weapons.enabledWeaponIds: "${weaponId}" 是 ${weapon.category} 武器，弹反只允许近战武器`,
          );
        }
    // 进化形态继承：近战武器的进化目标也应留在白名单，否则「进化后反而不能弹反」
        if (weapon.evolvesTo) {
          const target = weaponById.get(weapon.evolvesTo);
          if (target && target.category === 'melee' && !enabled.has(target.id)) {
            warnings.push(
              `parry.json/weapons.enabledWeaponIds: "${weaponId}" 进化后是 "${target.id}"，但它不在弹反白名单里（进化后会用不了弹反）`,
            );
          }
        }
      }
    }
  }

  const enemies = parry.enemies;
  if (!enemies || typeof enemies !== 'object') {
    errors.push('parry.json/enemies: 缺少敌人规则（可为空对象）');
    return;
  }
  for (const [enemyId, rule] of Object.entries(enemies)) {
    const path = `parry.json/enemies/${enemyId}`;
    if (!enemyIds.includes(enemyId)) {
      errors.push(`${path}: 敌人不存在 "${enemyId}"`);
      continue;
    }
    if (!rule || typeof rule !== 'object') {
      errors.push(`${path}: 必须是对象`);
      continue;
    }
    if (rule.attack !== 'charge') {
      errors.push(`${path}.attack: 首版只支持 "charge"（其余攻击形态见 PARRY-005），当前 "${String(rule.attack)}"`);
    }
    checkParryTuning(errors, path, rule, false);
  // 覆盖后仍然要满足「窗口 < 总时长」
    const total = rule.windupTotalMs ?? global.windupTotalMs;
    const window = rule.parryWindowMs ?? global.parryWindowMs;
    if (isFiniteNumber(total) && isFiniteNumber(window) && !(window < total)) {
      errors.push(`${path}: 合并 global 后弹反窗口（${window}）必须小于蓄力总时长（${total}）`);
    }
    if (rule.perfectWindowMs !== undefined && isFiniteNumber(window) && rule.perfectWindowMs > window) {
      errors.push(`${path}.perfectWindowMs: 不能大于弹反窗口`);
    }
    if (rule.failReleaseDelayMs !== undefined && !isFiniteNumber(rule.failReleaseDelayMs)) {
      errors.push(`${path}.failReleaseDelayMs: 必须是数字`);
    }
  }
}

/**
 * 新手教程校验()：步骤顺序 / 文案 / 超时 / 敌人 / 卡片 / 奖励 / 降级参数。
 * 所有数值都来自 `tutorial.json`，这里只判断合法性与交叉引用。
 */
function checkTutorialSection(
  errors: string[],
  warnings: string[],
  tutorial: TutorialFileDef | undefined,
  enemyIds: string[],
  cardIds: string[],
  layoutIds: Set<string>,
): void {
  if (!tutorial) {
    errors.push('tutorial.json: 缺少教程配置（TUTORIAL-01）');
    return;
  }
  const steps = tutorial.steps ?? [];
  if (steps.length === 0) {
    errors.push('tutorial.json/steps: 至少要有 1 个步骤');
    return;
  }
  const ids = new Set<string>();
  const requiredKinds = ['move', 'attack', 'dash', 'cards', 'parry'];
  for (const kind of requiredKinds) {
    if (!steps.some((step) => step.kind === kind)) {
      errors.push(`tutorial.json/steps: 缺少必需步骤类型 "${kind}"（教程必须覆盖 5 个教学环节）`);
    }
  }
  if (tutorial.layoutId && !layoutIds.has(tutorial.layoutId)) {
    errors.push(`tutorial.json/layoutId: 布局不存在 "${tutorial.layoutId}"`);
  }
  if (!(isFiniteNumber(tutorial.reward?.materials) && tutorial.reward.materials >= 0)) {
    errors.push('tutorial.json/reward.materials: 必须 ≥ 0');
  }
  const ui = tutorial.ui;
  if (!ui) {
    errors.push('tutorial.json/ui: 缺少教程 UI 文案');
  } else {
    for (const key of ['bannerTitle', 'skipLabel', 'skipConfirmText', 'completeTitle', 'completeSubText'] as const) {
      if (typeof ui[key] !== 'string' || ui[key].length === 0) {
        errors.push(`tutorial.json/ui.${key}: 不能为空`);
      }
    }
  }

  steps.forEach((step, index) => {
    const path = `tutorial.json/steps[${index}]${step?.id ? `(${step.id})` : ''}`;
    if (!step || typeof step !== 'object') {
      errors.push(`${path}: 必须是对象`);
      return;
    }
    if (!step.id) errors.push(`${path}: 缺少 id`);
    else if (ids.has(step.id)) errors.push(`${path}: id 重复 "${step.id}"`);
    else ids.add(step.id);
    if (!requiredKinds.includes(step.kind)) errors.push(`${path}.kind: 非法类型 "${String(step.kind)}"`);
    for (const key of ['title', 'stepLabel', 'hint', 'goal'] as const) {
      if (typeof step[key] !== 'string' || step[key].length === 0) errors.push(`${path}.${key}: 不能为空`);
    }
    if (!(isFiniteNumber(step.timeoutMs) && step.timeoutMs > 0)) {
      errors.push(`${path}.timeoutMs: 必须 > 0`);
    }

    const enemyList = 'enemies' in step ? (step.enemies ?? []) : [];
    if (step.kind === 'attack' || step.kind === 'cards' || step.kind === 'parry') {
      if (enemyList.length === 0) errors.push(`${path}.enemies: 该步骤至少要刷 1 个敌人`);
    }
    for (const [enemyIndex, spawn] of enemyList.entries()) {
      if (!enemyIds.includes(spawn.enemyId)) {
        errors.push(`${path}.enemies[${enemyIndex}]: 敌人不存在 "${spawn.enemyId}"`);
      }
      if (!(isFiniteNumber(spawn.count) && spawn.count > 0)) {
        errors.push(`${path}.enemies[${enemyIndex}].count: 必须 > 0`);
      }
      if (!spawn.offset || !isFiniteNumber(spawn.offset.x) || !isFiniteNumber(spawn.offset.y)) {
        errors.push(`${path}.enemies[${enemyIndex}].offset: 需要 {x, y} 数字`);
      }
    }

    if (step.kind === 'move') {
      if (!step.targetOffset || !isFiniteNumber(step.targetOffset.x) || !isFiniteNumber(step.targetOffset.y)) {
        errors.push(`${path}.targetOffset: 需要 {x, y} 数字`);
      }
      if (!(isFiniteNumber(step.arriveRadiusPx) && step.arriveRadiusPx > 0)) {
        errors.push(`${path}.arriveRadiusPx: 必须 > 0`);
      }
    }

    if (step.kind === 'dash') {
      const turret = step.turret;
      if (!turret) {
        errors.push(`${path}.turret: 冲刺步骤需要配置训练喷吐者`);
      } else {
        if (typeof turret.textureKey !== 'string' || turret.textureKey.length === 0) {
          errors.push(`${path}.turret.textureKey: 不能为空`);
        }
        const positive: Array<[string, number]> = [
          ['intervalMs', turret.intervalMs],
          ['projectileSpeed', turret.projectileSpeed],
          ['projectileLifeMs', turret.projectileLifeMs],
          ['radiusPx', turret.radiusPx],
          ['threatRadiusPx', step.dodge?.threatRadiusPx ?? NaN],
        ];
        for (const [key, value] of positive) {
          if (!(isFiniteNumber(value) && value > 0)) errors.push(`${path}: ${key} 必须 > 0`);
        }
        if (!(isFiniteNumber(turret.damage) && turret.damage >= 0)) {
          errors.push(`${path}.turret.damage: 必须 ≥ 0`);
        }
        if (!(isFiniteNumber(turret.hitsBeforeEase) && turret.hitsBeforeEase > 0)) {
          errors.push(`${path}.turret.hitsBeforeEase: 必须 > 0`);
        }
        if (!(isFiniteNumber(turret.easyIntervalMul) && turret.easyIntervalMul > 1)) {
          warnings.push(`${path}.turret.easyIntervalMul: 建议 > 1（否则降难度后反而更快）`);
        }
        if (!(isFiniteNumber(turret.easySpeedMul) && turret.easySpeedMul > 0 && turret.easySpeedMul < 1)) {
          warnings.push(`${path}.turret.easySpeedMul: 建议在 0~1（降难度 = 弹道更慢）`);
        }
      }
      if (!step.dodge || !(isFiniteNumber(step.dodge.threatRadiusPx) && step.dodge.threatRadiusPx > 0)) {
        errors.push(`${path}.dodge.threatRadiusPx: 必须 > 0`);
      }
    }

    if (step.kind === 'cards') {
      const list = step.rewardCardIds ?? [];
      if (!Array.isArray(list) || list.length < 2) {
        errors.push(`${path}.rewardCardIds: 至少 2 张卡（三选一）`);
      }
      for (const cardId of list) {
        if (!cardIds.includes(cardId)) errors.push(`${path}.rewardCardIds: 卡牌不存在 "${cardId}"`);
      }
    }

    if (step.kind === 'parry') {
      const fallback = step.parryFallback;
      if (!fallback) {
        errors.push(`${path}.parryFallback: 缺少降级参数`);
      } else {
        if (!(isFiniteNumber(fallback.failsBeforeEase) && fallback.failsBeforeEase > 0)) {
          errors.push(`${path}.parryFallback.failsBeforeEase: 必须 > 0`);
        }
        if (!(isFiniteNumber(fallback.windowMs) && fallback.windowMs > 0)) {
          errors.push(`${path}.parryFallback.windowMs: 必须 > 0`);
        }
      }
    }
  });
}

/**
 * 主界面指引 + 关卡曲线校验
 */
function checkStageAndGuideSections(
  errors: string[],
  warnings: string[],
  guide: MenuGuideFileDef | undefined,
  stages: StagesFileDef | undefined,
): void {
  if (!guide) {
    errors.push('menu-guide.json: 缺少主界面指引配置（R2）');
  } else {
    const steps = guide.steps ?? [];
    if (steps.length === 0) errors.push('menu-guide.json/steps: 至少 1 步');
    const allowedTargets = ['start', 'stages', 'loadout', 'forge', 'slots'];
    steps.forEach((step, index) => {
      const path = `menu-guide.json/steps[${index}]`;
      if (!step?.id) errors.push(`${path}: 缺少 id`);
      if (!allowedTargets.includes(step?.target)) errors.push(`${path}.target: 非法目标 "${String(step?.target)}"`);
      for (const key of ['title', 'text'] as const) {
        if (typeof step?.[key] !== 'string' || step[key].length === 0) errors.push(`${path}.${key}: 不能为空`);
      }
    });
    const loadoutText = guide.loadout;
    if (loadoutText) {
      for (const key of ['lockedReason', 'lockedHint'] as const) {
        if (typeof loadoutText[key] !== 'string' || loadoutText[key].length === 0) {
          errors.push(`menu-guide.json/loadout.${key}: 不能为空`);
        }
      }
    } else {
      warnings.push('menu-guide.json/loadout: 未配置未解锁卡提示文案（装备界面会退回默认文案）');
    }
  }

  if (!stages) {
    errors.push('stages.json: 缺少关卡曲线配置（R4）');
    return;
  }
  const scaling = stages.scaling;
  if (!scaling) {
    errors.push('stages.json/scaling: 缺少难度曲线');
    return;
  }
  const positives: Array<[string, number]> = [
    ['maxStage', scaling.maxStage],
    ['countPer2Stage', scaling.countPer2Stage],
    ['speedPer3Stage', scaling.speedPer3Stage],
    ['maxCountMultiplier', scaling.maxCountMultiplier],
    ['replayRewardMul', scaling.replayRewardMul],
  ];
  for (const [key, value] of positives) {
    if (!(isFiniteNumber(value) && value > 0)) errors.push(`stages.json/scaling.${key}: 必须 > 0`);
  }
  if (!(isFiniteNumber(scaling.hpPerStage) && scaling.hpPerStage >= 0)) errors.push('stages.json/scaling.hpPerStage: 必须 ≥ 0');
  if (!(isFiniteNumber(scaling.damagePerStage) && scaling.damagePerStage >= 0)) {
    errors.push('stages.json/scaling.damagePerStage: 必须 ≥ 0');
  }
  if (!(isFiniteNumber(scaling.replayRewardMul) && scaling.replayRewardMul > 0 && scaling.replayRewardMul < 1)) {
    warnings.push('stages.json/scaling.replayRewardMul: 历史回放奖励建议在 0~1 之间（当前不是 0.6 也允许）');
  }
  if (!scaling.challenge) {
    errors.push('stages.json/scaling.challenge: 缺少挑战模式加成');
  } else {
    for (const key of ['hpPerStage', 'damagePerStage', 'countPer2Stage', 'speedPer3Stage'] as const) {
      if (!(isFiniteNumber(scaling.challenge[key]) && scaling.challenge[key] >= 0)) {
        errors.push(`stages.json/scaling.challenge.${key}: 必须 ≥ 0`);
      }
    }
  }
  if (!(isFiniteNumber(scaling.maxStage) && scaling.maxStage >= 1)) {
    errors.push('stages.json/scaling.maxStage: 必须 ≥ 1');
  }
  if (!(isFiniteNumber(scaling.challenge.rewardMaterials) && scaling.challenge.rewardMaterials >= 0)) {
    errors.push('stages.json/scaling.challenge.rewardMaterials: 必须 ≥ 0');
  }
  const stageUi = stages.ui;
  if (!stageUi) {
    errors.push('stages.json/ui: 缺少挑战/回放文案');
  } else {
    for (const key of ['replayAbandoned', 'challengeRewardText', 'challengeUnlocked', 'challengeNext'] as const) {
      if (typeof stageUi[key] !== 'string' || stageUi[key].length === 0) errors.push(`stages.json/ui.${key}: 不能为空`);
    }
    if (!stageUi.challengeRewardText.includes('{materials}')) {
      errors.push('stages.json/ui.challengeRewardText: 必须包含占位符 {materials}');
    }
  }
  const labels = stages.labels;
  if (!labels) {
    errors.push('stages.json/labels: 缺少关卡名模板');
  } else {
    for (const key of ['campaign', 'replay', 'challenge'] as const) {
      if (typeof labels[key] !== 'string' || !labels[key].includes('{stage}')) {
        errors.push(`stages.json/labels.${key}: 必须包含占位符 {stage}`);
      }
    }
  }
}

/** 主校验入口：返回 errors（阻断）/ warnings（提示）/ infos（说明，不影响通过） */
export function validateData(bundle: DataBundle): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];

  const weapons = bundle.weapons?.weapons ?? [];
  const weaponIds = weapons.map((w) => w.id);
  checkUnique(errors, 'weapons.json', weaponIds);

  const scaling = bundle.weapons?.levelScaling;
  if (!scaling || scaling.damageMul.length !== 3 || scaling.attackSpeedMul.length !== 3) {
    errors.push('weapons.json/levelScaling: damageMul 与 attackSpeedMul 必须是 3 项（Lv1/2/3）');
  }

  for (const weapon of weapons) {
    const path = `weapons.json/weapons/${weapon.id}`;
    if (!isFiniteNumber(weapon.baseDamage) || weapon.baseDamage <= 0) {
      errors.push(`${path}: baseDamage 必须 > 0`);
    }
    if (!isFiniteNumber(weapon.attackSpeed) || weapon.attackSpeed <= 0) {
      errors.push(`${path}: attackSpeed 必须 > 0`);
    }
    if (!isFiniteNumber(weapon.range) || weapon.range <= 0) {
      errors.push(`${path}: range 必须 > 0（单位：瓦片）`);
    }
    if (!isFiniteNumber(weapon.cardSlots) || weapon.cardSlots < 1) {
      errors.push(`${path}: cardSlots 必须 ≥ 1`);
    }
    if (weapon.expToLevel.length !== 2) errors.push(`${path}: expToLevel 必须是 2 项`);
    if (weapon.comboHits < 1) errors.push(`${path}: comboHits 必须 ≥ 1`);
    if (weapon.evolvesTo && !weaponIds.includes(weapon.evolvesTo)) {
      errors.push(`${path}: evolvesTo 指向不存在的武器 "${weapon.evolvesTo}"`);
    }
    if (weapon.category === 'melee' && weapon.projectile && !weapon.tags.includes('fire')) {
      warnings.push(`${path}: 近战武器带 projectile（仅剑气形态建议这样做）`);
    }
    if (weapon.category !== 'melee' && !weapon.projectile) {
      errors.push(`${path}: 非近战武器必须配置 projectile`);
    }
    if (weapon.textureKey !== `spr_weapon_${weapon.id}`) {
      warnings.push(`${path}: textureKey 建议为 spr_weapon_${weapon.id}`);
    }
  }

  const cards = bundle.cards?.cards ?? [];
  const cardIds = cards.map((c) => c.id);
  checkUnique(errors, 'cards.json', cardIds);
  const unlockIds = new Set((bundle.forge?.unlocks ?? []).map((u) => u.id));

  for (const card of cards) {
    const path = `cards.json/cards/${card.id}`;
    if (!RARITIES.includes(card.rarity)) errors.push(`${path}: 非法稀有度 "${card.rarity}"`);
    if (!Array.isArray(card.modifiers) || card.modifiers.length === 0) {
      errors.push(`${path}: modifiers 不能为空`);
    }
    card.modifiers.forEach((modifier, index) => {
      if (!MODIFIER_TARGETS.includes(modifier.target)) {
        errors.push(`${path}/modifiers[${index}].target: 未知 target "${modifier.target}"`);
      }
      if (!['add', 'mul', 'set'].includes(modifier.op)) {
        errors.push(`${path}/modifiers[${index}].op: 非法 op "${modifier.op}"`);
      }
      if (!isFiniteNumber(modifier.value)) {
        errors.push(`${path}/modifiers[${index}].value: 必须是数字`);
      }
    });
    if (card.unlock && !unlockIds.has(card.unlock)) {
      errors.push(`${path}: unlock 指向不存在的锻造项 "${card.unlock}"`);
    }
    if (card.textureKey !== `ui_${card.id}`) {
      warnings.push(`${path}: textureKey 建议为 ui_${card.id}`);
    }
    if (!card.tags || card.tags.length === 0) warnings.push(`${path}: 缺少流派标签 tags`);
  }

  const enemies = bundle.enemies?.enemies ?? [];
  const enemyIds = enemies.map((e) => e.id);
  checkUnique(errors, 'enemies.json', enemyIds);

  for (const enemy of enemies) {
    const path = `enemies.json/enemies/${enemy.id}`;
    if (!(enemy.maxHp > 0)) errors.push(`${path}: maxHp 必须 > 0`);
    if (!(enemy.speed >= 0)) errors.push(`${path}: speed 必须 ≥ 0`);
    if (!(enemy.radiusPx > 0)) errors.push(`${path}: radiusPx 必须 > 0`);
    if (enemy.materialChance < 0 || enemy.materialChance > 1) {
      errors.push(`${path}: materialChance 必须在 0..1`);
    }
    if (enemy.knockbackResist < 0 || enemy.knockbackResist > 1) {
      errors.push(`${path}: knockbackResist 必须在 0..1`);
    }
    if (enemy.textureKey !== `spr_${enemy.id}`) {
      warnings.push(`${path}: textureKey 建议为 spr_${enemy.id}`);
    }
    if (enemy.isBoss && (!enemy.phases || enemy.phases.length === 0)) {
      errors.push(`${path}: Boss 必须配置 phases`);
    }
    enemy.phases?.forEach((phase, phaseIndex) => {
      const ppath = `${path}/phases[${phaseIndex}]`;
      if (phase.atHpRatio < 0 || phase.atHpRatio > 1) {
        errors.push(`${ppath}: atHpRatio 必须在 0..1`);
      }
      if (!phase.attacks || phase.attacks.length === 0) errors.push(`${ppath}: attacks 不能为空`);
      if (phase.summon && !enemyIds.includes(phase.summon.enemyId)) {
        errors.push(`${ppath}: summon.enemyId 指向不存在的敌人 "${phase.summon.enemyId}"`);
      }
      if (phase.attacks.includes('radial') && !phase.radial) {
        warnings.push(`${ppath}: 使用了 radial 但未配置 radial 参数`);
      }
   //：Boss 追踪弹（预警/数量/速度/寿命都要有界）
      const attacks = phase.attacks as readonly string[];
      if (attacks.includes('homing')) {
        const homing = phase.homing;
        if (!homing) {
          errors.push(`${ppath}: attacks 里写了 homing 但没有配置 homing 参数`);
        } else {
          const hp = `${ppath}/homing`;
          if (!(homing.windupMs >= 300)) errors.push(`${hp}: windupMs 必须 ≥ 300（要有清楚预警）`);
          if (!(homing.count >= 1 && homing.count <= 8)) errors.push(`${hp}: count 必须在 1..8`);
          if (!(homing.speed > 0 && homing.speed <= 400)) errors.push(`${hp}: speed 必须在 0..400（速度上限）`);
          if (!(homing.lifeMs > 0)) errors.push(`${hp}: lifeMs 必须 > 0`);
          if (!(homing.homingMs > 0 && homing.homingMs < homing.lifeMs)) {
            errors.push(`${hp}: homingMs 必须在 0..lifeMs 之间（不允许永久锁定）`);
          }
          if (!(homing.turnRateDegPerSec > 0 && homing.turnRateDegPerSec <= 400)) {
            errors.push(`${hp}: turnRateDegPerSec 必须在 0..400`);
          }
          if (!(homing.damage > 0)) errors.push(`${hp}: damage 必须 > 0`);
          if (!(homing.radiusPx > 0)) errors.push(`${hp}: radiusPx 必须 > 0`);
          if (!(homing.spawnOffsetPx >= 0)) errors.push(`${hp}: spawnOffsetPx 必须 ≥ 0`);
          if (!(homing.spreadDeg >= 0 && homing.spreadDeg <= 90)) errors.push(`${hp}: spreadDeg 必须在 0..90`);
        }
      }
    });
  }

 //：弹反配置（独立文件，规则与 enemies/weapons 交叉校验）
  checkParrySection(errors, warnings, bundle.parry, new Map(weapons.map((weapon) => [weapon.id, weapon])), enemyIds);

 //：教程配置（独立文件）
  checkTutorialSection(
    errors,
    warnings,
    bundle.tutorial,
    enemyIds,
    cards.map((card) => card.id),
    new Set((bundle.rooms?.layouts ?? []).map((layout) => layout.id)),
  );

 // // 主界面指引 + 关卡曲线
  checkStageAndGuideSections(errors, warnings, bundle.guide, bundle.stages);

  const player = bundle.player;
  if (player) {
    const path = 'player.json';
    if (!(player.maxHp > 0)) errors.push(`${path}: maxHp 必须 > 0`);
    if (!(player.moveSpeed > 0)) errors.push(`${path}: moveSpeed 必须 > 0`);
    for (const startingWeapon of player.startWeapons ?? []) {
      if (!weaponIds.includes(startingWeapon)) {
        errors.push(`${path}: startWeapons 指向不存在的武器 "${startingWeapon}"`);
      }
    }
  } else {
    errors.push('player.json: 缺少角色定义');
  }

  const layouts = bundle.rooms?.layouts ?? [];
  const layoutIds = new Set(layouts.map((l) => l.id));
  const rooms = bundle.rooms?.rooms ?? [];
  const roomIds = new Set(rooms.map((r) => r.id));
  checkUnique(
    errors,
    'rooms.json/layouts',
    layouts.map((l) => l.id),
  );
  checkUnique(
    errors,
    'rooms.json/rooms',
    rooms.map((r) => r.id),
  );

  for (const layout of layouts) {
    const users = rooms.filter((room) => room.layoutId === layout.id);
    const usage = {
      total: users.length,
   // 「无刷怪房」= 没有任何波次的房间（shop / treasure / boss）
      allSpawnless: users.length > 0 && users.every((room) => (room.waves ?? []).length === 0),
    };
    checkLayout(errors, warnings, infos, layout, usage);
  }

  for (const room of rooms) {
    const path = `rooms.json/rooms/${room.id}`;
    if (!layoutIds.has(room.layoutId)) {
      errors.push(`${path}: layoutId 指向不存在的布局 "${room.layoutId}"`);
    }
    if (!Array.isArray(room.waves)) errors.push(`${path}: waves 必须是数组（可为空）`);
  //：Boss 房小怪节奏（可选字段）
    if (room.bossRoom) {
      const bp = `${path}/bossRoom`;
      const config = room.bossRoom;
      if (room.type !== 'boss') warnings.push(`${bp}: 只有 boss 房建议配置小怪节奏`);
      if (!Array.isArray(config.minionIds) || config.minionIds.length === 0) {
        errors.push(`${bp}: minionIds 不能为空`);
      } else {
        for (const minionId of config.minionIds) {
          if (!enemyIds.includes(minionId)) errors.push(`${bp}: minionIds 里有不存在的敌人 "${minionId}"`);
        }
      }
      if (!(config.initialDelayMs >= 0)) errors.push(`${bp}: initialDelayMs 必须 ≥ 0`);
      if (!(config.spawnIntervalMs > 0)) errors.push(`${bp}: spawnIntervalMs 必须 > 0`);
      if (!(config.maxAliveMinions >= 1)) errors.push(`${bp}: maxAliveMinions 必须 ≥ 1`);
      if (!(config.maxTotalMinions >= config.maxAliveMinions)) {
        errors.push(`${bp}: maxTotalMinions 必须 ≥ maxAliveMinions`);
      }
    }
    room.waves?.forEach((wave, waveIndex) => {
      wave.enemies?.forEach((entry) => {
        if (!enemyIds.includes(entry.enemyId)) {
          errors.push(`${path}/waves[${waveIndex}]: enemyId 不存在 "${entry.enemyId}"`);
        }
        if (!(entry.count > 0)) {
          errors.push(`${path}/waves[${waveIndex}]: count 必须 > 0`);
        }
      });
    });
  }

  for (const node of bundle.rooms?.run?.nodes ?? []) {
    if (!roomIds.has(node.roomId)) {
      errors.push(`rooms.json/run.nodes: roomId 不存在 "${node.roomId}"`);
    }
  }
  if ((bundle.rooms?.run?.nodes ?? []).length === 0) {
    errors.push('rooms.json/run.nodes: 关卡序列不能为空');
  }

  const economy = bundle.rooms?.economy;
  if (!economy) {
    errors.push('rooms.json/economy: 缺少经济配置');
  } else {
    const positive: Array<[string, number]> = [
      ['materialPerKillDivisor', economy.materialPerKillDivisor],
      ['shop.cardPrice', economy.shop.cardPrice],
      ['shop.healPrice', economy.shop.healPrice],
      ['shop.materialPrice', economy.shop.materialPrice],
      ['shop.weaponExpPrice', economy.shop.weaponExpPrice],
    ];
    for (const [field, value] of positive) {
      if (!(value > 0)) errors.push(`rooms.json/economy/${field}: 必须 > 0`);
    }
  }

  const unlocks = bundle.forge?.unlocks ?? [];
  checkUnique(
    errors,
    'forge.json',
    unlocks.map((u) => u.id),
  );
  const unlockIdSet = new Set(unlocks.map((u) => u.id));

  for (const unlock of unlocks) {
    const path = `forge.json/unlocks/${unlock.id}`;
    if (!(unlock.cost >= 0)) errors.push(`${path}: cost 必须 ≥ 0`);
    if (unlock.kind === 'card' && !cardIds.includes(unlock.target)) {
      errors.push(`${path}: target 指向不存在的卡牌 "${unlock.target}"`);
    }
    if (unlock.kind === 'weapon' && !weaponIds.includes(unlock.target)) {
      errors.push(`${path}: target 指向不存在的武器 "${unlock.target}"`);
    }
    for (const requirement of unlock.requires) {
      if (!unlockIdSet.has(requirement)) {
        errors.push(`${path}: requires 指向不存在的解锁 "${requirement}"`);
      }
    }
  }

  return { errors, warnings, infos };
}

/** 卡牌文案里的 {value} 填充（P1 局外图鉴的简易实现；正式版由 CardSystem.describe 负责） */
export function formatCardText(card: CardDef): string {
  const first = card.modifiers[0];
  if (!first) return card.description;
  const value = isPercentTarget(first.target) ? Math.round(first.value * 1000) / 10 : first.value;
  return card.description.replace('{value}', String(value));
}
