// Co AI právě dělá – pro živý stav v panelu. Každá práce jde zastavit.
import * as vscode from 'vscode';

export type JobKind = 'tab' | 'fn' | 'instr' | 'alt' | 'ideas' | 'cmd';

export interface Job {
  id: number;
  kind: JobKind;
  label: string;
  started: number;
  tokens: number;
  abort?: () => void;
}

export class Activity {
  private seq = 0;
  private jobs = new Map<number, Job>();
  private em = new vscode.EventEmitter<void>();
  readonly onChange = this.em.event;
  private timer?: NodeJS.Timeout;

  start(kind: JobKind, label: string, abort?: () => void): number {
    const id = ++this.seq;
    this.jobs.set(id, { id, kind, label, started: Date.now(), tokens: 0, abort });
    this.fire(true);
    return id;
  }

  tick(id: number, n = 1): void {
    const j = this.jobs.get(id);
    if (!j) return;
    j.tokens += n;
    this.fire(false);
  }

  end(id: number): void {
    if (this.jobs.delete(id)) this.fire(true);
  }

  /** Zastaví všechno kromě rychlých Tab návrhů (ty se zastaví samy dalším psaním). */
  stopAll(): void {
    for (const j of this.jobs.values()) if (j.kind !== 'tab') j.abort?.();
  }

  list(): Omit<Job, 'abort'>[] {
    return [...this.jobs.values()].map(({ abort: _a, ...j }) => j);
  }

  private fire(now: boolean): void {
    if (now) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      this.em.fire();
      return;
    }
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.em.fire();
      }, 300);
  }
}
