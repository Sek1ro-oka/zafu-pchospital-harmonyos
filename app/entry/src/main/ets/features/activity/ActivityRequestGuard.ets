import { SessionService } from '../../core/auth/SessionService';
import { SessionIdentity } from '../../core/auth/AuthContract';
/** A late request may only update the page generation and session that started it. */
export class ActivityRequestGuard {
  private generation: number = 0;
  private identity: SessionIdentity | null = null;
  begin(): number { this.identity = SessionService.current(); return ++this.generation; }
  current(ticket: number): boolean { return ticket === this.generation && this.identity === SessionService.current(); }
  invalidate(): void { this.generation += 1; }
}
