import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SELECTIONS_PATH = path.join(ROOT, 'portfolio', 'selections.txt');
const CAPTIONS_PATH = path.join(ROOT, 'portfolio', 'captions.json');
const OVERRIDES_PATH = path.join(ROOT, 'portfolio', 'overrides.json');
const OUT_DIR = path.join(ROOT, 'public', 'portfolio');
const GALLERY_PATH = path.join(ROOT, 'public', 'gallery.html');
const SITEMAP_PATH = path.join(ROOT, 'public', 'sitemap.xml');

const SITE_URL = process.env.VITE_BRAND_SITE_URL ?? 'https://claysbrain.com';
const BRAND_H1 = process.env.VITE_BRAND_H1 ?? 'Clay Seifert';
const BRAND_BYLINE = process.env.VITE_BRAND_BYLINE ?? '';
const BRAND_TAGLINE = process.env.VITE_BRAND_TAGLINE ?? 'Working at the intersection of architecture, AI, and construction robotics.';
const BRAND_SITE_NAME = process.env.VITE_BRAND_SITE_NAME ?? 'Clay Seifert';
const BRAND_HEADSHOT_CAPTION = process.env.VITE_BRAND_HEADSHOT_CAPTION ?? 'Clay Seifert';

const TARGET_MAX_DIM = 1024;
const WEBP_QUALITY = 85;

function slugFromFilename(filename) {
    const base = filename
        .replace(/^512clay_/, '')
        .replace(/\.(png|jpg|jpeg|webp)$/i, '');
    const uuidMatch = base.match(/_([0-9a-f]{8})-[0-9a-f-]+/i);
    const prompt = uuidMatch ? base.slice(0, uuidMatch.index) : base;
    const unique = crypto.createHash('md5').update(filename).digest('hex').slice(0, 8);
    const slug = prompt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '');
    return `${slug || 'image'}-${unique}`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    }[c]));
}

async function loadJSON(p, fallback) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); }
    catch { return fallback; }
}

function normalizePath(line) {
    return line.replaceAll('\\', '/');
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });

    const selectionsRaw = await fs.readFile(SELECTIONS_PATH, 'utf8');
    const selections = selectionsRaw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !l.startsWith('#'));

    const captions = await loadJSON(CAPTIONS_PATH, {});
    const overrides = await loadJSON(OVERRIDES_PATH, {});

    const items = [];
    const missing = [];
    const slugToFilename = new Map();

    for (const line of selections) {
        const fullPath = normalizePath(line);
        const filename = path.basename(fullPath);
        const captionFields = { ...(captions[filename] || {}), ...(overrides[filename] || {}) };
        delete captionFields.force;

        if (!captionFields.title || !captionFields.alt || !captionFields.caption) {
            missing.push(filename);
            continue;
        }

        const slug = slugFromFilename(filename);
        const prior = slugToFilename.get(slug);
        if (prior && prior !== filename) {
            throw new Error(`slug collision: "${slug}" for both "${prior}" and "${filename}"`);
        }
        slugToFilename.set(slug, filename);

        const outName = `${slug}.webp`;
        const outPath = path.join(OUT_DIR, outName);

        let dims;
        const stat = await fs.stat(outPath).catch(() => null);
        if (!stat) {
            console.log(`  resize  ${filename} -> ${outName}`);
            const out = await sharp(fullPath)
                .resize(TARGET_MAX_DIM, TARGET_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: WEBP_QUALITY })
                .toFile(outPath);
            dims = { w: out.width, h: out.height };
        } else {
            const meta = await sharp(outPath).metadata();
            dims = { w: meta.width, h: meta.height };
        }

        items.push({ filename, slug, outName, dims, ...captionFields });
    }

    if (missing.length) {
        console.warn(`\n${missing.length} selection(s) missing captions — skipped:`);
        for (const m of missing.slice(0, 10)) console.warn(`  - ${m}`);
        if (missing.length > 10) console.warn(`  ... (${missing.length - 10} more)`);
        console.warn(`Run: npm run caption\n`);
    }

    await writeGallery(items);
    await writeSitemap(items);

    console.log(`\nBuilt gallery with ${items.length} items`);
    console.log(`  -> ${path.relative(ROOT, GALLERY_PATH)}`);
    console.log(`  -> ${path.relative(ROOT, SITEMAP_PATH)}`);
    console.log(`  -> ${path.relative(ROOT, OUT_DIR)}/*.webp`);
}

