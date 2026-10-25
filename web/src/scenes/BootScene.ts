/**
 * 启动场景：加载 manifest → 生成占位贴图 → 数据自检 → 进入主菜单
 * 
 */
import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { bus } from '../core/events';
import { SCENE_KEYS } from '../core/keys';
import { log } from '../core/logger';
import { getUrlParam } from '../core/util';
import { logDataSummary, validateAll } from '../data';
import { generateAll } from '../gfx/TextureFactory';
import { PALETTE } from '../gfx/palette';
import { addText } from '../gfx/UiKit';

interface ManifestEntry {
  key: string;
  file: string;
  frameWidth?: number;
  frameHeight?: number;
  frames?: number;
}

interface AssetManifest {
  sprites?: ManifestEntry[];
  tiles?: ManifestEntry[];
  ui?: ManifestEntry[];
  audio?: ManifestEntry[];
}

/** 已加载过 manifest 时，把条目转成 loader 任务 */
function collectEntries(manifest: AssetManifest | undefined): ManifestEntry[] {
  if (!manifest) return [];
  return [...(manifest.sprites ?? []), ...(manifest.tiles ?? []), ...(manifest.ui ?? [])].filter(
    (entry) => typeof entry.key === 'string' && typeof entry.file === 'string',
  );
}

export class BootScene extends Phaser.Scene {
  private barFill?: Phaser.GameObjects.Rectangle;
  private statusText?: Phaser.GameObjects.Text;
  private firstPhaseDone = false;
  private failedKeys: string[] = [];

  constructor() {
    super(SCENE_KEYS.BOOT);
  }

  preload(): void {
    this.buildUi();

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      this.setProgress(this.firstPhaseDone ? 0.2 + value * 0.8 : value * 0.2);
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failedKeys.push(file.key);
      log.p1.warn(`资源加载失败：${file.key}（将回落到程序化占位图）`);
    });

  // 只有 manifest 是硬依赖；美术资源全部可缺省
    this.load.json('asset-manifest', 'assets/manifest.json');
  }

  create(): void {
    this.firstPhaseDone = true;
    this.setProgress(0.2);

    const manifest = this.cache.json.get('asset-manifest') as AssetManifest | undefined;
    const entries = collectEntries(manifest).filter((entry) => !this.failedKeys.includes(entry.key));

    if (entries.length === 0) {
      this.finish();
      return;
    }

    this.statusText?.setText(`加载美术资源（${entries.length} 项）…`);
    for (const entry of entries) {
      const path = `assets/${entry.file}`;
      if (entry.frames && entry.frames > 1 && entry.frameWidth && entry.frameHeight) {
        this.load.spritesheet(entry.key, path, {
          frameWidth: entry.frameWidth,
          frameHeight: entry.frameHeight,
        });
      } else {
        this.load.image(entry.key, path);
      }
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.finish());
    this.load.start();
  }

 /** 生成占位贴图 + 数据自检 + 进入菜单 */
  private finish(): void {
    this.setProgress(0.82);
    this.statusText?.setText('校验数值表…');

    const result = validateAll();
    if (result.errors.length > 0) {
      log.p1.error(`数据校验失败（${result.errors.length} 项）`, result.errors);
      bus.emit('data:invalid', { errors: result.errors });
      this.showDataError(result.errors);
      return;
    }
    if (result.warnings.length > 0) {
      log.p1.warn(`数据校验提示（${result.warnings.length} 项）`, result.warnings);
    }
    if (result.infos.length > 0) {
      log.p1.info(`数据校验说明（${result.infos.length} 项）`, result.infos);
    }

    this.statusText?.setText('生成占位贴图…');
    generateAll(this);
    logDataSummary();
    this.setProgress(1);

    this.time.delayedCall(240, () => this.scene.start(this.resolveStartScene()));
  }

 /**
  * 调试入口（都在 URL 上，写进 README / 菜单提示）：
  * - `?scene=forge|game|reward|result|sandbox` 直接进对应界面
  * - `?debug=room=3` / `?debug=god` / `?debug=sandbox` / `?debug=cards=all` 直接进战斗（参数由 GameScene 读取）
  */
  private resolveStartScene(): string {
    const debug = getUrlParam('debug') ?? '';
    const debugEntersGame =
      debug.startsWith('room=') ||
      debug === 'god' ||
      debug === 'sandbox' ||
      debug === 'cards=all' ||
      getUrlParam('god') === '1' ||
      getUrlParam('cards') === 'all';
    if (debugEntersGame) {
      log.p1.info(`调试直进战斗：?debug=${debug}`);
      return SCENE_KEYS.GAME;
    }

    const target = getUrlParam('scene');
    if (!target) return SCENE_KEYS.TITLE;
    const map: Record<string, string> = {
      title: SCENE_KEYS.TITLE,
      slot: SCENE_KEYS.SLOT,
      menu: SCENE_KEYS.MENU,
      forge: SCENE_KEYS.FORGE,
      loadout: SCENE_KEYS.LOADOUT,
      stages: SCENE_KEYS.STAGES,
      game: SCENE_KEYS.GAME,
      tutorial: SCENE_KEYS.TUTORIAL,
      reward: SCENE_KEYS.REWARD,
      result: SCENE_KEYS.RESULT,
      sandbox: SCENE_KEYS.SANDBOX,
    };
    const key = map[target.toLowerCase()];
    if (!key) return SCENE_KEYS.TITLE;
    log.p1.info(`调试跳转：?scene=${target}`);
    return key;
  }

  private buildUi(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, PALETTE[0]).setOrigin(0).setDepth(DEPTH.FLOOR);
    addText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 96, '地牢卡牌', {
      fontSize: 48,
      color: PALETTE[6],
      align: 'center',
      bold: true,
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.TEXT);

    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, 420, 14, PALETTE[1])
      .setStrokeStyle(1, PALETTE[3])
      .setDepth(DEPTH.TEXT);
    this.barFill = this.add
      .rectangle(GAME_WIDTH / 2 - 210, GAME_HEIGHT / 2 + 10, 0, 10, PALETTE[12])
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.TEXT);

    this.statusText = addText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 46, '正在加载…', {
      fontSize: 15,
      color: PALETTE[4],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.TEXT);
  }

  private setProgress(value: number): void {
    if (!this.barFill) return;
    const clamped = Math.max(0, Math.min(1, value));
    this.barFill.width = 420 * clamped;
  }

  private showDataError(errors: string[]): void {
    const overlay = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, PALETTE[0], 0.96).setOrigin(0);
    overlay.setDepth(DEPTH.OVERLAY);
    addText(this, GAME_WIDTH / 2, 110, '数据校验失败', {
      fontSize: 30,
      color: PALETTE[7],
      align: 'center',
      bold: true,
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);
    addText(this, GAME_WIDTH / 2, 150, '请运行 npm run data:validate 查看完整报告', {
      fontSize: 15,
      color: PALETTE[4],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);

    const shown = errors
      .slice(0, 10)
      .map((error, index) => `${index + 1}. ${error}`)
      .join('\n');
    addText(this, 80, 200, shown, {
      fontSize: 14,
      color: PALETTE[5],
      wordWrap: GAME_WIDTH - 160,
    }).setDepth(DEPTH.OVERLAY + 1);

    if (errors.length > 10) {
      addText(this, 80, 620, `……另有 ${errors.length - 10} 条，见控制台`, {
        fontSize: 13,
        color: PALETTE[4],
      }).setDepth(DEPTH.OVERLAY + 1);
    }
  }
}
