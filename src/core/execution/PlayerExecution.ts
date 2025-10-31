import { Config } from "../configuration/Config";
import { Execution, Game, Player, UnitType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { GameMap, TileRef } from "../game/GameMap";
import { calculateBoundingBox, getMode, inscribed, simpleHash } from "../Util";

const POPULATION_CONVERSION_RATE = 0.002;

export class PlayerExecution implements Execution {
  private readonly ticksPerClusterCalc = 20;

  private config: Config;
  private lastCalc = 0;
  private mg: Game;
  private active = true;

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.config = mg.config();
    this.lastCalc =
      ticks + (simpleHash(this.player.name()) % this.ticksPerClusterCalc);
  }

  tick(ticks: number) {
    this.player.decayRelations();
    for (const u of this.player.units()) {
      if (!u.info().territoryBound) {
        continue;
      }

      const owner = this.mg!.owner(u.tile());
      if (!owner?.isPlayer()) {
        u.delete();
        continue;
      }
      if (owner === this.player) {
        continue;
      }

      const captor = this.mg!.player(owner.id());
      if (u.type() === UnitType.DefensePost) {
        u.decreaseLevel(captor);
        if (u.isActive()) {
          captor.captureUnit(u);
        }
      } else if (u.type() === UnitType.CentralBank) {
        u.delete(true, captor);
      } else {
        captor.captureUnit(u);
      }
    }

    if (!this.player.isAlive()) {
      // Player has no tiles, delete any remaining units and gold
      const gold = this.player.gold();
      this.player.removeGold(gold);
      this.player.units().forEach((u) => {
        if (
          u.type() !== UnitType.AtomBomb &&
          u.type() !== UnitType.HydrogenBomb &&
          u.type() !== UnitType.MIRVWarhead &&
          u.type() !== UnitType.MIRV
        ) {
          u.delete();
        }
      });
      this.active = false;
      this.mg.stats().playerKilled(this.player, ticks);
      return;
    }

    const troopInc = this.config.troopIncreaseRate(this.player);
    this.player.addCivilians(troopInc);
    this.player.updateMilitaryComposition(POPULATION_CONVERSION_RATE);
    const goldFromWorkers = this.config.goldAdditionRate(this.player);
    const goldFromMines = this.mineGoldPerTick();
    const combinedGold = goldFromWorkers + goldFromMines;
    const militaryPercent = Math.min(
      50,
      Math.floor(this.player.militaryRatio() * 100),
    );
    const revenueMultiplier = Math.max(0, 100 - militaryPercent * 2);
    const totalGoldGain = (combinedGold * BigInt(revenueMultiplier)) / 100n;
    this.player.addGold(totalGoldGain);

    // Record stats
    this.mg.stats().goldWork(this.player, totalGoldGain);

    const alliances = Array.from(this.player.alliances());
    for (const alliance of alliances) {
      if (alliance.expiresAt() <= this.mg.ticks()) {
        alliance.expire();
      }
    }

    const embargoes = this.player.getEmbargoes();
    for (const embargo of embargoes) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    if (ticks - this.lastCalc > this.ticksPerClusterCalc) {
      if (this.player.lastTileChange() > this.lastCalc) {
        this.lastCalc = ticks;
        const start = performance.now();
        this.removeClusters();
        const end = performance.now();
        if (end - start > 1000) {
          console.log(`player ${this.player.name()}, took ${end - start}ms`);
        }
      }
    }
  }

  private removeClusters() {
    const clusters = this.calculateClusters();
    clusters.sort((a, b) => b.size - a.size);

    const main = clusters.shift();
    if (main === undefined) throw new Error("No clusters");
    this.player.largestClusterBoundingBox = calculateBoundingBox(this.mg, main);
    const surroundedBy = this.surroundedBySamePlayer(main);
    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      this.removeCluster(main);
    }

    for (const cluster of clusters) {
      if (this.isSurrounded(cluster)) {
        this.removeCluster(cluster);
      }
    }
  }

  private surroundedBySamePlayer(cluster: Set<TileRef>): false | Player {
    const enemies = new Set<number>();
    for (const tile of cluster) {
      if (
        this.mg.isOceanShore(tile) ||
        this.mg.isOnEdgeOfMap(tile) ||
        this.mg.neighbors(tile).some((n) => !this.mg?.hasOwner(n))
      ) {
        return false;
      }
      this.mg
        .neighbors(tile)
        .filter((n) => this.mg?.ownerID(n) !== this.player?.smallID())
        .forEach((p) => this.mg && enemies.add(this.mg.ownerID(p)));
      if (enemies.size !== 1) {
        return false;
      }
    }
    if (enemies.size !== 1) {
      return false;
    }
    const enemy = this.mg.playerBySmallID(Array.from(enemies)[0]) as Player;
    const enemyBox = calculateBoundingBox(this.mg, enemy.borderTiles());
    const clusterBox = calculateBoundingBox(this.mg, cluster);
    if (inscribed(enemyBox, clusterBox)) {
      return enemy;
    }
    return false;
  }

  private isSurrounded(cluster: Set<TileRef>): boolean {
    const enemyTiles = new Set<TileRef>();
    for (const tr of cluster) {
      if (this.mg.isShore(tr) || this.mg.isOnEdgeOfMap(tr)) {
        return false;
      }
      this.mg
        .neighbors(tr)
        .filter(
          (n) =>
            this.mg?.owner(n).isPlayer() &&
            this.mg?.ownerID(n) !== this.player?.smallID(),
        )
        .forEach((n) => enemyTiles.add(n));
    }
    if (enemyTiles.size === 0) {
      return false;
    }
    const enemyBox = calculateBoundingBox(this.mg, enemyTiles);
    const clusterBox = calculateBoundingBox(this.mg, cluster);
    return inscribed(enemyBox, clusterBox);
  }

  private removeCluster(cluster: Set<TileRef>) {
    if (
      Array.from(cluster).some(
        (t) => this.mg?.ownerID(t) !== this.player?.smallID(),
      )
    ) {
      // Other removeCluster operations could change tile owners,
      // so double check.
      return;
    }

    const capturing = this.getCapturingPlayer(cluster);
    if (capturing === null) {
      return;
    }

    const firstTile = cluster.values().next().value;
    if (!firstTile) {
      return;
    }

    const filter = (_: GameMap, t: TileRef): boolean =>
      this.mg?.ownerID(t) === this.player?.smallID();
    const tiles = this.mg.bfs(firstTile, filter);

    if (this.player.numTilesOwned() === tiles.size) {
      this.mg.conquerPlayer(capturing, this.player);
    }

    for (const tile of tiles) {
      capturing.conquer(tile);
    }
  }

  private getCapturingPlayer(cluster: Set<TileRef>): Player | null {
    const neighbors = new Map<Player, number>();
    for (const t of cluster) {
      for (const neighbor of this.mg.neighbors(t)) {
        const owner = this.mg.owner(neighbor);
        if (
          owner.isPlayer() &&
          owner !== this.player &&
          !owner.isFriendly(this.player)
        ) {
          neighbors.set(owner, (neighbors.get(owner) ?? 0) + 1);
        }
      }
    }

    // If there are no enemies, return null
    if (neighbors.size === 0) {
      return null;
    }

    // Get the largest attack from the neighbors
    let largestNeighborAttack: Player | null = null;
    let largestTroopCount = 0;
    for (const [neighbor] of neighbors) {
      for (const attack of neighbor.outgoingAttacks()) {
        if (attack.target() === this.player) {
          if (attack.troops() > largestTroopCount) {
            largestTroopCount = attack.troops();
            largestNeighborAttack = neighbor;
          }
        }
      }
    }

    if (largestNeighborAttack !== null) {
      return largestNeighborAttack;
    }

    // There are no ongoing attacks, so find the enemy with the largest border.
    return getMode(neighbors);
  }

  private calculateClusters(): Set<TileRef>[] {
    const seen = new Set<TileRef>();
    const border = this.player.borderTiles();
    const clusters: Set<TileRef>[] = [];
    for (const tile of border) {
      if (seen.has(tile)) {
        continue;
      }

      const cluster = new Set<TileRef>();
      const queue: TileRef[] = [tile];
      seen.add(tile);
      while (queue.length > 0) {
        const curr = queue.shift();
        if (curr === undefined) throw new Error("curr is undefined");
        cluster.add(curr);

        const neighbors = (this.mg as GameImpl).neighborsWithDiag(curr);
        for (const neighbor of neighbors) {
          if (border.has(neighbor) && !seen.has(neighbor)) {
            queue.push(neighbor);
            seen.add(neighbor);
          }
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  owner(): Player {
    if (this.player === null) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  private mineGoldPerTick(): bigint {
    const mines = this.player.units(UnitType.Mine);
    if (mines.length === 0) {
      return 0n;
    }

    const totalMineLevels = mines.reduce((sum, mine) => sum + mine.level(), 0);
    if (totalMineLevels <= 0) {
      return 0n;
    }

    const maxTroops = Math.max(
      1,
      Math.floor(this.config.maxTroops(this.player)),
    );
    const troopAmount = Math.max(
      0,
      Math.min(maxTroops, Math.floor(this.player.troops())),
    );
    if (troopAmount <= 0) {
      return 0n;
    }

    const ticksPerMinute = Math.max(
      1,
      Math.floor(60_000 / this.config.turnIntervalMs()),
    );

    const numerator =
      1_000_000n * BigInt(totalMineLevels) * BigInt(troopAmount);
    const denominator = BigInt(ticksPerMinute) * BigInt(maxTroops);
    if (denominator === 0n) {
      return 0n;
    }

    return (numerator + denominator / 2n) / denominator;
  }
}
