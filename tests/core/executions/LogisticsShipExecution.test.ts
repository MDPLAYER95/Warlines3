import { LogisticsShipExecution } from "../../../src/core/execution/LogisticsShipExecution";
import { Game, Player, Unit } from "../../../src/core/game/Game";
import { PathFindResultType } from "../../../src/core/pathfinding/AStar";
import { setup } from "../../util/Setup";

describe("LogisticsShipExecution", () => {
  let game: Game;
  let owner: Player;
  let srcPort: Unit;
  let dstPort: Unit;
  let ship: Unit;

  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
    });

    owner = {
      canBuild: jest.fn(() => true),
      buildUnit: jest.fn((_type, _spawn, _opts) => ship),
      units: jest.fn(() => [dstPort]),
      unitCount: jest.fn(() => 1),
      id: jest.fn(() => 1),
    } as any;

    srcPort = {
      tile: jest.fn(() => 20011),
      owner: jest.fn(() => owner),
      isActive: jest.fn(() => true),
    } as any;

    dstPort = {
      tile: jest.fn(() => 30015),
      owner: jest.fn(() => owner),
      isActive: jest.fn(() => true),
    } as any;

    ship = {
      isActive: jest.fn(() => true),
      owner: jest.fn(() => owner),
      move: jest.fn(),
      delete: jest.fn(),
      tile: jest.fn(() => 2001),
    } as any;
  });

  it("completes when reaching destination", () => {
    const onComplete = jest.fn();
    const execution = new LogisticsShipExecution(owner, srcPort, dstPort, {
      onComplete,
    });
    execution.init(game, 0);
    (execution as any).pathFinder = {
      nextTile: jest.fn(() => ({
        type: PathFindResultType.Completed,
        node: 2001,
      })),
    };
    (execution as any).ship = ship;

    execution.tick(1);

    expect(ship.delete).toHaveBeenCalledWith(false);
    expect(onComplete).toHaveBeenCalled();
    expect(execution.isActive()).toBe(false);
  });

  it("aborts when ship is destroyed", () => {
    const onAbort = jest.fn();
    const execution = new LogisticsShipExecution(owner, srcPort, dstPort, {
      onAbort,
    });
    execution.init(game, 0);
    (execution as any).ship = ship;
    ship.isActive = jest.fn(() => false);

    execution.tick(1);

    expect(onAbort).toHaveBeenCalled();
    expect(execution.isActive()).toBe(false);
  });
});
