import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;
let otherPlayer: Player;

describe("PlayerExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id"),
        new PlayerInfo("other", PlayerType.Human, "client_id2", "other_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    otherPlayer = game.player("other_id");

    game.addExecution(new PlayerExecution(player));
    game.addExecution(new PlayerExecution(otherPlayer));
  });

  test("DefensePost lv. 1 is destroyed when tile owner changes", () => {
    const tile = game.ref(50, 50);
    player.conquer(tile);
    const defensePost = player.buildUnit(UnitType.DefensePost, tile, {});

    game.executeNextTick();
    expect(game.unitCount(UnitType.DefensePost)).toBe(1);
    expect(defensePost.level()).toBe(1);

    otherPlayer.conquer(tile);
    executeTicks(game, 2);

    expect(game.unitCount(UnitType.DefensePost)).toBe(0);
  });

  test("DefensePost lv. 2+ is downgraded when tile owner changes", () => {
    const tile = game.ref(50, 50);
    player.conquer(tile);
    const defensePost = player.buildUnit(UnitType.DefensePost, tile, {});
    defensePost.increaseLevel();

    expect(defensePost.level()).toBe(2);
    expect(game.unitCount(UnitType.DefensePost)).toBe(2); // unitCount sums levels
    expect(player.units(UnitType.DefensePost)).toHaveLength(1);
    expect(defensePost.isActive()).toBe(true);

    otherPlayer.conquer(tile);
    executeTicks(game, 2);

    expect(defensePost.level()).toBe(1);
    expect(game.unitCount(UnitType.DefensePost)).toBe(1);
    expect(otherPlayer.units(UnitType.DefensePost)).toHaveLength(1);
    expect(defensePost.owner()).toBe(otherPlayer);
    expect(defensePost.isActive()).toBe(true);
  });

  test("Non-DefensePost structures are transferred (not downgraded) when tile owner changes", () => {
    const tile = game.ref(50, 50);
    player.conquer(tile);
    const city = player.buildUnit(UnitType.City, tile, {});

    expect(game.unitCount(UnitType.City)).toBe(1);
    expect(city.level()).toBe(1);
    expect(city.owner()).toBe(player);
    expect(city.isActive()).toBe(true);

    otherPlayer.conquer(tile);
    executeTicks(game, 2);

    expect(game.unitCount(UnitType.City)).toBe(1);
    expect(city.level()).toBe(1);
    expect(city.owner()).toBe(otherPlayer);
    expect(city.isActive()).toBe(true);
  });

  test("Central Bank self-destructs when tile owner changes", () => {
    const tile = game.ref(55, 55);
    player.conquer(tile);
    player.buildUnit(UnitType.CentralBank, tile, {});

    expect(game.unitCount(UnitType.CentralBank)).toBe(1);

    otherPlayer.conquer(tile);
    executeTicks(game, 2);

    expect(game.unitCount(UnitType.CentralBank)).toBe(0);
  });

  const computeBaselineGain = async (): Promise<bigint> => {
    const baselineGame = await setup(
      "big_plains",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id"),
        new PlayerInfo("other", PlayerType.Human, "client_id2", "other_id"),
      ],
    );

    while (baselineGame.inSpawnPhase()) {
      baselineGame.executeNextTick();
    }

    const baselinePlayer = baselineGame.player("player_id");
    const baselineOther = baselineGame.player("other_id");
    baselineGame.addExecution(new PlayerExecution(baselinePlayer));
    baselineGame.addExecution(new PlayerExecution(baselineOther));
    (
      baselineGame.config() as unknown as { turnIntervalMs: () => number }
    ).turnIntervalMs = () => 100;
    baselinePlayer.setTroops(0);
    const start = baselinePlayer.gold();
    executeTicks(baselineGame, 2);
    return baselinePlayer.gold() - start;
  };

  test("Mine does not grant immediate gold when staffed", async () => {
    const tile = game.ref(40, 40);
    player.conquer(tile);
    player.buildUnit(UnitType.Mine, tile, {});

    const maxTroops = Math.floor(game.config().maxTroops(player));
    player.setTroops(maxTroops);

    (
      game.config() as unknown as { turnIntervalMs: () => number }
    ).turnIntervalMs = () => 100;

    const startingGold = player.gold();
    executeTicks(game, 2);

    const goldGained = player.gold() - startingGold;
    const baseline = await computeBaselineGain();
    expect(goldGained).toBe(baseline);
  });

  test("Mine generates revenue without stationed troops", async () => {
    const tile = game.ref(60, 60);
    player.conquer(tile);
    player.buildUnit(UnitType.Mine, tile, {});

    player.setTroops(0);

    (
      game.config() as unknown as { turnIntervalMs: () => number }
    ).turnIntervalMs = () => 100;

    const startingGold = player.gold();
    executeTicks(game, 2);

    const goldGained = player.gold() - startingGold;
    const baseline = await computeBaselineGain();
    expect(goldGained).toBeGreaterThanOrEqual(baseline);
  });
});
