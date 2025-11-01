import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { TrainStationExecution } from "./TrainStationExecution";

export class PortExecution implements Execution {
  private active = true;
  private mg: Game;
  private port: Unit | null = null;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null) {
      throw new Error("Not initialized");
    }
    if (this.port === null) {
      const tile = this.tile;
      const spawn = this.player.canBuild(UnitType.Port, tile);
      if (spawn === false) {
        console.warn(
          `player ${this.player.id()} cannot build port at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.port = this.player.buildUnit(UnitType.Port, spawn, {});
      this.createStation();
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    if (this.player.id() !== this.port.owner().id()) {
      this.player = this.port.owner();
    }

    // Ports no longer spawn autonomous trade ships; maritime transport is
    // orchestrated through logistics expeditions.
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  createStation(): void {
    if (this.port !== null && !this.port.hasTrainStation()) {
      this.mg.addExecution(new TrainStationExecution(this.port));
    }
  }
}
