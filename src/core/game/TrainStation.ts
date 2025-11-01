import { TrainExecution } from "../execution/TrainExecution";
import { GraphAdapter } from "../pathfinding/SerialAStar";
import { PseudoRandom } from "../PseudoRandom";
import { Game, LogisticsContext, Player, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType, RailTile, RailType } from "./GameUpdates";
import { Railroad } from "./Railroad";

/**
 * Handle train stops at various station types
 */
interface TrainStopHandler {
  onStop(mg: Game, station: TrainStation, trainExecution: TrainExecution): void;
}

/**
 * All stop handlers share the same logic for the time being
 * Behavior to be defined
 */
class CityStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    const type = station.unit.type();
    const context: LogisticsContext = type === UnitType.Mine ? "mine" : "city";
    processTrainEconomy(mg, station, trainExecution, context);
  }
}

class PortStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    processTrainEconomy(mg, station, trainExecution, "port");
  }
}

class FactoryStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    processTrainEconomy(mg, station, trainExecution, "factory");
  }
}

export function createTrainStopHandlers(
  _random: PseudoRandom,
): Partial<Record<UnitType, TrainStopHandler>> {
  return {
    [UnitType.City]: new CityStopHandler(),
    [UnitType.Mine]: new CityStopHandler(),
    [UnitType.Port]: new PortStopHandler(),
    [UnitType.Factory]: new FactoryStopHandler(),
  };
}

function processTrainEconomy(
  mg: Game,
  station: TrainStation,
  trainExecution: TrainExecution,
  context: LogisticsContext,
): void {
  const stationOwner = station.unit.owner();
  const trainOwner = trainExecution.owner();
  const relationLabel = rel(trainOwner, stationOwner);

  const baseGold = mg.config().trainGold(relationLabel);
  const stationSharePercent = mg
    .config()
    .economyStationShare(station.unit.type());

  let visitorGain = baseGold;
  let ownerGain = 0n;

  if (trainOwner !== stationOwner && stationSharePercent > 0) {
    const share = (visitorGain * BigInt(stationSharePercent)) / 100n;
    if (share > 0n) {
      visitorGain -= share;
      ownerGain += share;
    }
  }

  if (trainOwner !== stationOwner) {
    const customsRate = mg.config().economyCustomsDuty(relationLabel);
    if (customsRate > 0) {
      const customs = (visitorGain * BigInt(customsRate)) / 100n;
      if (customs > 0n) {
        visitorGain -= customs;
        ownerGain += customs;
        trainOwner.economy().recordCustomsPayment(customs);
        stationOwner.economy().recordCustomsRevenue(customs);
      }
    }
  }

  const logisticGold = BigInt(
    Math.max(
      0,
      mg
        .config()
        .economyTrainCargoValue(
          station.unit.type(),
          station.unit.level(),
          trainExecution.cargoCapacity(),
        ),
    ),
  );

  let visitorLogistics = logisticGold;
  let ownerLogistics = 0n;

  if (trainOwner !== stationOwner && logisticGold > 0n) {
    const logisticsShare =
      (logisticGold * BigInt(Math.max(0, stationSharePercent))) / 100n;
    ownerLogistics = logisticsShare;
    visitorLogistics = logisticGold - logisticsShare;
  }

  if (visitorLogistics > 0n) {
    trainOwner.economy().registerLogisticsBonus(visitorLogistics, context);
  }
  if (ownerLogistics > 0n) {
    stationOwner.economy().registerLogisticsBonus(ownerLogistics, context);
  }

  trainOwner.addGold(visitorGain, station.tile());
  if (ownerGain > 0n) {
    stationOwner.addGold(ownerGain, station.tile());
  }
}

export class TrainStation {
  private readonly stopHandlers: Partial<Record<UnitType, TrainStopHandler>> =
    {};
  private cluster: Cluster | null;
  private railroads: Set<Railroad> = new Set();

  constructor(
    private mg: Game,
    public unit: Unit,
  ) {
    this.stopHandlers = createTrainStopHandlers(new PseudoRandom(mg.ticks()));
  }

  tradeAvailable(otherPlayer: Player): boolean {
    const player = this.unit.owner();
    return otherPlayer === player || player.canTrade(otherPlayer);
  }

  clearRailroads() {
    this.railroads.clear();
  }

  addRailroad(railRoad: Railroad) {
    this.railroads.add(railRoad);
  }

  removeNeighboringRails(station: TrainStation) {
    const toRemove = [...this.railroads].find(
      (r) => r.from === station || r.to === station,
    );
    if (toRemove) {
      const railTiles: RailTile[] = toRemove.tiles.map((tile) => ({
        tile,
        railType: RailType.VERTICAL,
      }));
      this.mg.addUpdate({
        type: GameUpdateType.RailroadEvent,
        isActive: false,
        railTiles,
      });
      this.railroads.delete(toRemove);
    }
  }

  neighbors(): TrainStation[] {
    const neighbors: TrainStation[] = [];
    for (const r of this.railroads) {
      if (r.from !== this) {
        neighbors.push(r.from);
      } else {
        neighbors.push(r.to);
      }
    }
    return neighbors;
  }

  tile(): TileRef {
    return this.unit.tile();
  }

  isActive(): boolean {
    return this.unit.isActive();
  }

  getRailroads(): Set<Railroad> {
    return this.railroads;
  }

  setCluster(cluster: Cluster | null) {
    this.cluster = cluster;
  }

  getCluster(): Cluster | null {
    return this.cluster;
  }

  onTrainStop(trainExecution: TrainExecution) {
    const type = this.unit.type();
    const handler = this.stopHandlers[type];
    if (handler) {
      handler.onStop(this.mg, this, trainExecution);
    }
  }
}

/**
 * Make the trainstation usable with A*
 */
export class TrainStationMapAdapter implements GraphAdapter<TrainStation> {
  constructor(private game: Game) {}

  neighbors(node: TrainStation): TrainStation[] {
    return node.neighbors();
  }

  cost(node: TrainStation): number {
    return 1;
  }

  position(node: TrainStation): { x: number; y: number } {
    return { x: this.game.x(node.tile()), y: this.game.y(node.tile()) };
  }

  isTraversable(from: TrainStation, to: TrainStation): boolean {
    return true;
  }
}

/**
 * Cluster of connected stations
 */
export class Cluster {
  public stations: Set<TrainStation> = new Set();

  has(station: TrainStation) {
    return this.stations.has(station);
  }

  addStation(station: TrainStation) {
    this.stations.add(station);
    station.setCluster(this);
  }

  removeStation(station: TrainStation) {
    this.stations.delete(station);
  }

  addStations(stations: Set<TrainStation>) {
    for (const station of stations) {
      this.addStation(station);
    }
  }

  merge(other: Cluster) {
    for (const s of other.stations) {
      this.addStation(s);
    }
  }

  availableForTrade(player: Player): Set<TrainStation> {
    const tradingStations = new Set<TrainStation>();
    for (const station of this.stations) {
      if (
        (station.unit.type() === UnitType.City ||
          station.unit.type() === UnitType.Port) &&
        station.tradeAvailable(player)
      ) {
        tradingStations.add(station);
      }
    }
    return tradingStations;
  }

  size() {
    return this.stations.size;
  }

  clear() {
    this.stations.clear();
  }
}

function rel(
  player: Player,
  other: Player,
): "self" | "team" | "ally" | "other" {
  if (player === other) {
    return "self";
  }
  if (player.isOnSameTeam(other)) {
    return "team";
  }
  if (player.isAlliedWith(other)) {
    return "ally";
  }
  return "other";
}
