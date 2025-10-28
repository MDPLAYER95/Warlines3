import { CentralBankMintExecution } from "../../../src/core/execution/CentralBankMintExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

let game: Game;
let player: Player;
let bank: Unit;
let bankId: number;

describe("CentralBankMintExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");

    const tile = game.ref(40, 40);
    player.conquer(tile);
    bank = player.buildUnit(UnitType.CentralBank, tile, {});
    bankId = bank.id();
  });

  test("mints up to the configured cap and increases inflation", () => {
    player.addGold(10_000_000n);
    const earnedBeforeExecution = player.totalGoldEarned();
    expect(earnedBeforeExecution).toBe(10_000_000n);
    const startingGold = player.gold();
    expect(player.centralBankPrintsRemaining()).toBe(
      game.config().centralBankMaxPrints(),
    );
    expect(bank.isActive()).toBe(true);
    expect(bank.owner()).toBe(player);

    const execution = new CentralBankMintExecution(player, bankId, 2_000_000);
    game.addExecution(execution);
    game.executeNextTick();
    game.executeNextTick();

    const minted = player.gold() - startingGold;
    expect(minted).toBe(1_000_000n);
    expect(player.centralBankPrintsUsed()).toBe(1);
    expect(player.centralBankInflationPercent()).toBe(
      game.config().centralBankInflationPercent(),
    );
    expect(player.totalGoldEarned()).toBe(earnedBeforeExecution + minted);
  });

  test("does nothing when the bank is inactive", () => {
    const startingGold = player.gold();
    const printsBefore = player.centralBankPrintsUsed();
    bank.delete(false);

    const execution = new CentralBankMintExecution(player, bankId, 500_000);
    game.addExecution(execution);
    game.executeNextTick();
    game.executeNextTick();

    expect(player.gold()).toBe(startingGold);
    expect(player.centralBankPrintsUsed()).toBe(printsBefore);
  });

  test("stops minting once all prints are exhausted", () => {
    player.addGold(1_000_000n);
    player.applyCentralBankMint(1n);
    player.applyCentralBankMint(1n);
    player.applyCentralBankMint(1n);

    expect(player.centralBankPrintsRemaining()).toBe(0);
    const startingGold = player.gold();
    const inflationBefore = player.centralBankInflationPercent();

    const execution = new CentralBankMintExecution(player, bankId, 750_000);
    game.addExecution(execution);
    game.executeNextTick();
    game.executeNextTick();

    expect(player.gold()).toBe(startingGold);
    expect(player.centralBankPrintsUsed()).toBe(3);
    expect(player.centralBankInflationPercent()).toBe(inflationBefore);
  });
});
