import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';

import { resolveCampaignPaths } from './actions/layout.js';
import { loadConfig } from './config.js';
import { getToken } from './actions/auth.js';
import { getCampaign } from './actions/campaigns.js';
import { br, log } from './helpers.js';
import { program } from 'commander';

// ---------------------------------------------------------------------------
// Pure migrator (named export — testable without network or keychain)
// ---------------------------------------------------------------------------

/**
 * Migrates a legacy repo layout to v2.
 *
 * For each configured campaign UUID the migrator resolves the campaign path
 * via `getCampaign`, then:
 *
 *   pages/<campaignPath>/*         → campaigns/<campaignPath>/pages/*
 *   stylesheets/<campaignPath>/*   → campaigns/<campaignPath>/stylesheets/*
 *   <campaignPath>.scss            → main.scss  (renamed during the move)
 *
 * Partials (files starting with `_`) keep their names and nesting.
 * Empty root `pages/` and `stylesheets/` directories are deleted after all
 * campaigns have been processed. Folders under those root dirs that do not
 * belong to a configured campaign are left in place and listed as orphans.
 * Each campaign is processed independently — one failure does not block the
 * rest. Running migrate on an already-migrated repo is a no-op.
 *
 * @param {object}   opts
 * @param {string}   opts.repoRoot     - Absolute path to the repo root.
 * @param {string[]} opts.campaigns    - Campaign UUIDs from .raisely.json.
 * @param {Function} opts.getCampaign  - async ({ uuid }) => { data: { path } }
 * @returns {Promise<{
 *   moved:   string[],
 *   renamed: string[],
 *   deleted: string[],
 *   orphans: Array<{ folder: string, reason: string }>,
 * }>}
 */
export async function migrate({ repoRoot, campaigns, getCampaign: resolveCampaign }) {
	const report = { moved: [], renamed: [], deleted: [], orphans: [] };

	// Resolve each UUID to a campaign path, collecting failures as orphans.
	const resolvedCampaigns = [];
	for (const uuid of campaigns) {
		try {
			const campaign = await resolveCampaign({ uuid });
			resolvedCampaigns.push({ uuid, campaignPath: campaign.data.path });
		} catch (err) {
			report.orphans.push({
				folder: uuid,
				reason: `Could not resolve campaign: ${err.message}`,
			});
		}
	}

	const configuredPaths = new Set(resolvedCampaigns.map((c) => c.campaignPath));

	// Migrate each configured campaign independently.
	for (const { campaignPath } of resolvedCampaigns) {
		try {
			migrateCampaign({ repoRoot, campaignPath, report });
		} catch (err) {
			report.orphans.push({
				folder: campaignPath,
				reason: `Migration failed: ${err.message}`,
			});
		}
	}

	// Any folder under pages/ or stylesheets/ that is not a configured campaign
	// is an orphan — leave it in place but surface it.
	detectOrphans({ repoRoot, configuredPaths, report });

	// Remove empty root legacy directories.
	cleanEmptyRootDirs({ repoRoot, report });

	return report;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function migrateCampaign({ repoRoot, campaignPath, report }) {
	const srcPagesDir = path.join(repoRoot, 'pages', campaignPath);
	const srcStylesDir = path.join(repoRoot, 'stylesheets', campaignPath);
	const { pagesDir: dstPagesDir, stylesheetsDir: dstStylesDir } =
		resolveCampaignPaths(repoRoot, campaignPath);

	if (isDir(srcPagesDir)) {
		moveDirContents(srcPagesDir, dstPagesDir, null, report);
	}

	if (isDir(srcStylesDir)) {
		moveDirContents(srcStylesDir, dstStylesDir, campaignPath, report);
	}
}

/**
 * Recursively moves the contents of `src` into `dst`.
 * When `entryScssPrefix` is provided, a file named `<entryScssPrefix>.scss`
 * is renamed to `main.scss` at its destination.
 */
function moveDirContents(src, dst, entryScssPrefix, report) {
	fs.mkdirSync(dst, { recursive: true });

	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);

		if (entry.isDirectory()) {
			moveDirContents(
				srcPath,
				path.join(dst, entry.name),
				null,
				report
			);
		} else {
			const dstName =
				entryScssPrefix && entry.name === `${entryScssPrefix}.scss`
					? 'main.scss'
					: entry.name;
			const dstPath = path.join(dst, dstName);

			// Idempotency: skip files that already landed at the destination.
			if (fs.existsSync(dstPath)) continue;

			fs.mkdirSync(path.dirname(dstPath), { recursive: true });
			fs.renameSync(srcPath, dstPath);

			if (entryScssPrefix && entry.name === `${entryScssPrefix}.scss`) {
				report.renamed.push(dstPath);
			} else {
				report.moved.push(dstPath);
			}
		}
	}

	// Remove the source directory if it is now empty.
	try {
		fs.rmdirSync(src);
	} catch {
		// Not empty (e.g. idempotent re-run with leftover entry .scss) — leave it.
	}
}

