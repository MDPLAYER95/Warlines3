import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import type { Config } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Gold, UnitType } from "../../../core/game/Game";
import type { SerializedExpeditionReport } from "../../../core/game/GameUpdates";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { AttackRatioEvent } from "../../InputHandler";
import {
  SendCustomsDutyIntentEvent,
  SendMilitaryRatioIntentEvent,
} from "../../Transport";
import { renderNumber, renderTroops } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

@customElement("control-panel")
export class ControlPanel extends LitElement implements Layer {
  public game: GameView | null = null;
  public clientID: ClientID;
  public eventBus: EventBus;
  public uiState: UIState;

  @state()
  private attackRatio: number = 0.2;

  @state()
  private _maxTroops: number = 0;

  @state()
  private troopRate: number = 0;

  @state()
  private _troops: number = 0;

  @state()
  private _garrisonedTroops: number = 0;

  @state()
  private _totalTroops: number = 0;

  @state()
  private _isVisible = false;

  @state()
  private _gold: Gold;

  private _troopRateIsIncreasing: boolean = true;

  private _lastTroopIncreaseRate: number;

  @state()
  private _militaryTargetRatio = 0.1;

  @state()
  private _militaryActualRatio = 0;

  @state()
  private _maxMilitaryRatio = 0.1;

  @state()
  private _civilianPopulation = 0;

  @state()
  private _militaryCamps = 0;

  @state()
  private _governmentType: "democracy" | "dictatorship" = "democracy";

  @state()
  private _isAdjustingMilitarySlider = false;

  @state()
  private alliedDuty = 0;

  @state()
  private otherDuty = 0;

  @state()
  private trainCapacityAvailable: bigint = 0n;

  @state()
  private trainCapacityTotal: bigint = 0n;

  @state()
  private seaCapacityAvailable: bigint = 0n;

  @state()
  private seaCapacityTotal: bigint = 0n;

  @state()
  private routeDiversity: SerializedExpeditionReport["diversity"] | null = null;

  @state()
  private expeditionLog: SerializedExpeditionReport[] = [];
  private showExpeditionLog = false;

