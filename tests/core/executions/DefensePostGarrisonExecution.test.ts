import {
  AssignDefensePostTroopsExecution,
  WithdrawDefensePostTroopsExecution,
} from "../../../src/core/execution/DefensePostGarrisonExecution";
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
});

const buildDefensePost = () => {
  const tile = game.ref(50, 50);
  player.conquer(tile);
  return player.buildUnit(UnitType.DefensePost, tile, {});
};

describe("DefensePost garrison executions", () => {
  test("assigns troops up to garrison capacity", () => {
    const defensePost = buildDefensePost();
    player.setTroops(200_000);
    const max = game.config().defensePostMaxGarrison();

    game.addExecution(
      new AssignDefensePostTroopsExecution(player, defensePost.id(), 300_000),
    );
    executeTicks(game, 2);

    expect(defensePost.troops()).toBe(max);
    expect(player.troops()).toBe(200_000 - max);
  });

  test("assignment is limited by available troops", () => {
    const defensePost = buildDefensePost();
    player.setTroops(10_000);

    game.addExecution(
      new AssignDefensePostTroopsExecution(player, defensePost.id(), 50_000),
    );
    executeTicks(game, 2);

    expect(defensePost.troops()).toBe(10_000);
    expect(player.troops()).toBe(0);
  });

  test("withdraw returns troops to reserve", () => {
    const defensePost = buildDefensePost();
    defensePost.setTroops(40_000);
    player.setTroops(0);

    game.addExecution(
      new WithdrawDefensePostTroopsExecution(player, defensePost.id(), 25_000),
    );
    executeTicks(game, 2);

    expect(defensePost.troops()).toBe(15_000);
    expect(player.troops()).toBe(25_000);
  });

  test("destroying a defense post refunds garrison", () => {
    const defensePost = buildDefensePost();
    defensePost.setTroops(30_000);
    player.setTroops(0);

    defensePost.delete();

    expect(player.troops()).toBe(30_000);
  });

  test("capturing a defense post refunds garrison to previous owner", () => {
    const defensePost = buildDefensePost();
    defensePost.setTroops(20_000);
    player.setTroops(0);
    otherPlayer.setTroops(0);

    defensePost.setOwner(otherPlayer as any);

    expect(player.troops()).toBe(20_000);
    expect(defensePost.troops()).toBe(0);
    expect(defensePost.owner()).toBe(otherPlayer);
  });

  test("garrisoned troops are excluded from regeneration", () => {
    const defensePost = buildDefensePost();
    const max = game.config().defensePostMaxGarrison();
    defensePost.setTroops(max);
    player.setTroops(0);

    const regen = game.config().troopIncreaseRate(player);
    expect(regen).toBe(0);
  });
});
