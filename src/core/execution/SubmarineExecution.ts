import {
  Execution,
  Game,
  OwnerComp,
  Tick,
  Unit,
  UnitParams,
  UnitType,
  isUnit,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";

export class SubmarineExecution implements Execution {
  private random: PseudoRandom;
  private submarine: Unit | null = null;
  private mg: Game;
  private pathfinder: PathFinder;
  private visibilityLockUntil: Tick | null = null;
  private lastAttackTick = 0;

  constructor(
    private input: (UnitParams<UnitType.Submarine> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = PathFinder.Mini(mg, 10_000, true, 100);
    this.random = new PseudoRandom(mg.ticks());

    if (isUnit(this.input)) {
      this.submarine = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Submarine,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn submarine for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.submarine = this.input.owner.buildUnit(
        UnitType.Submarine,
        spawn,
        this.input,
      );
    }

    if (this.submarine) {
      this.submarine.setTargetable(false);
      this.visibilityLockUntil = this.submarine.revealedUntil();
    }
  }

  tick(ticks: number): void {
    if (this.submarine === null) {
      return;
    }

    if (this.submarine.health() <= 0) {
      this.submarine.delete();
      this.submarine = null;
      return;
    }

    if (this.submarine.owner().isDisconnected()) {
      this.submarine.delete();
      this.submarine = null;
      return;
    }

    if (this.submarine.owner().unitCount(UnitType.Port) > 0) {
      this.submarine.modifyHealth(1);
    }

    this.reloadMissiles();

    const detected = this.handleDetection();
    this.updateVisibility(detected);

    if (!this.submarine.submarineOrders().attackWarships) {
      this.submarine.setTargetUnit(undefined);
    } else {
      this.submarine.setTargetUnit(this.findTargetUnit());
    }

    const target = this.submarine.targetUnit();
    if (target) {
      this.engageTarget(target);
      return;
    }

    this.patrol();
  }

  private reloadMissiles() {
    if (this.submarine === null) {
      return;
    }
    const frontTime = this.submarine.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }
    const cooldown =
      this.mg.config().SiloCooldown() - (this.mg.ticks() - frontTime);
    if (cooldown <= 0) {
      this.submarine.reloadMissile();
    }
  }

  private handleDetection(): boolean {
    if (this.submarine === null) {
      return false;
    }

    const detectionRange = this.mg.config().submarineDetectionRange();
    const nearby = this.mg.nearbyUnits(
      this.submarine.tile()!,
      detectionRange,
      UnitType.Submarine,
    );
    let detected = false;
    for (const { unit } of nearby) {
      if (unit === this.submarine) {
        continue;
      }
      if (unit.owner() === this.submarine.owner()) {
        continue;
      }
      if (unit.owner().isFriendly(this.submarine.owner())) {
        continue;
      }
      detected = true;
      if (!unit.isTargetable()) {
        unit.setTargetable(true);
      }
    }
    return detected;
  }

  private updateVisibility(detected: boolean) {
    if (this.submarine === null) {
      return;
    }

    const now = this.mg.ticks();
    const scheduledReveal = this.submarine.revealedUntil();
    if (scheduledReveal !== null) {
      this.visibilityLockUntil =
        this.visibilityLockUntil === null
          ? scheduledReveal
          : Math.max(this.visibilityLockUntil, scheduledReveal);
    }

    if (this.visibilityLockUntil !== null && now > this.visibilityLockUntil) {
      this.visibilityLockUntil = null;
      this.submarine.setRevealedUntil(null);
    }

    const forcedVisible =
      this.visibilityLockUntil !== null && now <= this.visibilityLockUntil;

    if (forcedVisible) {
      this.submarine.setTargetable(true);
      if (this.submarine.revealedUntil() !== this.visibilityLockUntil) {
        this.submarine.setRevealedUntil(this.visibilityLockUntil);
      }
      return;
    }

    if (detected) {
      this.submarine.setTargetable(true);
      if (this.submarine.revealedUntil() !== null) {
        this.submarine.setRevealedUntil(null);
      }
      return;
    }

    this.submarine.setTargetable(false);
    if (this.submarine.revealedUntil() !== null) {
      this.submarine.setRevealedUntil(null);
    }
  }

  private findTargetUnit(): Unit | undefined {
    if (this.submarine === null) {
      return undefined;
    }

    const range = this.mg.config().warshipTargettingRange();
    const candidates = this.mg.nearbyUnits(this.submarine.tile()!, range, [
      UnitType.Submarine,
      UnitType.Warship,
    ]);
    const potential: { unit: Unit; priority: number; distSquared: number }[] =
      [];
    for (const { unit, distSquared } of candidates) {
      if (unit === this.submarine) {
        continue;
      }
      if (unit.owner() === this.submarine.owner()) {
        continue;
      }
      if (unit.owner().isFriendly(this.submarine.owner())) {
        continue;
      }
      if (unit.type() === UnitType.Submarine && !unit.isTargetable()) {
        continue;
      }
      const priority = unit.type() === UnitType.Submarine ? 0 : 1;
      potential.push({ unit, priority, distSquared });
    }
    potential.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.distSquared - b.distSquared;
    });
    return potential[0]?.unit;
  }

  private engageTarget(target: Unit) {
    if (this.submarine === null) {
      return;
    }
    const attackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastAttackTick < attackRate) {
      this.submarine.touch();
      return;
    }
    this.lastAttackTick = this.mg.ticks();

    if (target.type() === UnitType.Warship) {
      target.modifyHealth(-target.health(), this.submarine.owner());
      this.revealFor(this.mg.config().submarineVisibilityDuration());
      this.submarine.setTargetUnit(undefined);
      return;
    }

    if (target.type() === UnitType.Submarine) {
      target.modifyHealth(-250, this.submarine.owner());
      this.revealFor(this.mg.config().submarineVisibilityDuration());
      if (target.health() <= 0) {
        this.submarine.setTargetUnit(undefined);
      }
      return;
    }
  }

  private revealFor(duration: Tick) {
    if (this.submarine === null) {
      return;
    }
    const until = this.mg.ticks() + duration;
    if (this.visibilityLockUntil === null || until > this.visibilityLockUntil) {
      this.visibilityLockUntil = until;
    }
    this.submarine.setRevealedUntil(this.visibilityLockUntil);
    this.submarine.setTargetable(true);
  }

  private patrol() {
    if (this.submarine === null) {
      return;
    }
    if (this.submarine.targetTile() === undefined) {
      this.submarine.setTargetTile(this.randomTile());
      if (this.submarine.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.nextTile(
      this.submarine.tile(),
      this.submarine.targetTile()!,
    );
    switch (result.type) {
      case PathFindResultType.Completed:
        this.submarine.setTargetTile(undefined);
        this.submarine.move(result.node);
        break;
      case PathFindResultType.NextTile:
        this.submarine.move(result.node);
        break;
      case PathFindResultType.Pending:
        this.submarine.touch();
        return;
      case PathFindResultType.PathNotFound:
        console.warn(`Submarine path not found to target tile`);
        this.submarine.setTargetTile(undefined);
        break;
    }
  }

  isActive(): boolean {
    return this.submarine?.isActive() ?? false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private randomTile(allowShoreline: boolean = false): TileRef | undefined {
    if (this.submarine === null) {
      return undefined;
    }
    let patrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand = 500;
    let attempts = 0;
    let expandCount = 0;
    while (expandCount < 3) {
      const x =
        this.mg.x(this.submarine.patrolTile()!) +
        this.random.nextInt(-patrolRange / 2, patrolRange / 2);
      const y =
        this.mg.y(this.submarine.patrolTile()!) +
        this.random.nextInt(-patrolRange / 2, patrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        !this.mg.isOcean(tile) ||
        (!allowShoreline && this.mg.isShoreline(tile))
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          patrolRange = patrolRange + Math.floor(patrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for submarine for ${this.submarine.owner().name()}`,
    );
    if (!allowShoreline) {
      return this.randomTile(true);
    }
    return undefined;
  }
}
