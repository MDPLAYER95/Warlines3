import { Execution, Game, Player, UnitType } from "../game/Game";

export class AssignDefensePostTroopsExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  constructor(
    private readonly player: Player,
    private readonly unitId: number,
    private readonly requestedTroops: number,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    if (!this.active || this.mg === null) {
      return;
    }
    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    const unit = this.player
      .units(UnitType.DefensePost)
      .find((u) => u.id() === this.unitId && u.isActive());
    if (!unit || unit.owner() !== this.player) {
      this.active = false;
      return;
    }

    const config = this.mg.config();
    const capacity = Math.max(
      0,
      config.defensePostMaxGarrison() - unit.troops(),
    );
    if (capacity <= 0) {
      this.active = false;
      return;
    }

    const requested = Math.max(0, Math.floor(this.requestedTroops));
    if (requested <= 0) {
      this.active = false;
      return;
    }

    const removed = this.player.removeTroops(Math.min(capacity, requested));
    if (removed <= 0) {
      this.active = false;
      return;
    }

    unit.setTroops(unit.troops() + removed);
    unit.touch();

    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

export class WithdrawDefensePostTroopsExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  constructor(
    private readonly player: Player,
    private readonly unitId: number,
    private readonly requestedTroops: number,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    if (!this.active || this.mg === null) {
      return;
    }

    const unit = this.player
      .units(UnitType.DefensePost)
      .find((u) => u.id() === this.unitId && u.isActive());
    if (!unit || unit.owner() !== this.player) {
      this.active = false;
      return;
    }

    const requested = Math.max(0, Math.floor(this.requestedTroops));
    if (requested <= 0) {
      this.active = false;
      return;
    }

    const toWithdraw = Math.min(unit.troops(), requested);
    if (toWithdraw <= 0) {
      this.active = false;
      return;
    }

    unit.setTroops(unit.troops() - toWithdraw);
    unit.touch();
    this.player.addTroops(toWithdraw);

    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