async function writeGallery(items) {
    const figures = items.map((it) => `        <figure>
          <a href="/portfolio/${it.outName}">
            <img src="/portfolio/${it.outName}" alt="${escapeHtml(it.alt)}" loading="lazy" width="${it.dims.w}" height="${it.dims.h}">
          </a>
          <figcaption>
            <h2>${escapeHtml(it.title)}</h2>
            <p>${escapeHtml(it.caption)}</p>
          </figcaption>
        </figure>`).join('\n');

    const galleryTitle = `Gallery — ${BRAND_SITE_NAME}`;
    const galleryDescription = BRAND_TAGLINE
        ? `Selected architectural and design studies by ${BRAND_SITE_NAME} — ${BRAND_TAGLINE.replace(/^[A-Z]/, (c) => c.toLowerCase())}`
        : `Selected architectural and design studies by ${BRAND_SITE_NAME}.`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(galleryTitle)}</title>
    <meta name="description" content="${escapeHtml(galleryDescription)}">
    <meta name="author" content="Clay Seifert">
    <link rel="canonical" href="${SITE_URL}/gallery.html">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${SITE_URL}/gallery.html">
    <meta property="og:title" content="${escapeHtml(galleryTitle)}">
    <meta property="og:description" content="${escapeHtml(galleryDescription)}">
    <meta property="og:site_name" content="${escapeHtml(BRAND_SITE_NAME)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(galleryTitle)}">
    <meta name="twitter:description" content="${escapeHtml(galleryDescription)}">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": ${JSON.stringify(galleryTitle)},
        "url": "${SITE_URL}/gallery.html",
        "description": ${JSON.stringify(galleryDescription)},
        "isPartOf": { "@type": "WebSite", "name": ${JSON.stringify(BRAND_SITE_NAME)}, "url": "${SITE_URL}/" },
        "creator": { "@type": "Person", "@id": "https://claysbrain.com/#clay", "name": "Clay Seifert" }
    }
    </script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Space Grotesk', sans-serif; color: #222; background: #f0f0f0; }
        header, main, footer { max-width: 1200px; margin: 0 auto; padding: 40px 20px; }
        header h1 { font-size: 2.5em; margin: 0 0 2px; font-weight: 700; letter-spacing: -0.01em; }
        header h2 { font-size: 1.3em; margin: 28px 0 8px; font-weight: 700; color: #333; }
        header .byline { color: #666; margin: 0 0 14px; font-size: 1em; letter-spacing: 0.02em; }
        header .byline:empty, header .lede:empty { display: none; }
        header .lede { color: #555; margin: 0 0 6px; max-width: 640px; line-height: 1.5; font-size: 1.05em; }
        header p { color: #555; margin: 0; max-width: 640px; line-height: 1.5; font-size: 1em; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 32px; }
        figure { margin: 0; background: #fff; border: 1px solid #e0e0e0; transition: transform 0.2s, box-shadow 0.2s; }
        figure:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.08); }
        figure img { display: block; width: 100%; height: auto; aspect-ratio: 1 / 1; object-fit: cover; background: #eaeaea; }
        figcaption { padding: 14px 16px 20px; }
        figcaption h2 { font-size: 1.05em; margin: 0 0 6px; font-weight: 700; }
        figcaption p { font-size: 0.9em; color: #555; margin: 0; line-height: 1.5; }
        a { color: inherit; text-decoration: none; }
        footer { text-align: center; color: #666; font-size: 0.9em; padding-top: 20px; padding-bottom: 60px; }
        footer a { border-bottom: 1px solid #666; padding-bottom: 1px; }
        footer a:hover { color: #007bff; border-color: #007bff; }
    </style>
</head>
<body>
    <header>
        <h1>${escapeHtml(BRAND_H1)}</h1>
        <p class="byline">${escapeHtml(BRAND_BYLINE)}</p>
        <p class="lede">${escapeHtml(BRAND_TAGLINE)}</p>
        <h2>Gallery</h2>
    </header>
    <main>
        <div class="grid">
${figures}
        </div>
    </main>
    <footer>
        <a href="/">← Back</a>
    </footer>
</body>
</html>
`;
    await fs.writeFile(GALLERY_PATH, html);
}

async function writeSitemap(items) {
    const imageEntries = items.map((it) => `        <image:image>
            <image:loc>${SITE_URL}/portfolio/${it.outName}</image:loc>
            <image:title>${escapeXml(it.title)}</image:title>
            <image:caption>${escapeXml(it.caption)}</image:caption>
        </image:image>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
    <url>
        <loc>${SITE_URL}/</loc>
        <image:image>
            <image:loc>${SITE_URL}/headshot.jpg</image:loc>
            <image:title>Clay Seifert</image:title>
            <image:caption>${escapeXml(BRAND_HEADSHOT_CAPTION)}</image:caption>
        </image:image>
    </url>
    <url>
        <loc>${SITE_URL}/gallery.html</loc>
${imageEntries}
    </url>
</urlset>
`;
    await fs.writeFile(SITEMAP_PATH, xml);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
