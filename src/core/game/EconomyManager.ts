import { PseudoRandom } from "../PseudoRandom";
import type { Game, Gold, Player, Tick } from "./Game";
import { UnitType } from "./Game";
import type { TileRef } from "./GameMap";
import type { EconomyExpeditionUpdate } from "./GameUpdates";
import { GameUpdateType } from "./GameUpdates";
import { getOrientedRailroad } from "./Railroad";
import type { TrainStation } from "./TrainStation";

export type RawMaterial = bigint;

export type CustomsRelation = "ally" | "other";

export interface CustomsCharge {
  owner: Player;
  relation: CustomsRelation;
  ratePercent: number;
  amount: Gold;
}

export interface RouteDiversitySnapshot {
  worldPathCount: number;
  playerPathCount: number;
  ratio: number;
  penaltyPercent: number;
  bonusPercent: number;
  appliedPercent: number;
}

export interface PlayerEconomySnapshot {
  rawMaterialStock: RawMaterial;
  goldStock: Gold;
  trainCapacityAvailable: Gold;
  trainCapacityTotal: Gold;
  seaCapacityAvailable: Gold;
  seaCapacityTotal: Gold;
  diversity: RouteDiversitySnapshot;
}

export interface ExpeditionReport {
  id: number;
  player: Player;
  source: TrainStation;
  destination: TrainStation;
  path: TrainStation[];
  initialGold: Gold;
  customs: CustomsCharge[];
  deliveredGold: Gold;
  creditedGold: Gold;
  hadSeaSegment: boolean;
  diversity: RouteDiversitySnapshot;
}

export type LogisticsCargoType = "raw" | "gold";

export interface ScheduledShipment {
  player: Player;
  path: TrainStation[];
  load: bigint;
  cargo: LogisticsCargoType;
  expedition: ExpeditionReport | null;
  onDelivered: () => void;
  onAbort: () => void;
}

interface PlayerEconomyState {
  trainCapacityAvailable: Gold;
  trainCapacityTotal: Gold;
  seaCapacityAvailable: Gold;
  seaCapacityTotal: Gold;
  lastTick: Tick;
  recentRoutes: Array<{ hash: string; tick: Tick }>;
}

interface MineEconomyState {
  stock: RawMaterial;
}

interface FactoryEconomyState {
  rawStock: RawMaterial;
  goldStock: Gold;
}

function bigIntMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function clampPercent(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class EconomyManager {
  private readonly stations: Set<TrainStation> = new Set();
  private readonly playerStates: Map<Player, PlayerEconomyState> = new Map();
  private readonly mineStates: Map<TrainStation, MineEconomyState> = new Map();
  private readonly factoryStates: Map<TrainStation, FactoryEconomyState> =
    new Map();
  private readonly pendingShipments: Map<TrainStation, ScheduledShipment[]> =
    new Map();
  private nextExpeditionId = 1;
  private lastTickProcessed: Tick = 0;
  private cachedWorldPathCount = 0;

  constructor(private readonly game: Game) {}

  registerStation(station: TrainStation): void {
    this.stations.add(station);
    const type = station.unit.type();
    if (type === UnitType.Mine) {
      if (!this.mineStates.has(station)) {
        this.mineStates.set(station, { stock: 0n });
      }
    } else if (type === UnitType.Factory) {
      if (!this.factoryStates.has(station)) {
        this.factoryStates.set(station, { rawStock: 0n, goldStock: 0n });
      }
    }
    if (!this.pendingShipments.has(station)) {
      this.pendingShipments.set(station, []);
    }
  }

  unregisterStation(station: TrainStation): void {
    this.stations.delete(station);
    this.mineStates.delete(station);
    this.factoryStates.delete(station);
    this.pendingShipments.delete(station);
  }

  tick(currentTick: Tick): void {
    if (currentTick <= this.lastTickProcessed) {
      return;
    }
    const delta = BigInt(currentTick - this.lastTickProcessed);
    this.lastTickProcessed = currentTick;

    this.removeInactiveStations();
    this.produceRawMaterials(delta);
    this.convertFactoryStock(delta);
    this.recomputePlayerCapacities(delta);
    this.cachedWorldPathCount = this.computeWorldPathCount();

    const random = new PseudoRandom(currentTick);
    this.scheduleRawShipments(random);
    this.scheduleGoldShipments(random);
  }

  requestShipment(station: TrainStation): ScheduledShipment | null {
    const queue = this.pendingShipments.get(station);
    if (!queue || queue.length === 0) {
      return null;
    }
    while (queue.length > 0) {
      const shipment = queue.shift()!;
      if (shipment.player === station.unit.owner()) {
        return shipment;
      }
      shipment.onAbort();
    }
    return null;
  }

  completeExpedition(expedition: ExpeditionReport): void {
    for (const charge of expedition.customs) {
      charge.owner.addGold(charge.amount);
    }
    expedition.player.addGold(
      expedition.creditedGold,
      expedition.destination.tile(),
    );
    const update: EconomyExpeditionUpdate = {
      type: GameUpdateType.EconomyExpeditionEvent,
      report: this.serializeExpedition(expedition),
    };
    this.game.addUpdate(update);
  }

  playerSnapshot(player: Player): PlayerEconomySnapshot {
    this.tick(this.game.ticks());
    const state = this.ensurePlayerState(player);
    return {
      rawMaterialStock: this.totalRawMaterial(player),
      goldStock: this.totalGoldStock(player),
      trainCapacityAvailable: state.trainCapacityAvailable,
      trainCapacityTotal: state.trainCapacityTotal,
      seaCapacityAvailable: state.seaCapacityAvailable,
      seaCapacityTotal: state.seaCapacityTotal,
      diversity: this.updateRouteDiversity(player, []),
    };
  }

  updateCustomsRate(
    _player: Player,
    _relation: CustomsRelation,
    _rate: number,
  ) {
    // Handled by player implementation, but method retained for compatibility
  }

  worldPathCount(): number {
    return this.cachedWorldPathCount;
  }

  private removeInactiveStations(): void {
    for (const station of [...this.stations]) {
      if (!station.isActive()) {
        this.unregisterStation(station);
      }
    }
  }

  private produceRawMaterials(delta: bigint): void {
    const productionPerMine =
      this.game.config().mineProductionPerTick() * delta;
    for (const [station, state] of this.mineStates) {
      if (!station.isActive()) {
        continue;
      }
      state.stock += productionPerMine;
    }
  }

  private convertFactoryStock(delta: bigint): void {
    const conversionPerFactory =
      this.game.config().factoryConversionPerTick() * delta;
    const conversionRatio = this.game.config().factoryConversionRatio();
    for (const [station, state] of this.factoryStates) {
      if (!station.isActive()) {
        continue;
      }
      const convertible = bigIntMin(state.rawStock, conversionPerFactory);
      state.rawStock -= convertible;
      state.goldStock += convertible * conversionRatio;
    }
  }

  private recomputePlayerCapacities(delta: bigint): void {
    const trainCapacityPerFactory =
      this.game.config().trainCapacityPerFactory() * delta;
    const seaCapacityPerPort = this.game.config().seaCapacityPerPort() * delta;

    const perPlayerCounts = new Map<
      Player,
      { mines: number; factories: number; ports: number }
    >();

    for (const station of this.stations) {
      if (!station.isActive()) continue;
      const owner = station.unit.owner();
      const entry = perPlayerCounts.get(owner) ?? {
        mines: 0,
        factories: 0,
        ports: 0,
      };
      switch (station.unit.type()) {
        case UnitType.Mine:
          entry.mines++;
          break;
        case UnitType.Factory:
          entry.factories++;
          break;
        case UnitType.Port:
          entry.ports++;
          break;
        default:
          break;
      }
      perPlayerCounts.set(owner, entry);
    }

    for (const [player, counts] of perPlayerCounts.entries()) {
      const state = this.ensurePlayerState(player);
      state.trainCapacityTotal =
        BigInt(counts.factories) * trainCapacityPerFactory;
      state.trainCapacityAvailable = state.trainCapacityTotal;
      state.seaCapacityTotal = BigInt(counts.ports) * seaCapacityPerPort;
      state.seaCapacityAvailable = state.seaCapacityTotal;
      state.lastTick = this.game.ticks();
    }

    for (const [player, state] of this.playerStates.entries()) {
      if (perPlayerCounts.has(player)) continue;
      state.trainCapacityTotal = 0n;
      state.trainCapacityAvailable = 0n;
      state.seaCapacityTotal = 0n;
      state.seaCapacityAvailable = 0n;
      state.lastTick = this.game.ticks();
    }
  }

  private scheduleRawShipments(random: PseudoRandom): void {
    for (const [mine, mineState] of this.mineStates) {
      if (mineState.stock <= 0n) {
        continue;
      }
      const player = mine.unit.owner();
      const playerState = this.ensurePlayerState(player);
      if (playerState.trainCapacityAvailable <= 0n) {
        continue;
      }
      const targetFactory = this.pickConnectedFactory(mine, player, random);
      if (!targetFactory) {
        continue;
      }
      const path = this.game
        .railNetwork()
        .findStationsPath(mine, targetFactory);
      if (!path || path.length < 2) {
        continue;
      }
      const load = this.computeTrainLoad(
        mineState.stock,
        playerState.trainCapacityAvailable,
      );
      if (load <= 0n) {
        continue;
      }
      mineState.stock -= load;
      playerState.trainCapacityAvailable -= load;
      const onDelivered = () => {
        const factoryState = this.factoryStates.get(targetFactory);
        if (factoryState) {
          factoryState.rawStock += load;
        }
      };
      const onAbort = () => {
        mineState.stock += load;
        playerState.trainCapacityAvailable = bigIntMin(
          playerState.trainCapacityAvailable + load,
          playerState.trainCapacityTotal,
        );
      };
      this.enqueueShipment(mine, {
        player,
        path,
        load,
        cargo: "raw",
        expedition: null,
        onDelivered,
        onAbort,
      });
    }
  }

  private scheduleGoldShipments(random: PseudoRandom): void {
    for (const [factory, factoryState] of this.factoryStates) {
      if (factoryState.goldStock <= 0n) {
        continue;
      }
      const player = factory.unit.owner();
      const playerState = this.ensurePlayerState(player);
      if (playerState.trainCapacityAvailable <= 0n) {
        continue;
      }
      const cluster = factory.getCluster();
      if (!cluster) {
        continue;
      }
      const destinations = [...cluster.availableForTrade(player)].filter(
        (station) => station.unit.type() === UnitType.City,
      );
      if (destinations.length === 0) {
        continue;
      }
      const shuffled = random.shuffleArray(destinations);
      for (const destination of shuffled) {
        const path = this.game
          .railNetwork()
          .findStationsPath(factory, destination);
        if (!path || path.length < 2) {
          continue;
        }
        const expedition = this.prepareGoldExpedition(
          factory,
          destination,
          path,
          factoryState,
          playerState,
        );
        if (!expedition) {
          continue;
        }
        const load = expedition.initialGold;
        const hadSea = expedition.hadSeaSegment;
        const onAbort = () => {
          factoryState.goldStock += load;
          playerState.trainCapacityAvailable = bigIntMin(
            playerState.trainCapacityAvailable + load,
            playerState.trainCapacityTotal,
          );
          if (hadSea) {
            playerState.seaCapacityAvailable = bigIntMin(
              playerState.seaCapacityAvailable + load,
              playerState.seaCapacityTotal,
            );
          }
        };
        this.enqueueShipment(factory, {
          player,
          path,
          load,
          cargo: "gold",
          expedition,
          onDelivered: () => {
            this.completeExpedition(expedition);
          },
          onAbort,
        });
        break;
      }
    }
  }

  private pickConnectedFactory(
    mine: TrainStation,
    player: Player,
    random: PseudoRandom,
  ): TrainStation | null {
    const cluster = mine.getCluster();
    if (!cluster) {
      return null;
    }
    const factories = [...cluster.stations].filter(
      (station) =>
        station.unit.type() === UnitType.Factory &&
        station.unit.owner() === player,
    );
    if (factories.length === 0) {
      return null;
    }
    return random.randElement(factories);
  }

  private enqueueShipment(
    origin: TrainStation,
    shipment: ScheduledShipment,
  ): void {
    const queue = this.pendingShipments.get(origin);
    if (!queue) {
      this.pendingShipments.set(origin, [shipment]);
      return;
    }
    queue.push(shipment);
  }

  private prepareGoldExpedition(
    source: TrainStation,
    destination: TrainStation,
    path: TrainStation[],
    factoryState: FactoryEconomyState,
    playerState: PlayerEconomyState,
  ): ExpeditionReport | null {
    const player = source.unit.owner();
    const hadSeaSegment = this.pathHasSea(path);
    if (
      factoryState.goldStock <= 0n ||
      playerState.trainCapacityAvailable <= 0n
    ) {
      return null;
    }
    if (hadSeaSegment && playerState.seaCapacityAvailable <= 0n) {
      return null;
    }

    let load = factoryState.goldStock;
    load = bigIntMin(load, this.game.config().trainCapacityPerFactory());
    load = bigIntMin(load, playerState.trainCapacityAvailable);
    if (hadSeaSegment) {
      load = bigIntMin(load, playerState.seaCapacityAvailable);
    }
    if (load <= 0n) {
      return null;
    }

    const customs = this.computeCustomsCharges(player, path, load);
    let deliveredGold = load;
    for (const charge of customs) {
      deliveredGold -= charge.amount;
    }
    if (deliveredGold <= 0n) {
      return null;
    }

    const basePrice = this.game.config().goldBasePrice();
    const baseCredit = deliveredGold * basePrice;
    const diversity = this.updateRouteDiversity(player, path);
    const appliedPercent = this.computeAppliedPercent(diversity);
    const basisPoints = BigInt(Math.round(appliedPercent * 100));
    const creditedGold = (baseCredit * basisPoints) / 10_000n;

    factoryState.goldStock -= load;
    playerState.trainCapacityAvailable -= load;
    if (hadSeaSegment) {
      playerState.seaCapacityAvailable -= load;
    }

    const report: ExpeditionReport = {
      id: this.nextExpeditionId++,
      player,
      source,
      destination,
      path,
      initialGold: load,
      customs,
      deliveredGold,
      creditedGold,
      hadSeaSegment,
      diversity,
    };

    return report;
  }

  private ensurePlayerState(player: Player): PlayerEconomyState {
    let state = this.playerStates.get(player);
    if (!state) {
      state = {
        trainCapacityAvailable: 0n,
        trainCapacityTotal: 0n,
        seaCapacityAvailable: 0n,
        seaCapacityTotal: 0n,
        lastTick: this.game.ticks(),
        recentRoutes: [],
      };
      this.playerStates.set(player, state);
    }
    return state;
  }

  private totalRawMaterial(player: Player): RawMaterial {
    let total = 0n;
    for (const [station, state] of this.mineStates) {
      if (station.unit.owner() === player) {
        total += state.stock;
      }
    }
    for (const [station, state] of this.factoryStates) {
      if (station.unit.owner() === player) {
        total += state.rawStock;
      }
    }
    return total;
  }

  private totalGoldStock(player: Player): Gold {
    let total = 0n;
    for (const [station, state] of this.factoryStates) {
      if (station.unit.owner() === player) {
        total += state.goldStock;
      }
    }
    return total;
  }

  private computeTrainLoad(
    availableStock: bigint,
    trainCapacity: bigint,
  ): bigint {
    let load = availableStock;
    load = bigIntMin(load, this.game.config().trainCapacityPerFactory());
    load = bigIntMin(load, trainCapacity);
    return load;
  }

  private computeCustomsCharges(
    player: Player,
    path: TrainStation[],
    load: Gold,
  ): CustomsCharge[] {
    let remaining = load;
    const charges: CustomsCharge[] = [];
    if (path.length === 0) {
      return charges;
    }

    let previousOwner = this.ownerOfTile(path[0].tile());
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      if (
        from.unit.type() === UnitType.Port &&
        to.unit.type() === UnitType.Port
      ) {
        previousOwner = this.ownerOfTile(to.tile());
        continue;
      }
      const oriented = getOrientedRailroad(from, to);
      if (!oriented) continue;
      for (const tile of oriented.getTiles()) {
        const owner = this.ownerOfTile(tile);
        if (owner === previousOwner) {
          continue;
        }
        if (owner === null || owner === player) {
          previousOwner = owner;
          continue;
        }
        const relation = player.isAlliedWith(owner)
          ? "ally"
          : player.isOnSameTeam(owner)
            ? "ally"
            : "other";
        const rate =
          relation === "ally"
            ? player.alliedCustomsRate()
            : player.otherCustomsRate();
        if (rate <= 0) {
          previousOwner = owner;
          continue;
        }
        const amount = (remaining * BigInt(Math.round(rate * 100))) / 10000n;
        if (amount > 0n) {
          charges.push({
            owner,
            relation,
            ratePercent: rate * 100,
            amount,
          });
          remaining -= amount;
        }
        previousOwner = owner;
      }
    }
    return charges;
  }

  private ownerOfTile(tile: TileRef): Player | null {
    const owner = this.game.owner(tile);
    return owner.isPlayer() ? owner : null;
  }

  private pathHasSea(path: TrainStation[]): boolean {
    for (let i = 0; i < path.length - 1; i++) {
      if (
        path[i].unit.type() === UnitType.Port &&
        path[i + 1].unit.type() === UnitType.Port
      ) {
        return true;
      }
    }
    return false;
  }

  private updateRouteDiversity(
    player: Player,
    path: TrainStation[],
  ): RouteDiversitySnapshot {
    const state = this.ensurePlayerState(player);
    const window = this.game.config().routeDiversityWindow();
    const threshold = this.game.config().routeDiversityWorldThreshold();
    const target = this.game.config().routeDiversityTargetShare();
    const penaltyMax = this.game.config().routeDiversityPenaltyMaxPercent();
    const bonusThreshold = this.game.config().routeDiversityBonusThreshold();
    const bonusPercent = this.game.config().routeDiversityBonusPercent();
    const penaltyFloor = this.game.config().routeDiversityPenaltyFloorPercent();

    const now = this.game.ticks();
    const cutoff = now - window;
    state.recentRoutes = state.recentRoutes.filter(
      (entry) => entry.tick >= cutoff,
    );

    if (path.length > 0) {
      const hash = this.hashPath(path);
      state.recentRoutes.push({ hash, tick: now });
    }

    const uniqueRoutes = new Set(state.recentRoutes.map((entry) => entry.hash));
    const playerPathCount = uniqueRoutes.size;
    const worldPathCount = this.cachedWorldPathCount || 1;
    const ratio = worldPathCount === 0 ? 1 : playerPathCount / worldPathCount;

    let penaltyPercent = 0;
    if (worldPathCount >= threshold && ratio < target) {
      const deficit = target - ratio;
      penaltyPercent = -penaltyMax * clampPercent(deficit / target, 0, 1);
    }

    let bonusPercentApplied = 0;
    if (worldPathCount >= threshold && ratio > bonusThreshold) {
      bonusPercentApplied = bonusPercent;
    }

    let appliedPercent = 100 + penaltyPercent + bonusPercentApplied;
    appliedPercent = Math.max(penaltyFloor, appliedPercent);

    return {
      worldPathCount,
      playerPathCount,
      ratio,
      penaltyPercent,
      bonusPercent: bonusPercentApplied,
      appliedPercent,
    };
  }

  private computeAppliedPercent(snapshot: RouteDiversitySnapshot): number {
    return snapshot.appliedPercent;
  }

  private hashPath(path: TrainStation[]): string {
    return path.map((station) => station.unit.id()).join("-");
  }

  private computeWorldPathCount(): number {
    let total = 0;
    for (const [factory] of this.factoryStates) {
      if (!factory.isActive()) continue;
      const cluster = factory.getCluster();
      if (!cluster) continue;
      const destinations = [
        ...cluster.availableForTrade(factory.unit.owner()),
      ].filter((s) => s.unit.type() === UnitType.City);
      total += destinations.length;
    }
    return total;
  }

  private serializeExpedition(expedition: ExpeditionReport) {
    return {
      id: expedition.id,
      player: expedition.player.smallID(),
      source: expedition.source.unit.id(),
      destination: expedition.destination.unit.id(),
      path: expedition.path.map((station) => station.unit.id()),
      initialGold: expedition.initialGold.toString(),
      deliveredGold: expedition.deliveredGold.toString(),
      creditedGold: expedition.creditedGold.toString(),
      customs: expedition.customs.map((charge) => ({
        owner: charge.owner.smallID(),
        relation: charge.relation,
        ratePercent: charge.ratePercent,
        amount: charge.amount.toString(),
      })),
      hadSeaSegment: expedition.hadSeaSegment,
      diversity: expedition.diversity,
    };
  }
}
