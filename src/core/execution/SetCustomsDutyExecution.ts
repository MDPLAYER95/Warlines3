import { Execution, Game, Player } from "../game/Game";

export class SetCustomsDutyExecution implements Execution {
  private active = true;

  constructor(
    private readonly player: Player,
    private readonly category: "allies" | "others",
    private readonly rate: number,
  ) {}

  init(_mg: Game, _ticks: number): void {
    if (this.category === "allies") {
      this.player.setAlliedCustomsRate(this.rate);
    } else {
      this.player.setOtherCustomsRate(this.rate);
    }
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
