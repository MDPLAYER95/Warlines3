import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MilitaryCampExecution implements Execution {
  private mg: Game;
  private camp: Unit | null = null;
  private active = true;

  constructor(
    private player: Player,
    private readonly tile: TileRef,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    if (this.camp === null) {
      const spawnTile = this.player.canBuild(UnitType.MilitaryCamp, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build Military Camp");
        this.active = false;
        return;
      }
      this.camp = this.player.buildUnit(UnitType.MilitaryCamp, spawnTile, {});
    }

    if (!this.camp.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.camp.owner()) {
      this.player = this.camp.owner();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
