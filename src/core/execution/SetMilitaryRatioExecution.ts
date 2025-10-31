import { Execution, Game, Player } from "../game/Game";

export class SetMilitaryRatioExecution implements Execution {
  private active = true;

  constructor(
    private readonly player: Player,
    private readonly targetRatio: number,
  ) {}

  init(_mg: Game, _ticks: number): void {
    const clamped = Math.max(
      0,
      Math.min(this.targetRatio, this.player.maxMilitaryRatio()),
    );
    this.player.setMilitaryRatioTarget(clamped);
    this.active = false;
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
