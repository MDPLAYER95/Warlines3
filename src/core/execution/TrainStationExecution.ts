import { ScheduledShipment } from "../game/EconomyManager";
import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TrainStation } from "../game/TrainStation";
import { LogisticsExpeditionExecution } from "./LogisticsExpeditionExecution";

export class TrainStationExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private station: TrainStation | null = null;
  private numCars: number = 5;
  private lastSpawnTick: number = 0;
  private ticksCooldown: number = 0;
  private readonly spawnOverride?: boolean;
  private shouldSpawn: boolean = false;
  constructor(
    private unit: Unit,
    spawnTrains?: boolean, // If set, the station will spawn trains
  ) {
    this.unit.setTrainStation(true);
    this.spawnOverride = spawnTrains;
  }

  isActive(): boolean {
    return this.active;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.shouldSpawn =
      this.spawnOverride ?? this.defaultSpawnBehavior(this.unit.type());
  }

  tick(ticks: number): void {
    if (this.mg === undefined) {
      throw new Error("Not initialized");
    }
    if (!this.isActive() || this.unit === undefined) {
      return;
    }
    if (this.station === null) {
      // Can't create new executions on init, so it has to be done in the tick
      this.station = new TrainStation(this.mg, this.unit);
      this.mg.economy().registerStation(this.station);
      this.mg.railNetwork().connectStation(this.station);
    }
    if (!this.station.isActive()) {
      this.mg.economy().unregisterStation(this.station);
      this.active = false;
      return;
    }
    this.spawnTrain(this.station, ticks);
  }

  private spawnTrain(station: TrainStation, currentTick: number) {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (!this.shouldSpawn) return;
    if (currentTick < this.lastSpawnTick + this.ticksCooldown) return;
    const shipment = this.mg.economy().requestShipment(station);
    if (!shipment) {
      return;
    }
    this.dispatchShipment(shipment);
    this.lastSpawnTick = currentTick;
  }

  private dispatchShipment(shipment: ScheduledShipment) {
    this.mg.addExecution(
      new LogisticsExpeditionExecution(
        shipment.player,
        shipment.path,
        this.numCars,
        shipment.expedition,
        shipment.onDelivered,
        shipment.onAbort,
      ),
    );
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private defaultSpawnBehavior(type: UnitType): boolean {
    switch (type) {
      case UnitType.Mine:
      case UnitType.Factory:
        return true;
      default:
        return false;
    }
  }
}
