import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UpdateSubmarineOrdersIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";

export class OpenSubmarineOrdersModalEvent {
  constructor(public readonly unitId: number) {}
}

@customElement("submarine-orders-modal")
export class SubmarineOrdersModal extends LitElement {
  @property({ attribute: false })
  get eventBus(): EventBus | null {
    return this._eventBus;
  }

  set eventBus(value: EventBus | null) {
    if (this._eventBus === value) return;
    if (this._eventBus) {
      this._eventBus.off(OpenSubmarineOrdersModalEvent, this.handleOpenEvent);
    }
    this._eventBus = value;
    if (this._eventBus) {
      this._eventBus.on(OpenSubmarineOrdersModalEvent, this.handleOpenEvent);
    }
  }

  @property({ attribute: false }) game: GameView | null = null;

  @state() private isOpen = false;
  @state() private unitId: number | null = null;
  @state() private attackWarships = true;
  @state() private useMissiles = true;

  private _eventBus: EventBus | null = null;

  static styles = css`
    .overlay {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.6);
      z-index: 3200;
    }

    .modal {
      background: rgba(15, 23, 42, 0.94);
      padding: 1.5rem;
      border-radius: 0.75rem;
      width: min(360px, 90vw);
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.5);
    }

    h2 {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 600;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: rgba(30, 41, 59, 0.6);
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
    }

    .toggle-row label {
      flex: 1;
      cursor: pointer;
      font-size: 0.95rem;
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

    .close {
      background: rgba(148, 163, 184, 0.2);
      color: #e2e8f0;
    }
  `;

  private handleOpenEvent = (event: OpenSubmarineOrdersModalEvent) => {
    if (!this.game) {
      return;
    }
    const unit = this.game.unit(event.unitId);
    if (!unit || unit.type() !== UnitType.Submarine) {
      return;
    }
    const orders = unit.submarineOrders();
    this.unitId = unit.id();
    this.attackWarships = orders?.attackWarships ?? true;
    this.useMissiles = orders?.useMissiles ?? true;
    this.isOpen = true;
  };

  private emitUpdate() {
    if (!this._eventBus || this.unitId === null) {
      return;
    }
    this._eventBus.emit(
      new UpdateSubmarineOrdersIntentEvent(
        this.unitId,
        this.attackWarships,
        this.useMissiles,
      ),
    );
  }

  private onAttackToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.attackWarships = !checked;
    this.emitUpdate();
  }

  private onMissileToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.useMissiles = !checked;
    this.emitUpdate();
  }

  private closeModal() {
    this.isOpen = false;
    this.unitId = null;
  }

  render() {
    if (!this.isOpen) {
      return null;
    }

    return html`
      <div class="overlay" @click=${this.closeModal}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          <div>
            <h2>${translateText("submarine_orders.title")}</h2>
            <p>${translateText("submarine_orders.description")}</p>
          </div>
          <div class="toggle-row">
            <input
              type="checkbox"
              id="submarine-no-warships"
              .checked=${!this.attackWarships}
              @change=${this.onAttackToggle}
            />
            <label for="submarine-no-warships">
              ${translateText("submarine_orders.no_warships")}
            </label>
          </div>
          <div class="toggle-row">
            <input
              type="checkbox"
              id="submarine-no-missiles"
              .checked=${!this.useMissiles}
              @change=${this.onMissileToggle}
            />
            <label for="submarine-no-missiles">
              ${translateText("submarine_orders.no_missiles")}
            </label>
          </div>
          <div class="footer">
            <button class="close" @click=${this.closeModal}>
              ${translateText("submarine_orders.close")}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

export const openSubmarineOrdersModal = (
  eventBus: EventBus,
  unitId: number,
): void => {
  eventBus.emit(new OpenSubmarineOrdersModalEvent(unitId));
};
