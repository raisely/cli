import fs from 'node:fs';
import path from 'node:path';

/**
 * Returns the canonical v2 paths for a given campaign inside a repo root.
 *
 * @param {string} repoRoot  Absolute path to the repo root.
 * @param {string} campaignPath  Campaign path slug (e.g. "my-campaign").
 * @returns {{ campaignDir: string, pagesDir: string, stylesheetsDir: string, mainScss: string }}
 */
export function resolveCampaignPaths(repoRoot, campaignPath) {
	const campaignDir = path.join(repoRoot, 'campaigns', campaignPath);
	return {
		campaignDir,
		pagesDir: path.join(campaignDir, 'pages'),
		stylesheetsDir: path.join(campaignDir, 'stylesheets'),
		mainScss: path.join(campaignDir, 'stylesheets', 'main.scss'),
	};
}

/**
 * Classifies the layout of a repo root.
 *
 * - `legacy`: top-level `pages/` or `stylesheets/` exist, no `campaigns/`
 * - `v2`:     `campaigns/` exists, no top-level `pages/` or `stylesheets/`
 * - `mixed`:  both legacy markers and `campaigns/` co-exist
 * - `empty`:  none of the above are present
 *
 * @param {string} repoRoot  Absolute path to the repo root.
 * @returns {'legacy' | 'v2' | 'mixed' | 'empty'}
 */
export function detectLayout(repoRoot) {
	const hasLegacy =
		isDir(path.join(repoRoot, 'pages')) ||
		isDir(path.join(repoRoot, 'stylesheets'));
	const hasV2 = isDir(path.join(repoRoot, 'campaigns'));

	if (hasLegacy && hasV2) return 'mixed';
	if (hasV2) return 'v2';
	if (hasLegacy) return 'legacy';
	return 'empty';
}

const REFUSING_LAYOUT_COMMANDS = new Set(['update', 'deploy', 'local', 'start']);

/**
 * Returns true when a command should refuse to run for this layout classification.
 *
 * @param {string} commandName
 * @param {'legacy' | 'v2' | 'mixed' | 'empty'} layout
 * @returns {boolean}
 */
export function shouldRefuseLayoutForCommand(commandName, layout) {
	if (!REFUSING_LAYOUT_COMMANDS.has(commandName)) return false;
	return layout === 'legacy' || layout === 'mixed';
}

/**
 * Build a clear refusal message that points users to the v2 install + migration path.
 *
 * @param {string} commandName
 * @param {'legacy' | 'v2' | 'mixed' | 'empty'} layout
 * @returns {string}
 */
export function getLegacyLayoutRefusalMessage(commandName, layout) {
	const layoutLabel = layout === 'mixed' ? 'mixed legacy + v2' : 'legacy';
	return [
		`Cannot run \`raisely ${commandName}\` with a ${layoutLabel} project layout.`,
		'This command requires the v2 layout under `campaigns/<campaign-path>/`.',
		'Install v2: npm install -g @raisely/cli@2',
		'Migrate this repo: raisely migrate',
	].join('\n');
}

function isDir(p) {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}
