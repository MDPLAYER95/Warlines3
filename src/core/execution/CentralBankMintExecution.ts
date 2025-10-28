import { Execution, Game, Gold, Player, UnitType } from "../game/Game";

export class CentralBankMintExecution implements Execution {
  private mg: Game;
  private active = true;
  private readonly requested: bigint;

  constructor(
    private readonly player: Player,
    private readonly bankId: number,
    amount: number,
  ) {
    const normalized = Number.isFinite(amount)
      ? Math.max(0, Math.floor(amount))
      : 0;
    this.requested = BigInt(normalized);
  }

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    if (!this.active) {
      return;
    }
    this.active = false;

    const bank = this.player
      .units(UnitType.CentralBank)
      .find((unit) => unit.id() === this.bankId);
    if (!bank || !bank.isActive() || bank.owner() !== this.player) {
      return;
    }

    if (this.player.centralBankPrintsRemaining() <= 0) {
      return;
    }

    const capPercent = this.mg.config().centralBankMintCapPercent();
    if (capPercent <= 0) {
      return;
    }

    const totalEarned = this.player.totalGoldEarned();
    const allowed = (totalEarned * BigInt(capPercent)) / 100n;
    if (allowed <= 0n) {
      return;
    }

    const mintAmount: Gold =
      this.requested <= allowed ? this.requested : allowed;
    if (mintAmount <= 0n) {
      return;
    }

    this.player.applyCentralBankMint(mintAmount);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