  init() {
    this.attackRatio = Number(
      localStorage.getItem("settings.attackRatio") ?? "0.2",
    );
    this.uiState.attackRatio = this.attackRatio;
    this.eventBus.on(AttackRatioEvent, (event) => {
      let newAttackRatio =
        (parseInt(
          (document.getElementById("attack-ratio") as HTMLInputElement).value,
        ) +
          event.attackRatio) /
        100;

      if (newAttackRatio < 0.01) {
        newAttackRatio = 0.01;
      }

      if (newAttackRatio > 1) {
        newAttackRatio = 1;
      }

      if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
        // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep a consistency
        newAttackRatio = 0.1;
      }

      this.attackRatio = newAttackRatio;
      this.onAttackRatioChange(this.attackRatio);
    });
  }

  tick() {
    const game = this.game;
    if (!game) {
      return;
    }
    const config = game.config?.();
    if (!config) {
      return;
    }

    if (!this._isVisible && !game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = game.myPlayer();
    if (player === null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    if (game.ticks() % 5 === 0) {
      this.updateTroopIncrease(config);
    }

    const reserveTroops = player.troops();
    const garrisonedTroops = player.garrisonedTroops();

    this._troops = reserveTroops;
    this._garrisonedTroops = garrisonedTroops;
    this._totalTroops = reserveTroops + garrisonedTroops;
    this._maxTroops = config.maxTroops(player);
    this._gold = player.gold();
    this.troopRate = config.troopIncreaseRate(player) * 10;
    const serverTargetRatio = player.militaryRatioTarget();
    this._maxMilitaryRatio = player.maxMilitaryRatio();
    if (!this._isAdjustingMilitarySlider) {
      this._militaryTargetRatio = Math.min(
        serverTargetRatio,
        this._maxMilitaryRatio,
      );
    } else if (this._militaryTargetRatio > this._maxMilitaryRatio) {
      this._militaryTargetRatio = this._maxMilitaryRatio;
    }
    this._militaryActualRatio = player.militaryRatio();
    this._civilianPopulation = player.civilianPopulation();
    this._militaryCamps = player.units(UnitType.MilitaryCamp).length;
    this._governmentType = player.governmentType();
    this.alliedDuty = player.alliedCustomsRate();
    this.otherDuty = player.otherCustomsRate();
    const economy = player.economy();
    this.trainCapacityAvailable = BigInt(economy.trainCapacityAvailable);
    this.trainCapacityTotal = BigInt(economy.trainCapacityTotal);
    this.seaCapacityAvailable = BigInt(economy.seaCapacityAvailable);
    this.seaCapacityTotal = BigInt(economy.seaCapacityTotal);
    this.routeDiversity = economy.diversity;

    const updates = game.updatesSinceLastTick();
    if (updates) {
      const expeditionUpdates = updates[GameUpdateType.EconomyExpeditionEvent];
      if (expeditionUpdates.length > 0) {
        const newEntries = expeditionUpdates.map((evt) => evt.report);
        this.expeditionLog = [...newEntries, ...this.expeditionLog].slice(0, 5);
      }
    }
    this.requestUpdate();
  }

  private updateTroopIncrease(existingConfig?: Config) {
    const game = this.game;
    if (!game) return;
    const player = game.myPlayer();
    if (player === null) return;
    const config = existingConfig ?? game.config?.();
    if (!config) {
      return;
    }
    const troopIncreaseRate = config.troopIncreaseRate(player);
    this._troopRateIsIncreasing =
      troopIncreaseRate >= this._lastTroopIncreaseRate;
    this._lastTroopIncreaseRate = troopIncreaseRate;
  }

  onAttackRatioChange(newRatio: number) {
    this.uiState.attackRatio = newRatio;
  }

  private updateMilitaryTargetFromSlider(event: Event) {
    const slider = event.target as HTMLInputElement;
    if (!slider) {
      return;
    }
    const percent = Number(slider.value);
    if (Number.isNaN(percent)) {
      return;
    }
    const ratio = Math.max(0, Math.min(percent / 100, this._maxMilitaryRatio));
    this._militaryTargetRatio = ratio;
  }

  private onMilitaryRatioChange(event: Event) {
    this.updateMilitaryTargetFromSlider(event);
    this._isAdjustingMilitarySlider = false;
    const ratio = Math.max(
      0,
      Math.min(this._militaryTargetRatio, this._maxMilitaryRatio),
    );
    this.eventBus.emit(new SendMilitaryRatioIntentEvent(ratio));
  }

  private onMilitarySliderInput(event: Event) {
    this._isAdjustingMilitarySlider = true;
    this.updateMilitaryTargetFromSlider(event);
  }

  private onMilitarySliderPointerUp(event: PointerEvent) {
    if (!this._isAdjustingMilitarySlider) {
      return;
    }
    this.updateMilitaryTargetFromSlider(event);
    this._isAdjustingMilitarySlider = false;
  }

  private onCustomsDutyChange(category: "allies" | "others", event: Event) {
    const slider = event.target as HTMLInputElement;
    if (!slider) {
      return;
    }
    const value = Number(slider.value);
    if (Number.isNaN(value)) {
      return;
    }
    const rate = Math.max(0, Math.min(value / 100, 1));
    this.eventBus.emit(new SendCustomsDutyIntentEvent(category, rate));
  }

  private toggleExpeditionLog() {
    this.showExpeditionLog = !this.showExpeditionLog;
    this.requestUpdate();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Render any necessary canvas elements
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  render() {
    const game = this.game;
    if (!game) {
      return html``;
    }
    const config = game.config?.();
    if (!config) {
      return html``;
    }
    const militaryTargetPercent = Math.round(this._militaryTargetRatio * 100);
    const militaryActualPercent = Math.round(this._militaryActualRatio * 100);
    const militaryMaxPercent = Math.round(this._maxMilitaryRatio * 100);
    const sliderMax = Math.max(1, militaryMaxPercent);
    const sliderValue = Math.min(militaryTargetPercent, sliderMax);
    const sliderFill =
      sliderMax === 0
        ? 0
        : Math.max(0, Math.min(100, (sliderValue / sliderMax) * 100));
    const governmentKey =
      this._governmentType === "dictatorship"
        ? "control_panel.government_dictatorship"
        : "control_panel.government_democracy";
    const governmentLabel = translateText(governmentKey);
    const alliedPercent = Math.round(this.alliedDuty * 100);
    const otherPercent = Math.round(this.otherDuty * 100);
    const maxCustoms = Math.round(config.maxCustomsRate() * 100);
    const trainCapacityLabel = `${renderNumber(this.trainCapacityAvailable)} / ${renderNumber(this.trainCapacityTotal)}`;
    const seaCapacityLabel = `${renderNumber(this.seaCapacityAvailable)} / ${renderNumber(this.seaCapacityTotal)}`;
    const diversityTarget = Math.round(
      config.routeDiversityTargetShare() * 100,
    );
    const diversityInfo = this.routeDiversity;
    const diversityPercent = diversityInfo
      ? Math.round(diversityInfo.ratio * 100)
      : 0;
    const appliedPercent = diversityInfo?.appliedPercent ?? 100;
    const penaltyPercent = diversityInfo?.penaltyPercent ?? 0;
    const bonusPercent = diversityInfo?.bonusPercent ?? 0;
    const diversityStatusClass =
      appliedPercent < 100
        ? "text-yellow-400"
        : appliedPercent > 100
          ? "text-green-400"
          : "text-white/80";
    const diversityStatusText = diversityInfo
      ? appliedPercent > 100
        ? `Bonus +${bonusPercent.toFixed(0)}%`
        : appliedPercent < 100
          ? `Penalty ${penaltyPercent.toFixed(0)}%`
          : "Neutral"
      : "Neutral";
    const worldPathCount = diversityInfo?.worldPathCount ?? 0;
    const playerPathCount = diversityInfo?.playerPathCount ?? 0;

    return html`
      <style>
        input[type="range"] {
          -webkit-appearance: none;
          background: transparent;
          outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        .targetTroopRatio::-webkit-slider-thumb {
          border-color: rgb(59 130 246);
        }
        .targetTroopRatio::-moz-range-thumb {
          border-color: rgb(59 130 246);
        }
        .attackRatio::-webkit-slider-thumb {
          border-color: rgb(239 68 68);
        }
        .attackRatio::-moz-range-thumb {
          border-color: rgb(239 68 68);
        }
      </style>
      <div
        class="${this._isVisible
          ? "w-full sm:max-w-[320px] text-sm sm:text-base bg-gray-800/70 p-2 pr-3 sm:p-4 shadow-lg sm:rounded-lg backdrop-blur"
          : "hidden"}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="block bg-black/30 text-white mb-4 p-2 rounded">
          <div class="flex justify-between mb-1">
            <span class="font-bold"
              >${translateText("control_panel.total_troops")}:</span
            >
            <span translate="no"
              >${renderTroops(this._totalTroops)} /
              ${renderTroops(this._maxTroops)}</span
            >
          </div>
          <div class="flex justify-between text-xs sm:text-sm text-white/80">
            <span>${translateText("control_panel.reserve")}:</span>
            <span translate="no">${renderTroops(this._troops)}</span>
          </div>
          <div class="flex justify-between text-xs sm:text-sm text-white/80">
            <span>${translateText("control_panel.garrison")}:</span>
            <span translate="no">${renderTroops(this._garrisonedTroops)}</span>
          </div>
          <div class="flex justify-between text-xs sm:text-sm mt-1">
            <span>${translateText("control_panel.regen")}:</span>
            <span
              class="${this._troopRateIsIncreasing
                ? "text-green-500"
                : "text-yellow-500"}"
              translate="no"
              >+${renderTroops(this.troopRate)}</span
            >
          </div>
          <div class="flex justify-between mt-2">
            <span class="font-bold"
              >${translateText("control_panel.gold")}:</span
            >
            <span translate="no">${renderNumber(this._gold)}</span>
          </div>
        </div>

        <div class="relative mb-0 sm:mb-4">
          <label class="block text-white mb-1" translate="no"
            >${translateText("control_panel.attack_ratio")}:
            ${(this.attackRatio * 100).toFixed(0)}%
            (${renderTroops(this._troops * this.attackRatio)})</label
          >
          <div class="relative h-8">
            <!-- Background track -->
            <div
              class="absolute left-0 right-0 top-3 h-2 bg-white/20 rounded"
            ></div>
            <!-- Fill track -->
            <div
              class="absolute left-0 top-3 h-2 bg-red-500/60 rounded transition-all duration-300"
              style="width: ${this.attackRatio * 100}%"
            ></div>
            <!-- Range input - exactly overlaying the visual elements -->
            <input
              id="attack-ratio"
              type="range"
              min="1"
              max="100"
              .value=${(this.attackRatio * 100).toString()}
              @input=${(e: Event) => {
                this.attackRatio =
                  parseInt((e.target as HTMLInputElement).value) / 100;
                this.onAttackRatioChange(this.attackRatio);
              }}
              class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer attackRatio"
            />
          </div>
        </div>

        <div class="relative mb-0 sm:mb-4">
          <label class="block text-white mb-1" translate="no">
            ${translateText("control_panel.military_ratio")}: ${sliderValue}%
          </label>
          <div class="text-xs text-white/80 mb-2" translate="no">
            ${translateText("control_panel.military_ratio_detail", {
              target: String(sliderValue),
              actual: String(militaryActualPercent),
              max: String(militaryMaxPercent),
            })}
          </div>
          <div class="relative h-8">
            <div
              class="absolute left-0 right-0 top-3 h-2 bg-white/20 rounded"
            ></div>
            <div
              class="absolute left-0 top-3 h-2 bg-blue-500/60 rounded transition-all duration-300"
              style="width: ${Math.max(0, Math.min(100, sliderFill))}%"
            ></div>
            <input
              type="range"
              min="0"
              max="${sliderMax}"
              .value=${String(sliderValue)}
              @input=${(event: Event) => this.onMilitarySliderInput(event)}
              @change=${(event: Event) => this.onMilitaryRatioChange(event)}
              @pointerdown=${() => (this._isAdjustingMilitarySlider = true)}
              @pointerup=${(event: PointerEvent) =>
                this.onMilitarySliderPointerUp(event)}
              class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer targetTroopRatio"
            />
          </div>
          <div class="text-xs text-white/80 mt-2 space-y-1" translate="no">
            <div>${governmentLabel}</div>
            <div>
              ${translateText("control_panel.civilian_population", {
                civilians: renderTroops(this._civilianPopulation),
              })}
            </div>
            <div>
              ${translateText("control_panel.military_camps", {
                count: String(this._militaryCamps),
              })}
            </div>
            <div class="text-white/60">
              ${translateText("control_panel.military_slider_hint")}
            </div>
          </div>
        </div>

        <div class="block bg-black/30 text-white mb-4 p-2 rounded">
          <div class="font-bold mb-2">Customs Duties</div>
          <div class="mb-3">
            <label class="block text-xs text-white/80 mb-1">
              Allies: ${alliedPercent}%
            </label>
            <input
              type="range"
              min="0"
              max="${maxCustoms}"
              .value=${String(alliedPercent)}
              class="w-full h-4 cursor-pointer"
              @change=${(event: Event) =>
                this.onCustomsDutyChange("allies", event)}
            />
          </div>
          <div>
            <label class="block text-xs text-white/80 mb-1">
              Others: ${otherPercent}%
            </label>
            <input
              type="range"
              min="0"
              max="${maxCustoms}"
              .value=${String(otherPercent)}
              class="w-full h-4 cursor-pointer"
              @change=${(event: Event) =>
                this.onCustomsDutyChange("others", event)}
            />
          </div>
        </div>

        <div class="block bg-black/30 text-white mb-4 p-2 rounded space-y-1">
          <div class="font-bold">Logistics</div>
          <div class="flex justify-between text-xs text-white/80">
            <span>Train capacity</span>
            <span translate="no">${trainCapacityLabel}</span>
          </div>
          <div class="flex justify-between text-xs text-white/80">
            <span>Sea capacity</span>
            <span translate="no">${seaCapacityLabel}</span>
          </div>
          <div class="flex justify-between text-xs text-white/80">
            <span>Route diversity</span>
            <span translate="no"
              >${diversityPercent}% (goal ${diversityTarget}%)</span
            >
          </div>
          <div class="flex justify-between text-xs text-white/80">
            <span>Routes used</span>
            <span translate="no">${playerPathCount} / ${worldPathCount}</span>
          </div>
          <div class="text-xs ${diversityStatusClass}">
            ${diversityStatusText} · Applied ${appliedPercent.toFixed(0)}%
          </div>
        </div>

        <div class="block bg-black/30 text-white mb-2 p-2 rounded">
          <div class="flex items-center justify-between mb-1">
            <span class="font-bold">Recent expeditions</span>
            <button
              class="text-xs px-2 py-1 bg-white/10 rounded hover:bg-white/20 transition"
              @click=${() => this.toggleExpeditionLog()}
            >
              ${this.showExpeditionLog ? "Hide" : "View"}
            </button>
          </div>
          ${this.expeditionLog.length === 0
            ? html`<div class="text-xs text-white/70">No shipments yet.</div>`
            : html`<div class="text-xs text-white/70">
                Latest credit:
                <span class="text-white" translate="no"
                  >${renderNumber(
                    BigInt(this.expeditionLog[0].creditedGold),
                  )}</span
                >
              </div>`}
          ${this.showExpeditionLog && this.expeditionLog.length > 0
            ? html`<ul class="space-y-2 mt-2 max-h-40 overflow-y-auto pr-1">
                ${this.expeditionLog.map((entry) => {
                  const customsSummary =
                    entry.customs.length === 0
                      ? "No customs"
                      : entry.customs
                          .map((custom) => {
                            const ownerView = game.playerBySmallID(
                              custom.owner,
                            );
                            const name = ownerView.isPlayer()
                              ? ownerView.displayName()
                              : custom.owner === 0
                                ? "Neutral"
                                : `P${custom.owner}`;
                            const relationLabel =
                              custom.relation === "ally" ? "Allied" : "Other";
                            return `${name} ${relationLabel} ${custom.ratePercent.toFixed(
                              1,
                            )}%: ${renderNumber(BigInt(custom.amount))}`;
                          })
                          .join("; ");
                  return html`<li class="border border-white/10 rounded p-2">
                    <div class="flex justify-between text-xs text-white/80">
                      <span>Initial</span>
                      <span translate="no"
                        >${renderNumber(BigInt(entry.initialGold))}</span
                      >
                    </div>
                    <div class="flex justify-between text-xs text-white/80">
                      <span>After customs</span>
                      <span translate="no"
                        >${renderNumber(BigInt(entry.deliveredGold))}</span
                      >
                    </div>
                    <div class="flex justify-between text-xs text-white">
                      <span>Credit</span>
                      <span translate="no"
                        >${renderNumber(BigInt(entry.creditedGold))}</span
                      >
                    </div>
                    <div class="text-[10px] text-white/70 mt-1">
                      ${customsSummary}
                    </div>
                    <div class="text-[10px] text-white/60">
                      Route nodes: ${entry.path.length}
                      ${entry.hadSeaSegment ? "· includes sea segment" : ""}
                    </div>
                  </li>`;
                })}
              </ul>`
            : null}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
