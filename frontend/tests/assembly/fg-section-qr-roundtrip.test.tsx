import { expect, it } from "vitest";
import QRCode from "qrcode";
import jsQR from "jsqr";

it("all eight section QR identities survive image encoding and upload decoder", () => {
  const identities = Array.from(
    { length: 8 },
    (_, i) => `FGSECTION|11726d91-342c-4057-a851-9282e76cf306|S0${i + 1}|unique-token-${i + 1}`,
  );
  for (const identity of identities) {
    const { modules } = QRCode.create(identity);
    const scale = 6,
      margin = 4,
      width = (modules.size + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(width * width * 4);
    for (let y = 0; y < width; y++)
      for (let x = 0; x < width; x++) {
        const row = Math.floor(y / scale) - margin,
          col = Math.floor(x / scale) - margin;
        const dark =
          row >= 0 && col >= 0 && row < modules.size && col < modules.size && modules.get(row, col);
        const offset = (y * width + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = dark ? 0 : 255;
        pixels[offset + 3] = 255;
      }
    expect(jsQR(pixels, width, width)?.data).toBe(identity);
  }
});
