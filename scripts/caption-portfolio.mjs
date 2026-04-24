import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MODEL = process.env.CAPTION_MODEL || 'claude-opus-4-7';
const CONCURRENCY = Number(process.env.CAPTION_CONCURRENCY || 4);
const IMAGE_MAX_DIM = 1024;

const SELECTIONS_PATH = path.join(ROOT, 'portfolio', 'selections.txt');
const CAPTIONS_PATH = path.join(ROOT, 'portfolio', 'captions.json');
const OVERRIDES_PATH = path.join(ROOT, 'portfolio', 'overrides.json');

const SYSTEM_PROMPT = `You are writing SEO-friendly captions for an AI-generated architecture and design portfolio by Clay Seifert, an architect working at the intersection of architecture, AI, and construction robotics.

For each image you are shown, return ONLY a single JSON object (no prose, no markdown, no code fences) with exactly these keys:

{
  "title": "3-6 word noun phrase in Title Case describing the subject. No ending punctuation.",
  "alt": "One sentence, 90-140 characters, describing what is visible. Written for both humans and search engines.",
  "caption": "1-2 sentences, 180-300 characters, describing architectural, material, spatial, and atmospheric qualities. Specific and grounded; avoid hype words like 'stunning' or 'breathtaking'."
}

Focus on what is architecturally interesting: form, materials (wood, stone, concrete, metal, glass, clay, CLT), structural approach, scale, context (urban, desert, coastal, forest), and atmosphere (light, weather, time of day). Do not speculate about function unless it is clear from the image. Do not mention the artist, "AI", or "render".`;

async function loadJSON(p, fallback) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); }
    catch { return fallback; }
}

function normalizePath(line) {
    return line.replaceAll('\\', '/');
}

async function captionImage(client, fullPath) {
    const buffer = await sharp(fullPath)
        .resize(IMAGE_MAX_DIM, IMAGE_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

    const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/jpeg',
                            data: buffer.toString('base64'),
                        },
                    },
                    {
                        type: 'text',
                        text: 'Caption this image per the system prompt. Return JSON only.',
                    },
                ],
            },
        ],
    });

    const text = response.content.find((b) => b.type === 'text')?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`no JSON in response: ${text.slice(0, 200)}`);
    const parsed = JSON.parse(match[0]);
    for (const k of ['title', 'alt', 'caption']) {
        if (typeof parsed[k] !== 'string' || !parsed[k].trim()) {
            throw new Error(`missing "${k}" in: ${match[0].slice(0, 200)}`);
        }
    }
    return { title: parsed.title.trim(), alt: parsed.alt.trim(), caption: parsed.caption.trim() };
}

async function main() {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY not set. Add it to .env.local (ANTHROPIC_API_KEY=sk-ant-...).');
        process.exit(1);
    }

    const selectionsRaw = await fs.readFile(SELECTIONS_PATH, 'utf8');
    const selections = selectionsRaw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !l.startsWith('#'));

    const captions = await loadJSON(CAPTIONS_PATH, {});
    const overrides = await loadJSON(OVERRIDES_PATH, {});

    const todo = [];
    for (const line of selections) {
        const fullPath = normalizePath(line);
        const filename = path.basename(fullPath);
        const force = overrides[filename]?.force === true;
        if (captions[filename] && !force) continue;
        todo.push({ filename, fullPath });
    }

    if (todo.length === 0) {
        console.log(`All ${selections.length} selections already captioned (${CAPTIONS_PATH}).`);
        console.log(`To re-caption one, add {"<filename>": {"force": true}} to portfolio/overrides.json.`);
        return;
    }

    console.log(`Captioning ${todo.length} of ${selections.length} images`);
    console.log(`  model:       ${MODEL}`);
    console.log(`  concurrency: ${CONCURRENCY}`);
    console.log('');

    const client = new Anthropic();
    const queue = [...todo];
    let done = 0;
    let failed = 0;
    let saveLock = Promise.resolve();

    const persist = () => {
        saveLock = saveLock.then(() =>
            fs.writeFile(CAPTIONS_PATH, JSON.stringify(captions, null, 2) + '\n')
        );
        return saveLock;
    };

    const worker = async () => {
        while (queue.length) {
            const item = queue.shift();
            try {
                const caption = await captionImage(client, item.fullPath);
                captions[item.filename] = caption;
                done++;
                await persist();
                console.log(`  [${done + failed}/${todo.length}] ${item.filename}`);
                console.log(`      → "${caption.title}"`);
            } catch (err) {
                failed++;
                const msg = err instanceof Anthropic.APIError
                    ? `${err.status} ${err.message}`
                    : err.message;
                console.error(`  [${done + failed}/${todo.length}] FAIL ${item.filename}: ${msg}`);
            }
        }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await saveLock;

    console.log(`\nDone. ${done} captioned, ${failed} failed. Results in ${path.relative(ROOT, CAPTIONS_PATH)}.`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
