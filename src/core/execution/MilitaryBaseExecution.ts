import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MilitaryBaseExecution implements Execution {
  private mg!: Game;
  private base: Unit | null = null;
  private active = true;

  constructor(
    private player: Player,
    private readonly tile: TileRef,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  isActive(): boolean {
    return this.active;
  }

  tick(_ticks: number): void {
    if (!this.ensureBase()) {
      return;
    }

    if (!this.base?.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.base.owner()) {
      this.player = this.base.owner();
    }

    this.trainSoldiers();
  }

  private ensureBase(): boolean {
    if (this.base) {
      return true;
    }

    const spawnTile = this.player.canBuild(UnitType.MilitaryBase, this.tile);
    if (spawnTile === false) {
      console.warn("cannot build Military Base");
      this.active = false;
      return false;
    }

    this.base = this.player.buildUnit(UnitType.MilitaryBase, spawnTile, {});
    return true;
  }

  private trainSoldiers(): void {
    const ratePerBase = this.mg.config().militaryBaseTrainingRatePerTick();
    if (ratePerBase <= 0) {
      return;
    }

    const maxPopulation = this.mg.config().maxTroops(this.player);
    const population = this.player.population();
    const civilians = this.player.civilians();

    const availableSpace = Math.max(0, maxPopulation - population);
    if (availableSpace <= 0 || civilians <= 0) {
      return;
    }

    const toTrain = Math.min(ratePerBase, civilians, availableSpace);
    if (toTrain <= 0) {
      return;
    }

    this.player.trainSoldiers(toTrain);
  }
}
