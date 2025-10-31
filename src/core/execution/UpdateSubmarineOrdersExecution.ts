import {
  Execution,
  Game,
  Player,
  SubmarineOrders,
  UnitType,
} from "../game/Game";

export class UpdateSubmarineOrdersExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly orders: SubmarineOrders,
  ) {}

  init(mg: Game): void {
    const submarine = this.owner
      .units(UnitType.Submarine)
      .find((unit) => unit.id() === this.unitId);
    if (!submarine || !submarine.isActive()) {
      console.warn(
        `UpdateSubmarineOrdersExecution: submarine ${this.unitId} not found or inactive`,
      );
      return;
    }
    submarine.setSubmarineOrders(this.orders);
  }

  tick(): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
