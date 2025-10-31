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

interface PlayerEconomyState {
  rawMaterialStock: RawMaterial;
  goldStock: Gold;
  trainCapacityAvailable: Gold;
  trainCapacityTotal: Gold;
  seaCapacityAvailable: Gold;
  seaCapacityTotal: Gold;
  lastTick: Tick;
  recentRoutes: Array<{ hash: string; tick: Tick }>;
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
  private nextExpeditionId = 1;
  private lastTickProcessed: Tick = 0;
  private cachedWorldPathCount = 0;

  constructor(private readonly game: Game) {}

  registerStation(station: TrainStation): void {
    this.stations.add(station);
  }

  unregisterStation(station: TrainStation): void {
    this.stations.delete(station);
  }

  tick(currentTick: Tick): void {
    if (currentTick <= this.lastTickProcessed) {
      return;
    }
    const delta = BigInt(currentTick - this.lastTickProcessed);
    this.lastTickProcessed = currentTick;

    const productionPerMine = this.game.config().mineProductionPerTick();
    const conversionPerFactory = this.game.config().factoryConversionPerTick();
    const conversionRatio = this.game.config().factoryConversionRatio();
    const trainCapacityPerFactory = this.game
      .config()
      .trainCapacityPerFactory();
    const seaCapacityPerPort = this.game.config().seaCapacityPerPort();

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
      const mineProduction = BigInt(counts.mines) * productionPerMine * delta;
      state.rawMaterialStock += mineProduction;

      const convertible = bigIntMin(
        state.rawMaterialStock,
        BigInt(counts.factories) * conversionPerFactory * delta,
      );
      state.rawMaterialStock -= convertible;
      state.goldStock += convertible * conversionRatio;

      state.trainCapacityTotal =
        BigInt(counts.factories) * trainCapacityPerFactory * delta;
      state.trainCapacityAvailable = state.trainCapacityTotal;
      state.seaCapacityTotal =
        BigInt(counts.ports) * seaCapacityPerPort * delta;
      state.seaCapacityAvailable = state.seaCapacityTotal;
      state.lastTick = currentTick;
    }

    // Ensure players with existing state but no stations reset capacities
    for (const [player, state] of this.playerStates.entries()) {
      if (perPlayerCounts.has(player)) continue;
      state.trainCapacityTotal = 0n;
      state.trainCapacityAvailable = 0n;
      state.seaCapacityTotal = 0n;
      state.seaCapacityAvailable = 0n;
      state.lastTick = currentTick;
    }

    this.cachedWorldPathCount = this.computeWorldPathCount();
  }

  prepareExpedition(
    source: TrainStation,
    destination: TrainStation,
    path: TrainStation[],
  ): ExpeditionReport | null {
    const player = source.unit.owner();
    this.tick(this.game.ticks());
    const state = this.ensurePlayerState(player);

    if (state.goldStock <= 0n || state.trainCapacityAvailable <= 0n) {
      return null;
    }

    const hadSeaSegment = this.pathHasSea(path);
    if (hadSeaSegment && state.seaCapacityAvailable <= 0n) {
      return null;
    }

    const load = this.computeExpeditionLoad(state, hadSeaSegment, player);

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

    state.goldStock -= load;
    state.trainCapacityAvailable -= load;
    if (hadSeaSegment) {
      state.seaCapacityAvailable -= load;
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
      rawMaterialStock: state.rawMaterialStock,
      goldStock: state.goldStock,
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

  private computeExpeditionLoad(
    state: PlayerEconomyState,
    hadSeaSegment: boolean,
    _player: Player,
  ): Gold {
    let load = state.goldStock;
    if (state.trainCapacityAvailable < load) {
      load = state.trainCapacityAvailable;
    }
    if (hadSeaSegment && state.seaCapacityAvailable < load) {
      load = state.seaCapacityAvailable;
    }
    return load;
  }

  private ensurePlayerState(player: Player): PlayerEconomyState {
    let state = this.playerStates.get(player);
    if (!state) {
      state = {
        rawMaterialStock: 0n,
        goldStock: 0n,
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
    for (const station of this.stations) {
      if (!station.isActive()) continue;
      if (station.unit.type() !== UnitType.Factory) continue;
      const cluster = station.getCluster();
      if (!cluster) continue;
      const destinations = [
        ...cluster.availableForTrade(station.unit.owner()),
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
