import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import {
  SendAssignDefensePostTroopsIntentEvent,
  SendWithdrawDefensePostTroopsIntentEvent,
} from "../../Transport";
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
  @state() private assignInput = 0;
  @state() private withdrawInput = 0;

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
    this.assignInput = 0;
    this.withdrawInput = 0;
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

    const maxAssignable = Math.max(
      0,
      Math.min(this.maxGarrison - this.garrison, this.reserve),
    );
    if (this.assignInput > maxAssignable) {
      this.assignInput = Math.max(0, Math.floor(maxAssignable));
    }
    if (this.withdrawInput > this.garrison) {
      this.withdrawInput = Math.max(0, Math.floor(this.garrison));
    }
  }

  private onAssignInputChange(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      this.assignInput = Math.max(0, Math.floor(value));
    } else {
      this.assignInput = 0;
    }
  }

  private onWithdrawInputChange(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      this.withdrawInput = Math.max(0, Math.floor(value));
    } else {
      this.withdrawInput = 0;
    }
  }

  private assignTroops() {
    if (!this.isVisible || this.unitId === null) {
      return;
    }
    const capacity = Math.max(0, this.maxGarrison - this.garrison);
    const available = Math.max(0, Math.min(capacity, this.reserve));
    const amount = Math.min(
      available,
      Math.max(0, Math.floor(this.assignInput)),
    );
    if (amount <= 0) {
      return;
    }
    this.eventBus.emit(
      new SendAssignDefensePostTroopsIntentEvent(this.unitId, amount),
    );
    this.assignInput = 0;
  }

  private withdrawTroops() {
    if (!this.isVisible || this.unitId === null) {
      return;
    }
    const amount = Math.min(
      this.garrison,
      Math.max(0, Math.floor(this.withdrawInput)),
    );
    if (amount <= 0) {
      return;
    }
    this.eventBus.emit(
      new SendWithdrawDefensePostTroopsIntentEvent(this.unitId, amount),
    );
    this.withdrawInput = 0;
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    const assignCap = Math.max(
      0,
      Math.min(this.maxGarrison - this.garrison, this.reserve),
    );
    const defenseDisplay = this.defenseMultiplier.toFixed(2);
    const speedDisplay = this.speedMultiplier.toFixed(2);

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
          </div>
          <div class="bg-white/5 p-2 rounded text-xs text-white/80">
            ${translateText("defense_post_panel.note")}
          </div>
        </div>

        <div class="mt-4 space-y-3 text-sm">
          <div class="space-y-1">
            <label class="block text-white/80" for="assign-input">
              ${translateText("defense_post_panel.assign_label", {
                cap: renderTroops(assignCap),
              })}
            </label>
            <div class="flex gap-2">
              <input
                id="assign-input"
                type="number"
                min="0"
                class="flex-1 rounded bg-white/10 border border-white/10 px-2 py-1 text-white"
                .value=${String(this.assignInput)}
                @input=${this.onAssignInputChange}
              />
              <button
                class="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                @click=${() => this.assignTroops()}
              >
                ${translateText("defense_post_panel.assign")}
              </button>
            </div>
          </div>

          <div class="space-y-1">
            <label class="block text-white/80" for="withdraw-input">
              ${translateText("defense_post_panel.withdraw_label", {
                cap: renderTroops(this.garrison),
              })}
            </label>
            <div class="flex gap-2">
              <input
                id="withdraw-input"
                type="number"
                min="0"
                class="flex-1 rounded bg-white/10 border border-white/10 px-2 py-1 text-white"
                .value=${String(this.withdrawInput)}
                @input=${this.onWithdrawInputChange}
              />
              <button
                class="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white"
                @click=${() => this.withdrawTroops()}
              >
                ${translateText("defense_post_panel.withdraw")}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
