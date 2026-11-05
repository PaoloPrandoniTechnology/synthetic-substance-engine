export interface SessionSnapshot {
  substanceId: string;
  startedAt: number;
  dose: number;
  /** Quante richieste sono state fatte in questa sessione. */
  uses: number;
}

/**
 * Stato minimo delle sessioni di dosaggio: quando la sostanza è iniziata.
 * Volutamente in memoria (M3): se il proxy si riavvia, la "somministrazione" riparte.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionSnapshot>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxSessions = 1000,
  ) {}

  /**
   * Restituisce il tempo trascorso dall'inizio della sostanza per la sessione.
   * Una nuova sessione (o un cambio di sostanza) parte da 0 secondi.
   */
  resolve(sessionKey: string, substanceId: string, dose: number): { elapsedSeconds: number } {
    const timestamp = this.now();
    const existing = this.sessions.get(sessionKey);

    if (!existing || existing.substanceId !== substanceId) {
      this.sessions.set(sessionKey, { substanceId, startedAt: timestamp, dose, uses: 1 });
      this.evictIfNeeded();
      return { elapsedSeconds: 0 };
    }

    existing.dose = dose;
    existing.uses += 1;
    return { elapsedSeconds: Math.max(0, (timestamp - existing.startedAt) / 1000) };
  }

  snapshot(sessionKey: string): SessionSnapshot | undefined {
    return this.sessions.get(sessionKey);
  }

  elapsedFor(sessionKey: string): number | undefined {
    const snapshot = this.sessions.get(sessionKey);
    if (!snapshot) {
      return undefined;
    }
    return Math.max(0, (this.now() - snapshot.startedAt) / 1000);
  }

  reset(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }

  get size(): number {
    return this.sessions.size;
  }

  private evictIfNeeded(): void {
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next();
      if (oldest.done) {
        return;
      }
      this.sessions.delete(oldest.value);
    }
  }
}
