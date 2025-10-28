import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class CentralBankExecution implements Execution {
  private mg: Game;
  private bank: Unit | null = null;
  private active = true;

  constructor(
    private player: Player,
    private readonly tile: TileRef,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    if (this.bank === null) {
      const spawnTile = this.player.canBuild(UnitType.CentralBank, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build Central Bank");
        this.active = false;
        return;
      }
      this.bank = this.player.buildUnit(UnitType.CentralBank, spawnTile, {});
    }

    if (!this.bank.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.bank.owner()) {
      this.player = this.bank.owner();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
