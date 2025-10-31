import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { Gold, UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { AttackRatioEvent } from "../../InputHandler";
import { SendMilitaryRatioIntentEvent } from "../../Transport";
import { renderNumber, renderTroops } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

@customElement("control-panel")
export class ControlPanel extends LitElement implements Layer {
  public game: GameView;
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
    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    if (this.game.ticks() % 5 === 0) {
      this.updateTroopIncrease();
    }

    const reserveTroops = player.troops();
    const garrisonedTroops = player.garrisonedTroops();

    this._troops = reserveTroops;
    this._garrisonedTroops = garrisonedTroops;
    this._totalTroops = reserveTroops + garrisonedTroops;
    this._maxTroops = this.game.config().maxTroops(player);
    this._gold = player.gold();
    this.troopRate = this.game.config().troopIncreaseRate(player) * 10;
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
    this.requestUpdate();
  }

  private updateTroopIncrease() {
    const player = this.game?.myPlayer();
    if (player === null) return;
    const troopIncreaseRate = this.game.config().troopIncreaseRate(player);
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
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
