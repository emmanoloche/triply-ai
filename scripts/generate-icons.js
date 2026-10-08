// One-off script to regenerate the app icon assets from design/logo.png
// (the real Triply brand mark) using jimp-compact, which is already a
// dependency of @expo/image-utils — no extra install needed. Run with:
//   node scripts/generate-icons.js
// Safe to delete after running; it's not part of the app's runtime code.
const Jimp = require("jimp-compact");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LOGO = path.join(ROOT, "design", "logo.png");
const OUT = (name) => path.join(ROOT, "assets", "images", name);

// Matches the existing app.json adaptiveIcon.backgroundColor (#E6F4FE) so the
// new foreground sits on the same light-blue field already configured.
const BG_HEX = 0xe6f4fe_ff;
const WHITE_HEX = 0xffffff_ff;

/** Scales `img` (mutates a clone) to fit within box×box, preserving aspect ratio. */
async function scaledCopy(box) {
  const img = await Jimp.read(LOGO);
  const scale = Math.min(box / img.bitmap.width, box / img.bitmap.height);
  return img.clone().scale(scale);
}

/** Centers `img` onto a new square canvas of the given size and background color (or transparent if omitted). */
function centerOn(size, img, bgHex) {
  const canvas = new Jimp(size, size, bgHex ?? 0x00000000);
  const x = Math.round((size - img.bitmap.width) / 2);
  const y = Math.round((size - img.bitmap.height) / 2);
  canvas.composite(img, x, y);
  return canvas;
}

async function main() {
  // 1. Main icon (1024x1024): white background, logo at ~78% to leave a
  //    margin — iOS icons shouldn't be edge-to-edge or have transparency.
  const mainLogo = await scaledCopy(1024 * 0.78);
  const mainIcon = centerOn(1024, mainLogo, WHITE_HEX);
  await mainIcon.writeAsync(OUT("icon.png"));

  // 2. Android adaptive icon foreground (512x512): transparent, scaled to
  //    ~62% so it survives being clipped to a circle/squircle/rounded-square
  //    mask by different Android launchers (the standard adaptive-icon safe
  //    zone is the center ~66% of the canvas).
  const fgLogo = await scaledCopy(512 * 0.62);
  const foreground = centerOn(512, fgLogo, null);
  await foreground.writeAsync(OUT("android-icon-foreground.png"));

  // 3. Android adaptive icon background (512x512): solid fill matching the
  //    backgroundColor already set in app.json, for visual consistency.
  const background = new Jimp(512, 512, BG_HEX);
  await background.writeAsync(OUT("android-icon-background.png"));

  // 4. Android monochrome icon (432x432, Android 13+ themed icons): a white
  //    silhouette — every visible pixel becomes solid white, keeping the
  //    original alpha, so the OS can tint it to the user's theme color.
  const monoLogo = await scaledCopy(432 * 0.62);
  monoLogo.scan(0, 0, monoLogo.bitmap.width, monoLogo.bitmap.height, function (x, y, idx) {
    const alpha = this.bitmap.data[idx + 3];
    if (alpha > 0) {
      this.bitmap.data[idx] = 255;
      this.bitmap.data[idx + 1] = 255;
      this.bitmap.data[idx + 2] = 255;
    }
  });
  const monochrome = centerOn(432, monoLogo, null);
  await monochrome.writeAsync(OUT("android-icon-monochrome.png"));

  // 5. Favicon (48x48): small resize of the main (white-background) icon.
  const favicon = mainIcon.clone().resize(48, 48);
  await favicon.writeAsync(OUT("favicon.png"));

  console.log("Icons regenerated from design/logo.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
