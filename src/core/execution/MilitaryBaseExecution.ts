import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MilitaryBaseExecution implements Execution {
  private mg: Game;
  private base: Unit | null = null;
  private active = true;
  private trainingProgress = 0;
  private reservedCivilians = 0;
  private currentBatchSize = 0;
  private trainedThisBatch = 0;

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
    if (!this.base) {
      const spawnTile = this.player.canBuild(UnitType.MilitaryBase, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build Military Base");
        this.active = false;
        return;
      }
      this.base = this.player.buildUnit(UnitType.MilitaryBase, spawnTile, {});
    }

    if (!this.base.isActive()) {
      this.returnReserved();
      this.active = false;
      return;
    }

    if (this.player !== this.base.owner()) {
      this.returnReserved();
      this.player = this.base.owner();
      this.trainingProgress = 0;
      this.currentBatchSize = 0;
      this.trainedThisBatch = 0;
    }

    this.progressTraining();
  }

  private progressTraining(): void {
    if (!this.base) {
      return;
    }

    if (this.reservedCivilians === 0) {
      const capacity = this.mg.config().militaryBaseTrainingBatchSize();
      const available = this.player.civilians();
      if (available <= 0) {
        return;
      }
      const toReserve = Math.min(capacity, available);
      this.reservedCivilians = this.player.removeCivilians(toReserve);
      this.currentBatchSize = this.reservedCivilians;
      this.trainingProgress = 0;
      this.trainedThisBatch = 0;
    }

    if (this.reservedCivilians === 0) {
      return;
    }

    this.trainingProgress += 1;

    const duration = this.mg.config().militaryBaseTrainingDuration();

    if (duration <= 0) {
      if (this.reservedCivilians > 0) {
        this.player.addTroops(this.reservedCivilians);
        this.reservedCivilians = 0;
      }
      this.trainingProgress = 0;
      this.currentBatchSize = 0;
      this.trainedThisBatch = 0;
      return;
    }

    const produced = Math.floor(
      (this.trainingProgress * this.currentBatchSize) / duration,
    );
    const delta = produced - this.trainedThisBatch;

    if (delta > 0) {
      const toAdd = Math.min(delta, this.reservedCivilians);
      if (toAdd > 0) {
        this.player.addTroops(toAdd);
        this.reservedCivilians -= toAdd;
        this.trainedThisBatch += toAdd;
      }
    }

    if (this.trainingProgress >= duration) {
      if (this.reservedCivilians > 0) {
        this.player.addTroops(this.reservedCivilians);
        this.reservedCivilians = 0;
      }
      this.trainingProgress = 0;
      this.currentBatchSize = 0;
      this.trainedThisBatch = 0;
    }
  }

  private returnReserved(): void {
    if (this.reservedCivilians > 0) {
      this.player.addCivilians(this.reservedCivilians);
      this.reservedCivilians = 0;
    }
    this.trainingProgress = 0;
    this.currentBatchSize = 0;
    this.trainedThisBatch = 0;
  }
}