function detectOrphans({ repoRoot, configuredPaths, report }) {
	for (const rootDir of ['pages', 'stylesheets']) {
		const dir = path.join(repoRoot, rootDir);
		if (!isDir(dir)) continue;

		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory() && !configuredPaths.has(entry.name)) {
				report.orphans.push({
					folder: path.join(rootDir, entry.name),
					reason: 'Not a configured campaign in .raisely.json',
				});
			}
		}
	}
}

function cleanEmptyRootDirs({ repoRoot, report }) {
	for (const dir of ['pages', 'stylesheets']) {
		const dirPath = path.join(repoRoot, dir);
		if (!isDir(dirPath)) continue;
		if (isDirEmpty(dirPath)) {
			fs.rmdirSync(dirPath);
			report.deleted.push(dirPath);
		}
	}
}

function isDir(p) {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function isDirEmpty(p) {
	try {
		return fs.readdirSync(p).length === 0;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// CLI command (default export — called by the actionBuilder in cli.js)
// ---------------------------------------------------------------------------

export default async function migrateCommand() {
	const config = await loadConfig();
	await getToken(program, config);

	br();
	log('Migrating repo to v2 layout…', 'white');
	br();

	const loader = ora('Moving per-campaign content').start();

	let report;
	try {
		report = await migrate({
			repoRoot: process.cwd(),
			campaigns: config.campaigns ?? [],
			getCampaign,
		});
	} catch (err) {
		loader.fail(`Migration failed: ${err.message}`);
		process.exit(1);
	}

	loader.succeed('Migration complete');
	br();

	if (report.moved.length > 0) {
		log(`Moved (${report.moved.length}):`, 'green');
		for (const f of report.moved) {
			console.log(`  ${chalk.green('+')} ${path.relative(process.cwd(), f)}`);
		}
		br();
	}

	if (report.renamed.length > 0) {
		log(`Renamed to main.scss (${report.renamed.length}):`, 'cyan');
		for (const f of report.renamed) {
			console.log(`  ${chalk.cyan('~')} ${path.relative(process.cwd(), f)}`);
		}
		br();
	}

	if (report.deleted.length > 0) {
		log(`Removed empty directories (${report.deleted.length}):`, 'yellow');
		for (const f of report.deleted) {
			console.log(
				`  ${chalk.yellow('-')} ${path.relative(process.cwd(), f)}`
			);
		}
		br();
	}

	if (report.orphans.length > 0) {
		log(`Skipped orphan folders (${report.orphans.length}):`, 'red');
		for (const { folder, reason } of report.orphans) {
			console.log(`  ${chalk.red('!')} ${folder} — ${reason}`);
		}
		br();
	}

	if (
		report.moved.length === 0 &&
		report.renamed.length === 0 &&
		report.deleted.length === 0 &&
		report.orphans.length === 0
	) {
		log('Nothing to migrate — repo is already on the v2 layout.', 'green');
		br();
	}
}
