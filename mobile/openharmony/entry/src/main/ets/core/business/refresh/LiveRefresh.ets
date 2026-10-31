export interface RefreshClock { schedule: (work: () => void, delay: number) => number; cancel: (id: number) => void; }
export interface RefreshOptions { read: () => Promise<void>; clock?: RefreshClock; }
export class LiveRefresh {
  private options: RefreshOptions;
  private clock: RefreshClock;
  private timer: number = -1;
  private generation: number = 0;
  private active: boolean = false;
  private busy: boolean = false;
  private delay: number = 5000;
  constructor(options: RefreshOptions) {
    this.options = options;
    this.clock = options.clock ?? { schedule: (work, delay) => setTimeout(work, delay), cancel: (id) => clearTimeout(id) };
  }
  async start(): Promise<void> { if (!this.active) { this.active = true; this.generation++; } await this.tick(); }
  stop(): void { this.active = false; this.generation++; if (this.timer >= 0) this.clock.cancel(this.timer); this.timer = -1; }
  async tick(): Promise<void> {
    if (!this.active || this.busy) return;
    if (this.timer >= 0) this.clock.cancel(this.timer);
    const generation = this.generation; this.busy = true;
    try { await this.options.read(); this.delay = 5000; }
    catch (_) { this.delay = Math.min(30000, this.delay * 2); }
    finally {
      this.busy = false;
      if (this.active) this.timer = this.clock.schedule(() => { void this.tick(); }, generation === this.generation ? this.delay : 0);
    }
  }
}
