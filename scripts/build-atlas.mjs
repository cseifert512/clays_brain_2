#!/usr/bin/env node
// Packs every PNG in ./originals/ into a WebP atlas that preserves each
// image's native aspect ratio. Images are placed top-left within a uniform
// grid cell; the manifest stores the actual image rect (x, y, w, h) in atlas
// pixels so the frontend can map UVs and sprite aspect correctly.
//
// Output: public/atlas/atlas.webp, public/atlas/manifest.json

import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const SRC_DIR = path.join(ROOT, 'originals');
const OUT_DIR = path.join(ROOT, 'public', 'atlas');

// Uniform grid cell (each image fits inside a CELL x CELL square, preserving
// aspect). 128 x 128 cells in 32 cols x 15 rows = 4096 x 1920 atlas — well
// under the 4096 WebGL texture-size minimum.
const CELL = 128;
const COLS = 32;

async function main() {
    const files = (await readdir(SRC_DIR)).filter(f => f.endsWith('.png')).sort();
    const rows = Math.ceil(files.length / COLS);
    const atlasW = COLS * CELL;
    const atlasH = rows * CELL;

    await mkdir(OUT_DIR, { recursive: true });
    console.log(`${files.length} images -> ${COLS}x${rows} grid, atlas ${atlasW}x${atlasH}`);

    const composites = [];
    const items = [];

    for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const cellX = col * CELL;
        const cellY = row * CELL;

        const img = sharp(path.join(SRC_DIR, filename)).resize(CELL, CELL, {
            fit: 'inside',
            withoutEnlargement: false,
        });
        const { data, info } = await img.toBuffer({ resolveWithObject: true });

        composites.push({ input: data, top: cellY, left: cellX });
        items.push({ filename, x: cellX, y: cellY, w: info.width, h: info.height });

        if ((i + 1) % 50 === 0) process.stdout.write(`\r  thumbnailed ${i + 1}/${files.length}`);
    }
    process.stdout.write(`\r  thumbnailed ${files.length}/${files.length}\n`);

    const atlas = sharp({
        create: { width: atlasW, height: atlasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite(composites);

    const outPng = path.join(OUT_DIR, 'atlas.webp');
    await atlas.webp({ quality: 85 }).toFile(outPng);

    await writeFile(
        path.join(OUT_DIR, 'manifest.json'),
        JSON.stringify({ atlasW, atlasH, cell: CELL, cols: COLS, rows, items }, null, 2)
    );

    console.log(`Wrote ${outPng} and manifest.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
