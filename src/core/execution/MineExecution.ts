import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { TrainStationExecution } from "./TrainStationExecution";

export class MineExecution implements Execution {
  private mg: Game;
  private mine: Unit | null = null;
  private active = true;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    if (this.mine === null) {
      const spawnTile = this.player.canBuild(UnitType.Mine, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build mine");
        this.active = false;
        return;
      }
      this.mine = this.player.buildUnit(UnitType.Mine, spawnTile, {});
      this.createStation();
    }

    if (!this.mine.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.mine.owner()) {
      this.player = this.mine.owner();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private createStation(): void {
    if (this.mine === null) {
      return;
    }

    const unitInfo = this.mg.config().unitInfo(UnitType.Mine);
    if (!unitInfo.canBuildTrainStation) {
      return;
    }

    const nearbyFactory = this.mg.hasUnitNearby(
      this.mine.tile()!,
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.mine, true));
    }
  }
}
