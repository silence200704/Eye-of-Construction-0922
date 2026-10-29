export interface CueRenderer {
  start: () => Promise<void>;
  write: (data: ArrayBuffer) => Promise<number>;
  drain: () => Promise<void>;
  stop: () => Promise<void>;
  release: () => Promise<void>;
}

export function cueBytes(): ArrayBuffer {
  const samples = new Int16Array(2400);
  for (let i = 0; i < samples.length; i++) {
    const fade = Math.min(1, i / 160, (samples.length - 1 - i) / 160);
    samples[i] = Math.round(1800 * fade * Math.sin(2 * Math.PI * 660 * i / 16000));
  }
  return samples.buffer;
}

export class SoundCue {
  private factory: () => Promise<CueRenderer>;
  private renderer: CueRenderer | null = null;
  private generation: number = 0;
  constructor(factory: () => Promise<CueRenderer>) { this.factory = factory; }
  async stop(): Promise<void> {
    this.generation++;
    const renderer = this.renderer; this.renderer = null;
    if (renderer) { try { await renderer.stop(); } finally { await renderer.release(); } }
  }
  async play(): Promise<number> {
    await this.stop(); const generation = this.generation;
    const renderer = await this.factory();
    if (generation !== this.generation) { await renderer.release(); return 0; }
    this.renderer = renderer;
    try {
      await renderer.start(); const bytes = cueBytes(); let offset = 0;
      while (offset < bytes.byteLength && generation === this.generation) {
        const written = await renderer.write(bytes.slice(offset));
        if (written <= 0) throw new Error('提示音输出暂不可用。');
        offset += written;
      }
      if (generation === this.generation) await renderer.drain();
      return offset;
    } finally { if (this.renderer === renderer) await this.stop(); }
  }
}
