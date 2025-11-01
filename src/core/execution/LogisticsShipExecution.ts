import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";

export interface LogisticsShipCallbacks {
  onComplete?: () => void;
  onAbort?: () => void;
}

export class LogisticsShipExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private ship: Unit | null = null;
  private pathFinder: PathFinder | null = null;
  private readonly callbacks: LogisticsShipCallbacks;

  constructor(
    private readonly owner: Player,
    private readonly sourcePort: Unit,
    private destinationPort: Unit,
    callbacks: LogisticsShipCallbacks = {},
  ) {
    this.callbacks = callbacks;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 2500);
  }

  tick(ticks: number): void {
    if (!this.mg || !this.pathFinder) {
      throw new Error("Not initialized");
    }
    if (!this.ship) {
      this.spawnShip(ticks);
      if (!this.ship) {
        this.fail();
        return;
      }
    }

    if (!this.ship.isActive()) {
      this.fail();
      return;
    }

    if (!this.destinationPort.isActive()) {
      this.fail();
      return;
    }

    if (this.ship.tile() === this.destinationPort.tile()) {
      this.complete();
      return;
    }

    const result = this.pathFinder.nextTile(
      this.ship.tile(),
      this.destinationPort.tile(),
    );

    switch (result.type) {
      case PathFindResultType.Pending:
        this.ship.move(this.ship.tile());
        break;
      case PathFindResultType.NextTile:
        this.ship.move(result.node);
        break;
      case PathFindResultType.Completed:
        this.complete();
        break;
      case PathFindResultType.PathNotFound:
        this.fail();
        break;
    }
  }

  private spawnShip(ticks: number) {
    const spawn = this.owner.canBuild(
      UnitType.TradeShip,
      this.sourcePort.tile(),
    );
    if (spawn === false) {
      console.warn(`cannot build logistics ship`);
      return;
    }
    this.ship = this.owner.buildUnit(UnitType.TradeShip, spawn, {
      targetUnit: this.destinationPort,
      lastSetSafeFromPirates: ticks,
    });
    this.mg?.stats().boatSendTrade(this.owner, this.destinationPort.owner());
  }

  private complete() {
    if (this.ship?.isActive()) {
      this.ship.delete(false);
    }
    this.active = false;
    this.callbacks.onComplete?.();
  }

  private fail() {
    if (!this.active) {
      return;
    }
    if (this.ship?.isActive()) {
      this.ship.delete(false);
    }
    this.active = false;
    this.callbacks.onAbort?.();
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this.destinationPort.tile();
  }
}
