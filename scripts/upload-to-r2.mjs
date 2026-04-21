#!/usr/bin/env node
// Uploads ./originals/*.png to Cloudflare R2.
//
// Requires env vars (put them in .env.local, then run with
//   `node --env-file=.env.local scripts/upload-to-r2.mjs`):
//
//   R2_ACCOUNT_ID=<your cloudflare account id>
//   R2_ACCESS_KEY_ID=<access key from the R2 API token>
//   R2_SECRET_ACCESS_KEY=<secret from the R2 API token>
//   R2_BUCKET=claysbrain                   # optional, defaults to this
//
// Resumable: HEAD-checks each key and skips if already present.

import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const SRC_DIR = path.join(ROOT, 'originals');
const CONCURRENCY = 8;

const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET = 'claysbrain',
} = process.env;

for (const [k, v] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY })) {
    if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function existsInBucket(key, localSize) {
    try {
        const res = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        return res.ContentLength === localSize;
    } catch (e) {
        if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return false;
        throw e;
    }
}

async function upload(key, localPath) {
    const body = await readFile(localPath);
    await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=31536000, immutable',
    }));
}

async function main() {
    const files = (await readdir(SRC_DIR)).filter(f => f.endsWith('.png')).sort();
    console.log(`${files.length} files, bucket=${R2_BUCKET}, endpoint=${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);

    let done = 0, skipped = 0, failed = [];

    async function worker(queue) {
        while (queue.length) {
            const filename = queue.shift();
            const localPath = path.join(SRC_DIR, filename);
            try {
                const { size } = await stat(localPath);
                if (await existsInBucket(filename, size)) {
                    skipped++;
                } else {
                    await upload(filename, localPath);
                }
            } catch (err) {
                failed.push({ filename, error: String(err?.message || err) });
            }
            done++;
            process.stdout.write(`\r${done}/${files.length}  skipped=${skipped}  failed=${failed.length}   `);
        }
    }

    const queue = [...files];
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
    process.stdout.write('\n');

    if (failed.length) {
        console.error(`\n${failed.length} failures:`);
        for (const f of failed.slice(0, 10)) console.error(`  ${f.filename}: ${f.error}`);
        if (failed.length > 10) console.error(`  ... and ${failed.length - 10} more`);
        process.exitCode = 1;
    } else {
        console.log('All uploads complete.');
    }
}

main().catch(e => { console.error(e); process.exit(1); });
