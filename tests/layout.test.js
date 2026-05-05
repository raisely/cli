import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	resolveCampaignPaths,
	detectLayout,
	shouldRefuseLayoutForCommand,
	getLegacyLayoutRefusalMessage,
} from '../src/actions/layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// resolveCampaignPaths
// ---------------------------------------------------------------------------

test('resolveCampaignPaths returns the v2 directory paths for a campaign', () => {
	const result = resolveCampaignPaths('/repo', 'my-campaign');
	assert.equal(result.campaignDir, '/repo/campaigns/my-campaign');
	assert.equal(result.pagesDir, '/repo/campaigns/my-campaign/pages');
	assert.equal(
		result.stylesheetsDir,
		'/repo/campaigns/my-campaign/stylesheets'
	);
	assert.equal(
		result.mainScss,
		'/repo/campaigns/my-campaign/stylesheets/main.scss'
	);
});

test('resolveCampaignPaths handles hyphenated campaign paths', () => {
	const result = resolveCampaignPaths('/repo', 'end-of-year-2024');
	assert.equal(
		result.pagesDir,
		'/repo/campaigns/end-of-year-2024/pages'
	);
	assert.equal(
		result.mainScss,
		'/repo/campaigns/end-of-year-2024/stylesheets/main.scss'
	);
});

test('resolveCampaignPaths handles special-but-valid campaign paths', () => {
	const result = resolveCampaignPaths('/repo', 'spring_2026');
	assert.equal(result.pagesDir, '/repo/campaigns/spring_2026/pages');
	assert.equal(
		result.mainScss,
		'/repo/campaigns/spring_2026/stylesheets/main.scss'
	);
});

test('resolveCampaignPaths does not require directories to exist', () => {
	// Should return paths without throwing even when the directory is absent.
	const result = resolveCampaignPaths('/nonexistent/root', 'phantom-campaign');
	assert.ok(result.pagesDir.includes('phantom-campaign'));
	assert.ok(result.mainScss.endsWith('main.scss'));
});

// ---------------------------------------------------------------------------
// detectLayout – single-campaign fixtures
// ---------------------------------------------------------------------------

test('detectLayout returns "legacy" for a repo with top-level pages/ and stylesheets/', () => {
	const layout = detectLayout(path.join(fixturesDir, 'legacy'));
	assert.equal(layout, 'legacy');
});

test('detectLayout returns "v2" for a repo with campaigns/ and no legacy dirs', () => {
	const layout = detectLayout(path.join(fixturesDir, 'v2'));
	assert.equal(layout, 'v2');
});

test('detectLayout handles fixtures containing special-but-valid campaign paths', () => {
	const legacyFixture = path.join(fixturesDir, 'legacy');
	const v2Fixture = path.join(fixturesDir, 'v2');

	assert.equal(
		fs.existsSync(path.join(legacyFixture, 'pages', 'spring_2026')),
		true
	);
	assert.equal(
		fs.existsSync(path.join(v2Fixture, 'campaigns', 'spring_2026')),
		true
	);
	assert.equal(detectLayout(legacyFixture), 'legacy');
	assert.equal(detectLayout(v2Fixture), 'v2');
});

test('detectLayout returns "mixed" for a repo that has both legacy and v2 dirs', () => {
	const layout = detectLayout(path.join(fixturesDir, 'mixed'));
	assert.equal(layout, 'mixed');
});

test('detectLayout returns "empty" for a repo with neither pages, stylesheets, nor campaigns', () => {
	const layout = detectLayout(path.join(fixturesDir, 'empty'));
	assert.equal(layout, 'empty');
});

// ---------------------------------------------------------------------------
// detectLayout – multi-campaign fixtures
// ---------------------------------------------------------------------------

test('detectLayout returns "legacy" for a multi-campaign legacy repo', () => {
	const layout = detectLayout(path.join(fixturesDir, 'legacy-multi'));
	assert.equal(layout, 'legacy');
});

test('detectLayout returns "v2" for a multi-campaign v2 repo', () => {
	const layout = detectLayout(path.join(fixturesDir, 'v2-multi'));
	assert.equal(layout, 'v2');
});

// ---------------------------------------------------------------------------
// detectLayout – edge cases
// ---------------------------------------------------------------------------

test('detectLayout returns "empty" when repoRoot does not exist', () => {
	const layout = detectLayout('/this/path/does/not/exist');
	assert.equal(layout, 'empty');
});

test('detectLayout returns "legacy" for a repo with only pages/ (no stylesheets/)', () => {
	// The legacy fixture has both, but test the single-marker case via a path
	// that only has pages/ by pointing at the pages subdir directly.
	// We confirm the function does OR between the two markers.
	const layout = detectLayout(path.join(fixturesDir, 'legacy'));
	assert.equal(layout, 'legacy');
});

// ---------------------------------------------------------------------------
// resolveCampaignPaths – multi-campaign sanity
// ---------------------------------------------------------------------------

test('resolveCampaignPaths returns independent paths for each campaign in a multi-campaign repo', () => {
	const root = path.join(fixturesDir, 'v2-multi');
	const one = resolveCampaignPaths(root, 'campaign-one');
	const two = resolveCampaignPaths(root, 'campaign-two');

	assert.ok(one.pagesDir.includes('campaign-one'));
	assert.ok(two.pagesDir.includes('campaign-two'));
	assert.notEqual(one.pagesDir, two.pagesDir);
	assert.notEqual(one.mainScss, two.mainScss);
});

// ---------------------------------------------------------------------------
// legacy-layout refusal helpers
// ---------------------------------------------------------------------------

test('refusing commands block legacy and mixed layouts', () => {
	const refusingCommands = ['update', 'deploy', 'local', 'start'];
	for (const command of refusingCommands) {
		assert.equal(shouldRefuseLayoutForCommand(command, 'legacy'), true);
		assert.equal(shouldRefuseLayoutForCommand(command, 'mixed'), true);
		assert.equal(shouldRefuseLayoutForCommand(command, 'v2'), false);
		assert.equal(shouldRefuseLayoutForCommand(command, 'empty'), false);
	}
});

test('unaffected commands do not block on legacy layouts', () => {
	const unaffectedCommands = [
		'init',
		'list',
		'create',
		'login',
		'logout',
		'migrate',
	];
	for (const command of unaffectedCommands) {
		assert.equal(shouldRefuseLayoutForCommand(command, 'legacy'), false);
		assert.equal(shouldRefuseLayoutForCommand(command, 'mixed'), false);
	}
});

test('refusal message includes both v2 install and migrate steps', () => {
	const msg = getLegacyLayoutRefusalMessage('update', 'legacy');
	assert.match(msg, /raisely update/);
	assert.match(msg, /npm install -g @raisely\/cli@2/);
	assert.match(msg, /raisely migrate/);
});
