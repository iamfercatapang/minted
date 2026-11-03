// Renders public/icon.svg to the PNG sizes Android needs for installing the PWA. Run: npm run icons
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url));
for (const size of [192, 512]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png);
  console.log(`public/icon-${size}.png`, png.length, 'bytes');
}
