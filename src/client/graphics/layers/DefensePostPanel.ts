import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { SendAssignDefensePostTroopsIntentEvent } from "../../Transport";
import { renderTroops, translateText } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

export class ShowDefensePostPanelEvent implements GameEvent {
  constructor(public readonly unitId: number) {}
}

export class HideDefensePostPanelEvent implements GameEvent {}

@customElement("defense-post-panel")
export class DefensePostPanel extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  // UIState kept for parity with other panels, currently unused but allows future tweaks.
  public uiState: UIState;

  @state() private isVisible = false;
  @state() private unitId: number | null = null;
  @state() private garrison = 0;
  @state() private maxGarrison = 0;
  @state() private reserve = 0;
  @state() private defenseMultiplier = 1;
  @state() private speedMultiplier = 1;
  @state() private garrisonLevel = 0;
  @state() private levelProgress = 0;
  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(ShowDefensePostPanelEvent, (event) => this.show(event));
    this.eventBus.on(HideDefensePostPanelEvent, () => this.hide());
  }

  tick() {
    if (!this.isVisible) {
      return;
    }
    this.updateState();
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(): void {}

  private show(event: ShowDefensePostPanelEvent) {
    this.unitId = event.unitId;
    this.isVisible = true;
    this.updateState();
  }

  private hide() {
    this.isVisible = false;
    this.unitId = null;
  }

  private updateState() {
    if (this.unitId === null) {
      return;
    }
    const unit = this.game.unit(this.unitId);
    const myPlayer = this.game.myPlayer();
    if (
      unit === undefined ||
      !unit.isActive() ||
      unit.type() !== UnitType.DefensePost ||
      myPlayer === null ||
      unit.owner() !== myPlayer
    ) {
      this.hide();
      return;
    }

    this.garrison = unit.troops();
    this.maxGarrison = this.game.config().defensePostMaxGarrison();
    this.reserve = myPlayer.troops();
    const bonuses = this.game
      .config()
      .defensePostGarrisonBonuses(this.garrison);
    this.defenseMultiplier = bonuses.defenseMultiplier;
    this.speedMultiplier = bonuses.speedMultiplier;
    this.garrisonLevel = bonuses.level;
    this.levelProgress = bonuses.capacityRatio;
  }

  private setGarrisonTarget(targetFraction: number) {
    if (!this.isVisible || this.unitId === null || this.maxGarrison <= 0) {
      return;
    }

    const desired = Math.floor(this.maxGarrison * targetFraction);
    const target = Math.max(0, Math.min(desired, this.maxGarrison));

    if (target <= this.garrison) {
      return;
    }

    const maxAssignable = Math.min(
      this.maxGarrison - this.garrison,
      this.reserve,
    );
    const assignAmount = Math.min(target - this.garrison, maxAssignable);
    if (assignAmount <= 0) {
      return;
    }
    this.eventBus.emit(
      new SendAssignDefensePostTroopsIntentEvent(this.unitId, assignAmount),
    );
  }

  private renderFillButton(fraction: number, highlightFraction: number) {
    const percentValue = Math.round(fraction * 100);
    const target = Math.max(
      0,
      Math.min(Math.floor(this.maxGarrison * fraction), this.maxGarrison),
    );
    const isHighlighted =
      this.maxGarrison > 0 &&
      fraction === highlightFraction &&
      this.garrison > 0;
    const label = translateText("defense_post_panel.fill_to", {
      percent: String(percentValue),
    });
    const tooltip = translateText("defense_post_panel.fill_tooltip", {
      percent: `${percentValue}%`,
      troops: renderTroops(target),
    });
    const baseClasses =
      "px-3 py-2 rounded font-semibold transition text-sm focus:outline-none";
    const stateClasses = isHighlighted
      ? " bg-blue-600 hover:bg-blue-500"
      : " bg-white/10 hover:bg-white/20";
    const canIncrease = target > this.garrison;
    let assignable = 0;
    if (canIncrease) {
      const maxAssignable = Math.min(
        this.maxGarrison - this.garrison,
        this.reserve,
      );
      assignable = Math.min(target - this.garrison, maxAssignable);
    }
    const disabled = this.maxGarrison <= 0 || assignable <= 0;
    return html`
      <button
        type="button"
        class="${baseClasses}${stateClasses}"
        title="${tooltip}"
        aria-label="${label}"
        ?disabled=${disabled}
        @click=${() => this.setGarrisonTarget(fraction)}
      >
        ${percentValue}%
      </button>
    `;
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    const defenseDisplay = this.defenseMultiplier.toFixed(2);
    const speedDisplay = this.speedMultiplier.toFixed(2);
    const fillOptions = [0.25, 0.5, 0.75, 1];
    let highlightFraction = 0;
    if (this.maxGarrison > 0) {
      const currentFraction = this.levelProgress;
      for (const option of fillOptions) {
        if (currentFraction >= option) {
          highlightFraction = option;
        }
      }
    }

    const maxLevel = 4;
    const levelColors = ["#64748b", "#38bdf8", "#22c55e", "#f59e0b", "#ef4444"];
    const nextLevelPercent = Math.min((this.garrisonLevel + 1) * 25, 100);
    const levelValue = translateText("defense_post_panel.level_value", {
      level: String(this.garrisonLevel),
      max: String(maxLevel),
    });
    const progressWithinLevel =
      this.garrisonLevel >= maxLevel
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              (this.levelProgress - this.garrisonLevel / maxLevel) * maxLevel,
            ),
          );
    const nextHint =
      this.garrisonLevel >= maxLevel
        ? translateText("defense_post_panel.max_level")
        : translateText("defense_post_panel.next_level_hint", {
            percent: `${nextLevelPercent}%`,
          });
    const progressColor =
      levelColors[Math.min(this.garrisonLevel, levelColors.length - 1)];

    return html`
      <div
        class="fixed bottom-32 right-4 z-50 max-w-sm w-full sm:w-80 bg-gray-900/90 text-white p-4 rounded-lg shadow-xl border border-white/10 backdrop-blur"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold text-lg" translate="no">
            ${translateText("defense_post_panel.heading")}
          </h3>
          <button
            class="text-sm text-white/70 hover:text-white"
            @click=${() => this.hide()}
            aria-label="${translateText("defense_post_panel.close")}"
          >
            ✕
          </button>
        </div>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span>${translateText("defense_post_panel.garrison")}:</span>
            <span translate="no">
              ${renderTroops(this.garrison)} / ${renderTroops(this.maxGarrison)}
            </span>
          </div>
          <div class="flex justify-between">
            <span>${translateText("defense_post_panel.reserve")}:</span>
            <span translate="no">${renderTroops(this.reserve)}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span>${translateText("defense_post_panel.level")}</span>
            <span class="font-semibold" translate="no">${levelValue}</span>
          </div>
          <div class="space-y-1">
            <div class="h-2 bg-white/10 rounded">
              <div
                class="h-2 rounded"
                style="
                  width: ${Math.round(progressWithinLevel * 100)}%;
                  background-color: ${progressColor};
                "
              ></div>
            </div>
            <span class="text-xs text-white/70">${nextHint}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="font-semibold">
              ${translateText("defense_post_panel.effect")}
            </span>
            <span>
              ${translateText("defense_post_panel.defense_multiplier", {
                value: defenseDisplay,
              })}
            </span>
            <span>
              ${translateText("defense_post_panel.speed_multiplier", {
                value: speedDisplay,
              })}
            </span>
            <span class="text-xs text-white/70">
              ${translateText("defense_post_panel.effect_hint")}
            </span>
          </div>
          <div class="bg-white/5 p-2 rounded text-xs text-white/80">
            ${translateText("defense_post_panel.note")}
          </div>
        </div>

        <div class="mt-4 space-y-2 text-sm">
          <span class="font-semibold">
            ${translateText("defense_post_panel.quick_fill")}
          </span>
          <div class="grid grid-cols-2 gap-2">
            ${fillOptions.map((fraction) =>
              this.renderFillButton(fraction, highlightFraction),
            )}
          </div>
        </div>
      </div>
    `;
  }
}
