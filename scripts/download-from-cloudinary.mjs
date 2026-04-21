#!/usr/bin/env node
// Downloads every image referenced in public/embeddings.json from Cloudinary
// into ./originals/. Resumable: skips files that already exist on disk.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLOUD_NAME = 'damdbel4n';
const CONCURRENCY = 8;
const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const EMBEDDINGS_PATH = path.join(ROOT, 'public', 'embeddings.json');
const OUT_DIR = path.join(ROOT, 'originals');
const FAILED_LOG = path.join(ROOT, 'scripts', 'failed-downloads.txt');

function urlFor(filename) {
    const base = filename.replace(/\.[^.]+$/, '');
    return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${base}.png`;
}

async function fileExists(p) {
    try { await stat(p); return true; } catch { return false; }
}

async function download(url, dest) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
    const raw = await readFile(EMBEDDINGS_PATH, 'utf8');
    const items = JSON.parse(raw);
    await mkdir(OUT_DIR, { recursive: true });

    const tasks = items.map((item) => {
        const filename = item.filename.replace(/\.[^.]+$/, '') + '.png';
        return { filename, url: urlFor(item.filename), dest: path.join(OUT_DIR, filename) };
    });

    let done = 0, skipped = 0, failed = [];
    const total = tasks.length;

    async function worker(queue) {
        while (queue.length) {
            const t = queue.shift();
            if (await fileExists(t.dest)) { skipped++; done++; report(); continue; }
            try {
                await download(t.url, t.dest);
            } catch (err) {
                failed.push({ filename: t.filename, url: t.url, error: String(err) });
            }
            done++;
            report();
        }
    }

    function report() {
        process.stdout.write(`\r${done}/${total}  skipped=${skipped}  failed=${failed.length}   `);
    }

    const queue = [...tasks];
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
    process.stdout.write('\n');

    if (failed.length) {
        await writeFile(FAILED_LOG, failed.map(f => `${f.url}\t${f.error}`).join('\n'));
        console.error(`${failed.length} failures written to ${FAILED_LOG}`);
        process.exitCode = 1;
    } else {
        console.log('All images downloaded.');
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
