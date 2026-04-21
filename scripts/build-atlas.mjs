#!/usr/bin/env node
// Packs every PNG in ./originals/ into a single WebP atlas + manifest.
// Output: public/atlas/atlas.webp, public/atlas/manifest.json

import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const SRC_DIR = path.join(ROOT, 'originals');
const OUT_DIR = path.join(ROOT, 'public', 'atlas');

// Cell size preserves the 16:9 aspect of the source images.
// 112 x 63 gives us clean packing into a 2048-wide atlas (18 cols).
const CELL_W = 112;
const CELL_H = 63;
const ATLAS_W = 2048;

async function main() {
    const files = (await readdir(SRC_DIR)).filter(f => f.endsWith('.png')).sort();
    const cols = Math.floor(ATLAS_W / CELL_W);
    const rows = Math.ceil(files.length / cols);
    const atlasH = rows * CELL_H;

    await mkdir(OUT_DIR, { recursive: true });
    console.log(`${files.length} images -> ${cols}x${rows} grid, atlas ${ATLAS_W}x${atlasH}`);

    const composites = [];
    const manifest = [];

    for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * CELL_W;
        const y = row * CELL_H;

        const thumb = await sharp(path.join(SRC_DIR, filename))
            .resize(CELL_W, CELL_H, { fit: 'fill' })
            .toBuffer();

        composites.push({ input: thumb, top: y, left: x });
        manifest.push({ filename, x, y, w: CELL_W, h: CELL_H });

        if ((i + 1) % 50 === 0) process.stdout.write(`\r  thumbnailed ${i + 1}/${files.length}`);
    }
    process.stdout.write(`\r  thumbnailed ${files.length}/${files.length}\n`);

    const atlas = sharp({
        create: { width: ATLAS_W, height: atlasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite(composites);

    const outPng = path.join(OUT_DIR, 'atlas.webp');
    await atlas.webp({ quality: 85 }).toFile(outPng);

    await writeFile(
        path.join(OUT_DIR, 'manifest.json'),
        JSON.stringify({ atlasW: ATLAS_W, atlasH, cellW: CELL_W, cellH: CELL_H, cols, rows, items: manifest }, null, 2)
    );

    console.log(`Wrote ${outPng} and manifest.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
