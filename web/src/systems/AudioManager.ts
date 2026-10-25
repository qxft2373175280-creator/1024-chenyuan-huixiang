/**
 * 音频管理 —— 全部 WebAudio 合成，零音频资源依赖
 * 负责人：P1
 *
 * 特点：
 *  - 音效：短促振荡器包络（16 个 key，见 core/keys.ts）
 *  - BGM：把一整段琶音「烘焙」成 AudioBuffer 循环播放（不用定时器，暂停/切歌无漂移）
 *  - 静音状态落存档；浏览器自动播放策略由 unlock() 在首次交互时解除
 */
import type { IAudioService, ISaveService } from '../core/contracts';
import type { BgmKey, SfxKey } from '../core/keys';
import { log } from '../core/logger';

type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

interface SfxSpec {
  wave: Wave;
  from: number;
  to: number;
  durationMs: number;
  gain: number;
}

interface BgmSpec {
  notes: number[];
  stepMs: number;
  wave: Wave;
  gain: number;
}

/** 18 条音效曲线（对应《方案文档.md》§5.3.9；末 2 条为 PARRY-01 弹反） */
const SFX_SPECS: Record<SfxKey, SfxSpec> = {
  sfx_ui_click: { wave: 'square', from: 880, to: 660, durationMs: 60, gain: 0.16 },
  sfx_swing: { wave: 'sawtooth', from: 300, to: 120, durationMs: 100, gain: 0.18 },
  sfx_shot: { wave: 'square', from: 700, to: 300, durationMs: 70, gain: 0.14 },
  sfx_hit: { wave: 'square', from: 420, to: 180, durationMs: 60, gain: 0.18 },
  sfx_crit: { wave: 'square', from: 1200, to: 400, durationMs: 120, gain: 0.2 },
  sfx_player_hurt: { wave: 'sawtooth', from: 220, to: 80, durationMs: 180, gain: 0.24 },
  sfx_enemy_die: { wave: 'triangle', from: 400, to: 100, durationMs: 160, gain: 0.16 },
  sfx_pickup: { wave: 'sine', from: 900, to: 1400, durationMs: 80, gain: 0.14 },
  sfx_chest: { wave: 'sine', from: 700, to: 1050, durationMs: 200, gain: 0.16 },
  sfx_levelup: { wave: 'sine', from: 660, to: 1320, durationMs: 300, gain: 0.18 },
  sfx_evolve: { wave: 'sawtooth', from: 200, to: 1600, durationMs: 700, gain: 0.2 },
  sfx_card: { wave: 'square', from: 520, to: 780, durationMs: 120, gain: 0.16 },
  sfx_boss_roar: { wave: 'sawtooth', from: 90, to: 45, durationMs: 900, gain: 0.26 },
  sfx_room_clear: { wave: 'sine', from: 523, to: 784, durationMs: 350, gain: 0.18 },
  sfx_lose: { wave: 'triangle', from: 400, to: 120, durationMs: 600, gain: 0.2 },
  sfx_win: { wave: 'square', from: 523, to: 1046, durationMs: 600, gain: 0.2 },
  // 弹反窗口开启：短促上滑的高音「叮」，要能在混战中穿透
  sfx_parry_ready: { wave: 'triangle', from: 1320, to: 1760, durationMs: 90, gain: 0.22 },
  // 弹反成功：金属撞击 + 下坠余音
  sfx_parry_success: { wave: 'square', from: 1760, to: 440, durationMs: 260, gain: 0.24 },
};

/** 三段 BGM（A 小调琶音，8-bit 风格） */
const BGM_SPECS: Record<BgmKey, BgmSpec> = {
  bgm_menu: {
    notes: [440, 523.25, 659.25, 523.25, 440, 392, 440, 523.25],
    stepMs: 340,
    wave: 'triangle',
    gain: 0.1,
  },
  bgm_dungeon: {
    notes: [220, 261.63, 196, 246.94, 220, 174.61, 196, 220],
    stepMs: 420,
    wave: 'triangle',
    gain: 0.09,
  },
  bgm_boss: {
    notes: [110, 146.83, 164.81, 146.83, 110, 123.47, 146.83, 164.81],
    stepMs: 220,
    wave: 'square',
    gain: 0.07,
  },
};

