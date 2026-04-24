import { spawn } from 'node:child_process';

const repoUrl = process.env.ATTICUS_DEPLOY_URL;
if (!repoUrl) {
    console.error(`
ATTICUS_DEPLOY_URL is not set in .env.local.

Steps to set this up (one-time):

  1. Create a new empty GitHub repo for the Atticus Seas deploy target.
     Suggested name: atticusseas.com or atticus-seas-site. It doesn't need
     any files — gh-pages will push the built dist/ to its gh-pages branch.

  2. Add this line to .env.local (same file as ANTHROPIC_API_KEY):

       ATTICUS_DEPLOY_URL=git@github.com:<user>/<repo>.git

     (or the https:// equivalent if you're not using SSH auth)

  3. In the new repo's Settings > Pages, set Source = gh-pages branch after the
     first successful deploy. Then set the custom domain to atticusseas.com
     and configure DNS (A records to GH Pages IPs, or CNAME to <user>.github.io).

  4. Re-run npm run deploy:atticus.
`);
    process.exit(1);
}

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            stdio: 'inherit',
            shell: process.platform === 'win32',
        });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
        child.on('error', reject);
    });
}

await run('npx', ['rimraf', 'dist']);
await run('node', ['scripts/build-site.mjs', 'atticus']);
await run('npx', ['gh-pages', '-d', 'dist', '-r', repoUrl, '-m', 'Deploy Atticus Seas site']);

console.log(`\n✓ Deployed dist/ to ${repoUrl} (gh-pages branch)\n`);
