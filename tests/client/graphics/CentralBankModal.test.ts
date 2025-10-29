import { readFileSync } from "fs";
import { join } from "path";

const modalPath = join(
  __dirname,
  "../../../src/client/graphics/layers/CentralBankModal.ts",
);

describe("CentralBankModal styling", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(modalPath, "utf-8");
  });

  it("keeps the overlay fixed above the canvas", () => {
    expect(source).toMatch(/\.overlay\s*{[^}]*position:\s*fixed;/s);
    expect(source).toMatch(/\.overlay\s*{[^}]*z-index:\s*3000;/s);
  });

  it("no longer overrides createRenderRoot to return the light DOM", () => {
    expect(source).not.toMatch(
      /createRenderRoot\s*\(\)\s*{[^}]*return\s+this;?/,
    );
  });
});
