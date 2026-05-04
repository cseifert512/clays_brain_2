import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'Claysbrainlogo.png');
const OUT_DIR = path.join(ROOT, 'public');

const targets = [
    { name: 'favicon-32.png', size: 32 },
    { name: 'favicon-192.png', size: 192 },
    { name: 'apple-touch-icon.png', size: 180 },
];

const srcStat = await fs.stat(SRC);
console.log(`source: ${path.relative(ROOT, SRC)} (${(srcStat.size / 1024).toFixed(1)} kB)`);

for (const { name, size } of targets) {
    const outPath = path.join(OUT_DIR, name);
    await sharp(SRC)
        .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9, palette: true })
        .toFile(outPath);
    const stat = await fs.stat(outPath);
    console.log(`  ${name.padEnd(24)} ${size}×${size}  ${(stat.size / 1024).toFixed(1)} kB`);
}