export class AudioManager implements IAudioService {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private bgm: { source: AudioBufferSourceNode; key: BgmKey } | null = null;
  private lastBgmKey: BgmKey | null = null;
  private muted: boolean;

  constructor(private readonly saveService: ISaveService) {
    this.muted = this.saveService.get().settings.muted;
  }

  /** 首次用户交互后调用，解除浏览器自动播放限制 */
  unlock(): void {
    const context = this.ensureContext();
    if (context && context.state === 'suspended') {
      void context.resume();
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    try {
      const AudioContextCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        log.p1.warn('当前浏览器不支持 WebAudio，音效已禁用');
        return null;
      }
      const context = new AudioContextCtor();
      const master = context.createGain();
      master.gain.value = this.muted ? 0 : 0.9;
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      return context;
    } catch (error) {
      log.p1.warn('WebAudio 初始化失败，音效已禁用', error);
      return null;
    }
  }

  play(key: SfxKey, volume = 1): void {
    if (this.muted) return;
    const context = this.ensureContext();
    if (!context || !this.master) return;
    const spec = SFX_SPECS[key];
    if (!spec) return;
    const now = context.currentTime;
    const durationSec = spec.durationMs / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = spec.wave;
    oscillator.frequency.setValueAtTime(spec.from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, spec.to), now + durationSec);
    const peak = Math.max(0.0001, spec.gain * volume);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + durationSec + 0.02);
  }

  playBgm(key: BgmKey): void {
    this.lastBgmKey = key;
    if (this.muted) return;
    if (this.bgm?.key === key) return;
    const context = this.ensureContext();
    if (!context || !this.master) return;
    this.stopBgm();
    const spec = BGM_SPECS[key];
    const buffer = this.renderLoop(context, spec);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = spec.gain;
    source.connect(gain);
    gain.connect(this.master);
    source.start();
    this.bgm = { source, key };
  }

  stopBgm(): void {
    if (!this.bgm) return;
    try {
      this.bgm.source.stop();
      this.bgm.source.disconnect();
    } catch {
      // 已经停止的 source 再次 stop 会抛错，忽略
    }
    this.bgm = null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.saveService.get().settings.muted = muted;
    this.saveService.commit();
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.context.currentTime, 0.02);
    }
    if (muted) {
      this.stopBgm();
    } else if (this.lastBgmKey) {
      this.playBgm(this.lastBgmKey);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** 把整段琶音渲染成可无缝循环的 AudioBuffer */
  private renderLoop(context: AudioContext, spec: BgmSpec): AudioBuffer {
    const sampleRate = context.sampleRate;
    const stepSec = spec.stepMs / 1000;
    const stepSamples = Math.floor(stepSec * sampleRate);
    const totalSamples = stepSamples * spec.notes.length;
    const buffer = context.createBuffer(1, totalSamples, sampleRate);
    const data = buffer.getChannelData(0);

    for (let noteIndex = 0; noteIndex < spec.notes.length; noteIndex++) {
      const frequency = spec.notes[noteIndex];
      const offset = noteIndex * stepSamples;
      for (let i = 0; i < stepSamples; i++) {
        const t = i / sampleRate;
        const progress = i / stepSamples;
        const envelope = Math.min(1, progress * 24) * Math.pow(1 - progress, 2);
        const phase = 2 * Math.PI * frequency * t;
        let sample: number;
        if (spec.wave === 'square') {
          sample = Math.sin(phase) >= 0 ? 1 : -1;
        } else if (spec.wave === 'sawtooth') {
          sample = 2 * ((phase / (2 * Math.PI)) % 1) - 1;
        } else if (spec.wave === 'triangle') {
          sample = 2 * Math.abs(2 * ((phase / (2 * Math.PI)) % 1) - 1) - 1;
        } else {
          sample = Math.sin(phase);
        }
        data[offset + i] += sample * envelope * 0.5;
      }
    }
    return buffer;
  }
}
