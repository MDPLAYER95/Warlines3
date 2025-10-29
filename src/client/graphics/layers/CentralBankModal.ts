import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { SendCentralBankMintIntentEvent } from "../../Transport";
import { renderNumber, translateText } from "../../Utils";

export class OpenCentralBankModalEvent {
  constructor(public readonly unitId: number) {}
}

@customElement("central-bank-modal")
export class CentralBankModal extends LitElement {
  @property({ attribute: false })
  get eventBus(): EventBus | null {
    return this._eventBus;
  }

  set eventBus(value: EventBus | null) {
    if (this._eventBus === value) return;
    if (this._eventBus) {
      this._eventBus.off(OpenCentralBankModalEvent, this.handleOpenEvent);
    }
    this._eventBus = value;
    if (this._eventBus) {
      this._eventBus.on(OpenCentralBankModalEvent, this.handleOpenEvent);
    }
  }

  @property({ attribute: false }) game: GameView | null = null;

  @state() private isOpen = false;
  @state() private unitId: number | null = null;
  @state() private sliderValue = 0;

  private _eventBus: EventBus | null = null;

  static styles = css`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 3000;
    }

    .modal {
      background: rgba(15, 23, 42, 0.95);
      padding: 1.5rem;
      border-radius: 0.75rem;
      width: min(420px, 90vw);
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      box-shadow: 0 20px 45px rgba(15, 23, 42, 0.6);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .description {
      font-size: 0.9rem;
      color: rgba(226, 232, 240, 0.9);
      line-height: 1.4;
    }

    .slider-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .slider-group input[type="range"] {
      width: 100%;
    }

    .footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    button {
      border: none;
      border-radius: 0.5rem;
      padding: 0.5rem 1rem;
      font-weight: 600;
      cursor: pointer;
    }

    .confirm {
      background: #22c55e;
      color: #03231b;
    }

    .confirm:disabled {
      background: rgba(148, 163, 184, 0.5);
      color: rgba(15, 23, 42, 0.6);
      cursor: not-allowed;
    }

    .cancel {
      background: rgba(148, 163, 184, 0.2);
      color: #e2e8f0;
    }

    .stats-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
    }
  `;

  createRenderRoot() {
    return this;
  }

  public openForUnit(unitId: number): void {
    this.unitId = unitId;
    this.sliderValue = 0;
    this.isOpen = true;
  }

  private handleOpenEvent = (event: OpenCentralBankModalEvent) => {
    this.openForUnit(event.unitId);
  };

  private closeModal() {
    this.isOpen = false;
    this.unitId = null;
    this.sliderValue = 0;
  }

  private getBank(): UnitView | null {
    if (!this.game || this.unitId === null) return null;
    const unit = this.game.unit(this.unitId);
    if (!unit || unit.type() !== UnitType.CentralBank) return null;
    return unit;
  }

  private getOwner(): PlayerView | null {
    const bank = this.getBank();
    if (!bank) return null;
    return bank.owner();
  }

  private maxMintable(owner: PlayerView | null): bigint {
    if (!owner || !this.game) return 0n;
    const capPercent = this.game.config().centralBankMintCapPercent();
    if (capPercent <= 0) return 0n;
    return (owner.totalGoldEarned() * BigInt(capPercent)) / 100n;
  }

  private onSliderChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value);
    if (!Number.isFinite(value)) return;
    this.sliderValue = Math.max(0, Math.min(100, Math.floor(value)));
  }

  private mintedAmount(owner: PlayerView | null): bigint {
    const max = this.maxMintable(owner);
    if (max <= 0n) return 0n;
    return (max * BigInt(this.sliderValue)) / 100n;
  }

  private confirm() {
    if (!this.eventBus || !this.game || this.unitId === null) {
      return;
    }
    const owner = this.getOwner();
    if (!owner) {
      this.closeModal();
      return;
    }
    const amount = this.mintedAmount(owner);
    if (amount <= 0n) {
      return;
    }
    const maxSafeAmount = BigInt(Number.MAX_SAFE_INTEGER);
    const amountToSend = amount > maxSafeAmount ? maxSafeAmount : amount;
    if (amountToSend <= 0n) {
      return;
    }
    this.eventBus.emit(
      new SendCentralBankMintIntentEvent(this.unitId, Number(amountToSend)),
    );
    this.closeModal();
  }

  render() {
    if (!this.isOpen) return null;
    const owner = this.getOwner();
    if (!owner || owner !== this.game?.myPlayer()) {
      this.closeModal();
      return null;
    }

    const remaining = owner.centralBankPrintsRemaining();
    const inflationPercent = owner.centralBankInflationPercent();
    const max = this.maxMintable(owner);
    const amount = this.mintedAmount(owner);
    const confirmDisabled =
      remaining <= 0 || max <= 0n || amount <= 0n || this.eventBus === null;

    return html`
      <div class="overlay" @click=${() => this.closeModal()}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          <div class="header">
            <h2 class="text-lg font-semibold">
              ${translateText("central_bank_modal.title")}
            </h2>
            <button class="cancel" @click=${() => this.closeModal()}>
              ${translateText("common.close")}
            </button>
          </div>

          <div class="description">
            ${translateText("central_bank_modal.description")}
          </div>

          <div class="stats-row">
            <span>${translateText("central_bank_modal.uses_remaining")}</span>
            <strong>${remaining}</strong>
          </div>
          <div class="stats-row">
            <span>${translateText("central_bank_modal.total_earned")}</span>
            <strong>${renderNumber(owner.totalGoldEarned())}</strong>
          </div>
          <div class="stats-row">
            <span>${translateText("central_bank_modal.max_issue")}</span>
            <strong>${renderNumber(max)}</strong>
          </div>
          <div class="stats-row">
            <span>${translateText("central_bank_modal.inflation")}</span>
            <strong>${inflationPercent}%</strong>
          </div>

          <div class="slider-group">
            <label for="bank-slider">
              ${translateText("central_bank_modal.slider_label")}
            </label>
            <input
              id="bank-slider"
              type="range"
              min="0"
              max="100"
              .value=${String(this.sliderValue)}
              ?disabled=${remaining <= 0 || max <= 0n}
              @input=${this.onSliderChange}
            />
            <div class="stats-row">
              <span>${translateText("central_bank_modal.requested")}</span>
              <strong>${renderNumber(amount)}</strong>
            </div>
          </div>

          <div class="description">
            ${translateText("central_bank_modal.inflation_warning")}
          </div>

          <div class="footer">
            <button class="cancel" @click=${() => this.closeModal()}>
              ${translateText("common.cancel")}
            </button>
            <button
              class="confirm"
              ?disabled=${confirmDisabled}
              @click=${() => this.confirm()}
            >
              ${translateText("central_bank_modal.confirm")}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

export const openCentralBankModal = (
  eventBus: EventBus | null,
  unitId: number,
): void => {
  if (eventBus) {
    eventBus.emit(new OpenCentralBankModalEvent(unitId));
  }

  const modalElement = document.querySelector("central-bank-modal");
  if (!modalElement) {
    return;
  }

  if (modalElement instanceof CentralBankModal) {
    modalElement.openForUnit(unitId);
    return;
  }

  customElements
    .whenDefined("central-bank-modal")
    .then(() => {
      const upgraded = modalElement as CentralBankModal | null;
      upgraded?.openForUnit(unitId);
    })
    .catch((error) => {
      console.error(
        "Failed waiting for central-bank-modal definition before opening",
        error,
      );
    });
};
