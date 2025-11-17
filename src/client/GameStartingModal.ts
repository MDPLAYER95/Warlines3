import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "./Utils";

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  static styles = css`
    .modal {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(
        145deg,
        rgba(15, 23, 42, 0.85),
        rgba(8, 12, 24, 0.92)
      );
      padding: 28px;
      border-radius: 24px;
      z-index: 9999;
      border: 1px solid rgba(148, 163, 184, 0.35);
      box-shadow: 0 24px 60px rgba(2, 6, 23, 0.75);
      backdrop-filter: blur(14px);
      color: #f8fafc;
      width: min(360px, 90vw);
      text-align: center;
      transition:
        opacity 0.3s ease-in-out,
        visibility 0.3s ease-in-out;
    }

    .modal.visible {
      display: block;
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translate(-50%, -48%);
      }
      to {
        opacity: 1;
        transform: translate(-50%, -50%);
      }
    }

    .modal h2 {
      margin-bottom: 18px;
      font-size: 22px;
      color: #f8fafc;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .modal p {
      margin-bottom: 22px;
      background: rgba(15, 23, 42, 0.65);
      padding: 14px;
      border-radius: 16px;
      border: 1px solid rgba(148, 163, 184, 0.25);
    }

    .button-container {
      display: flex;
      justify-content: center;
      gap: 10px;
    }

    .modal button {
      padding: 12px 18px;
      font-size: 16px;
      cursor: pointer;
      background: linear-gradient(135deg, #f97316, #fb923c);
      color: #0f172a;
      border: 1px solid rgba(249, 115, 22, 0.6);
      border-radius: 14px;
      font-weight: 600;
      letter-spacing: 0.08em;
      transition:
        transform 0.1s ease,
        box-shadow 0.2s ease,
        filter 0.2s ease;
      box-shadow: 0 16px 30px rgba(249, 115, 22, 0.3);
    }

    .modal button:hover {
      transform: translateY(-2px);
      filter: brightness(1.05);
      box-shadow: 0 20px 40px rgba(249, 115, 22, 0.4);
    }

    .modal button:active {
      transform: translateY(1px);
    }

    .copyright {
      font-size: 0.85rem;
      margin-top: 18px;
      letter-spacing: 0.4em;
      text-transform: uppercase;
      color: rgba(148, 163, 184, 0.75);
    }
  `;

  render() {
    return html`
      <div class="modal ${this.isVisible ? "visible" : ""}">
        <div class="copyright">© WarLines — Based on OpenFront</div>
        <h5>${translateText("game_starting_modal.code_license")}</h5>
        <p>${translateText("game_starting_modal.title")}</p>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}
