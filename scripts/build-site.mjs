import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BRAND_DOMAINS = {
    clay: 'claysbrain.com',
    atticus: 'atticusseas.com',
};

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: ROOT,
            stdio: 'inherit',
            shell: process.platform === 'win32',
            ...opts,
        });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
        child.on('error', reject);
    });
}

async function main() {
    const brand = process.argv[2];
    if (!BRAND_DOMAINS[brand]) {
        console.error(`Usage: build-site.mjs <${Object.keys(BRAND_DOMAINS).join('|')}>`);
        process.exit(1);
    }

    const domain = BRAND_DOMAINS[brand];
    console.log(`\n=== Building ${brand} (${domain}) ===\n`);

    const cnamePath = path.join(ROOT, 'public', 'CNAME');
    await fs.writeFile(cnamePath, domain + '\n');
    console.log(`wrote public/CNAME -> ${domain}`);

    console.log(`\n--- Generating gallery.html + sitemap.xml ---`);
    await run('node', [`--env-file=.env.${brand}`, 'scripts/build-gallery.mjs']);

    console.log(`\n--- Vite build (mode=${brand}) ---`);
    await run('npx', ['vite', 'build', '--mode', brand]);

    console.log(`\n=== Build complete: dist/ ready for ${domain} ===\n`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
