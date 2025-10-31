import type { ExpeditionReport } from "../game/EconomyManager";
import { Execution, Game, Player, UnitType } from "../game/Game";
import { TrainStation } from "../game/TrainStation";
import { LogisticsShipExecution } from "./LogisticsShipExecution";
import { TrainExecution } from "./TrainExecution";

interface RailSegment {
  type: "rail";
  path: TrainStation[];
}

interface SeaSegment {
  type: "sea";
  from: TrainStation;
  to: TrainStation;
}

type ExpeditionSegment = RailSegment | SeaSegment;

export class LogisticsExpeditionExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private currentIndex = -1;
  private readonly segments: ExpeditionSegment[];

  constructor(
    private readonly player: Player,
    private readonly fullPath: TrainStation[],
    private readonly numCars: number,
    private readonly expedition: ExpeditionReport,
  ) {
    if (fullPath.length < 2) {
      throw new Error("Expedition path must include at least two stations");
    }
    this.segments = this.buildSegments(fullPath);
    if (this.segments.length === 0) {
      throw new Error("No valid segments for expedition");
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.startNextSegment();
  }

  tick(_ticks: number): void {
    // Orchestration happens via callbacks from spawned executions.
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private buildSegments(path: TrainStation[]): ExpeditionSegment[] {
    const segments: ExpeditionSegment[] = [];
    let currentRail: TrainStation[] = [path[0]];

    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const isSea =
        prev.unit.type() === UnitType.Port &&
        curr.unit.type() === UnitType.Port;
      if (isSea) {
        if (currentRail.length > 1) {
          segments.push({ type: "rail", path: [...currentRail] });
        }
        segments.push({ type: "sea", from: prev, to: curr });
        currentRail = [curr];
      } else {
        currentRail.push(curr);
      }
    }

    if (currentRail.length > 1) {
      segments.push({ type: "rail", path: currentRail });
    }

    return segments;
  }

  private startNextSegment() {
    if (!this.mg) {
      throw new Error("Not initialized");
    }
    this.currentIndex++;
    if (this.currentIndex >= this.segments.length) {
      this.active = false;
      return;
    }

    const segment = this.segments[this.currentIndex];
    if (segment.type === "rail") {
      const isFinalSegment = this.currentIndex === this.segments.length - 1;
      const train = new TrainExecution(
        this.player,
        segment.path,
        this.numCars,
        {
          hasCargo: true,
          onComplete: () => this.handleSegmentComplete(isFinalSegment),
          onAbort: () => this.abortExpedition(),
        },
      );
      this.mg.addExecution(train);
    } else {
      const ship = new LogisticsShipExecution(
        this.player,
        segment.from.unit,
        segment.to.unit,
        {
          onComplete: () => this.handleSegmentComplete(false),
          onAbort: () => this.abortExpedition(),
        },
      );
      this.mg.addExecution(ship);
    }
  }

  private handleSegmentComplete(isFinalSegment: boolean) {
    if (!this.active) {
      return;
    }
    if (isFinalSegment) {
      this.active = false;
      this.mg?.economy().completeExpedition(this.expedition);
      return;
    }
    this.startNextSegment();
  }

  private abortExpedition() {
    if (!this.active) {
      return;
    }
    this.active = false;
  }
}
