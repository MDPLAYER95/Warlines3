import {
  EconomyReport,
  Game,
  Gold,
  LogisticsContext,
  Player,
  PlayerEconomy,
  UnitType,
} from "./Game";

const LOGISTICS_CONTEXTS: LogisticsContext[] = [
  "city",
  "factory",
  "mine",
  "port",
];

function emptyReport(): EconomyReport {
  return {
    miningOutput: 0n,
    industrialOutput: 0n,
    tradeOutput: 0n,
    cityGold: 0n,
    logisticsBonus: 0n,
    logisticsByContext: {
      city: 0n,
      factory: 0n,
      mine: 0n,
      port: 0n,
    },
    allianceBonus: 0n,
    customsPaid: 0n,
    customsEarned: 0n,
    netGold: 0n,
  };
}

export class PlayerEconomyImpl implements PlayerEconomy {
  private pendingLogisticsBonus: Gold = 0n;
  private pendingLogisticsByContext: Record<LogisticsContext, Gold> = {
    city: 0n,
    factory: 0n,
    mine: 0n,
    port: 0n,
  };
  private customsPaid: Gold = 0n;
  private customsEarned: Gold = 0n;
  private report: EconomyReport = emptyReport();

  constructor(
    private readonly game: Game,
    private readonly owner: Player,
  ) {}

  tick(): Gold {
    const config = this.game.config();

    const mineExtraction = this.sumOutputs(UnitType.Mine, (level) =>
      config.economyMineOutput(level),
    );
    const factoryCapacitySelf = this.sumOutputs(UnitType.Factory, (level) =>
      config.economyFactoryThroughput(level),
    );
    const portCapacitySelf = this.sumOutputs(UnitType.Port, (level) =>
      config.economyPortLogistics(level),
    );
    const cityGoldValue = this.sumOutputs(UnitType.City, (level) =>
      config.economyCityWealth(level),
    );

    const alliedShare = config.economyAlliedStructureShare();
    const alliedFactoryCapacity = Math.floor(
      this.owner
        .allies()
        .filter((ally) => ally.isAlive())
        .reduce(
          (sum, ally) =>
            sum +
            this.sumOutputsForPlayer(ally, UnitType.Factory, (level) =>
              config.economyFactoryThroughput(level),
            ),
          0,
        ) * alliedShare,
    );
    const alliedPortCapacity = Math.floor(
      this.owner
        .allies()
        .filter((ally) => ally.isAlive())
        .reduce(
          (sum, ally) =>
            sum +
            this.sumOutputsForPlayer(ally, UnitType.Port, (level) =>
              config.economyPortLogistics(level),
            ),
          0,
        ) * alliedShare,
    );

    const factoryCapacity = factoryCapacitySelf + alliedFactoryCapacity;
    const processed = Math.min(mineExtraction, factoryCapacity);
    const remainingRaw = Math.max(0, mineExtraction - processed);

    const portCapacity = portCapacitySelf + alliedPortCapacity;
    const exported = Math.min(remainingRaw + processed, portCapacity);

    const manufacturingGold = BigInt(
      processed * config.economyManufacturedGoodValue(),
    );
    const exportGold = BigInt(exported * config.economyTradeGoodValue());
    const cityGold = BigInt(cityGoldValue);

    let netGold =
      manufacturingGold + exportGold + cityGold + this.pendingLogisticsBonus;

    const logisticsSnapshot: Record<LogisticsContext, Gold> = {
      city: this.pendingLogisticsByContext.city,
      factory: this.pendingLogisticsByContext.factory,
      mine: this.pendingLogisticsByContext.mine,
      port: this.pendingLogisticsByContext.port,
    };

    const report: EconomyReport = {
      miningOutput: BigInt(mineExtraction),
      industrialOutput: BigInt(processed),
      tradeOutput: BigInt(exported),
      cityGold,
      logisticsBonus: this.pendingLogisticsBonus,
      logisticsByContext: logisticsSnapshot,
      allianceBonus: 0n,
      customsPaid: this.customsPaid,
      customsEarned: this.customsEarned,
      netGold: 0n,
    };

    const activeAlliances = this.owner
      .alliances()
      .filter((alliance) => alliance.expiresAt() > this.game.ticks()).length;
    const alliancePercent = config.economyAllianceBonus(activeAlliances);
    if (alliancePercent > 0) {
      const bonus = (netGold * BigInt(alliancePercent)) / 100n;
      netGold += bonus;
      report.allianceBonus = bonus;
    }

    report.netGold = netGold;
    this.report = report;

    this.pendingLogisticsBonus = 0n;
    for (const ctx of LOGISTICS_CONTEXTS) {
      this.pendingLogisticsByContext[ctx] = 0n;
    }
    this.customsPaid = 0n;
    this.customsEarned = 0n;

    return netGold;
  }

  registerLogisticsBonus(amount: Gold, context: LogisticsContext): void {
    if (amount <= 0n) {
      return;
    }
    this.pendingLogisticsBonus += amount;
    this.pendingLogisticsByContext[context] =
      (this.pendingLogisticsByContext[context] ?? 0n) + amount;
  }

  recordCustomsPayment(amount: Gold): void {
    if (amount <= 0n) {
      return;
    }
    this.customsPaid += amount;
  }

  recordCustomsRevenue(amount: Gold): void {
    if (amount <= 0n) {
      return;
    }
    this.customsEarned += amount;
  }

  lastReport(): EconomyReport {
    return this.report;
  }

  private sumOutputs(
    type: UnitType,
    mapper: (level: number) => number,
  ): number {
    return this.owner
      .units(type)
      .reduce((sum, unit) => sum + mapper(unit.level()), 0);
  }

  private sumOutputsForPlayer(
    player: Player,
    type: UnitType,
    mapper: (level: number) => number,
  ): number {
    return player
      .units(type)
      .reduce((sum, unit) => sum + mapper(unit.level()), 0);
  }
}
