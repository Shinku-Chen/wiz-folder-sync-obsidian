import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';
import manifest from '../manifest.json' with { type: 'json' };

const rootDir = process.cwd();
const legacyBuildDir = path.join(rootDir, 'build');
const buildRootDir = path.join(rootDir, '.build');
const buildDir = path.join(buildRootDir, manifest.id);
const rootMain = path.join(rootDir, 'main.js');
const buildMain = path.join(buildDir, 'main.js');
const rootManifest = path.join(rootDir, 'manifest.json');
const buildManifest = path.join(buildDir, 'manifest.json');
const rootStyles = path.join(rootDir, 'styles.css');
const buildStyles = path.join(buildDir, 'styles.css');

await rm(legacyBuildDir, { recursive: true, force: true });
await rm(buildRootDir, { recursive: true, force: true });
await mkdir(buildDir, { recursive: true });

await rename(rootMain, buildMain);
await cp(rootManifest, buildManifest);

if (await fileExists(rootStyles)) {
	await cp(rootStyles, buildStyles);
}

async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}
