import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from '../src/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Copies a named fixture into a fresh temp directory and returns its path.
 * The temp directory is cleaned up automatically via the `cleanup` callback
 * registered in `afterEach`.
 */
function copyFixture(name, cleanupFns) {
	const src = path.join(fixturesDir, name);
	const dst = fs.mkdtempSync(
		path.join(os.tmpdir(), `raisely-migrate-${name}-`)
	);
	fs.cpSync(src, dst, { recursive: true });
	cleanupFns.push(() => fs.rmSync(dst, { recursive: true, force: true }));
	return dst;
}

/**
 * Builds a simple getCampaign mock from a `{ uuid: campaignPath }` map.
 */
function mockGetCampaign(map) {
	return async ({ uuid }) => {
		if (!Object.prototype.hasOwnProperty.call(map, uuid)) {
			throw new Error(`Unknown campaign UUID: ${uuid}`);
		}
		return { data: { path: map[uuid] } };
	};
}

// ---------------------------------------------------------------------------
// legacy → v2: single campaign with partial
// ---------------------------------------------------------------------------

test('migrate moves pages and main SCSS to the v2 layout for a single campaign', async (t) => {
	const cleanupFns = [];
	t.after(() => cleanupFns.forEach((fn) => fn()));

	const repoRoot = copyFixture('legacy', cleanupFns);
	const getCampaign = mockGetCampaign({ 'uuid-my-campaign': 'my-campaign' });

	const report = await migrate({
		repoRoot,
		campaigns: ['uuid-my-campaign'],
		getCampaign,
	});

	// Pages landed at the v2 path.
	assert.ok(
		fs.existsSync(
			path.join(repoRoot, 'campaigns/my-campaign/pages/home.json')
		),
		'home.json should exist under campaigns/my-campaign/pages/'
	);

	// Main SCSS renamed.
	assert.ok(
		fs.existsSync(
			path.join(repoRoot, 'campaigns/my-campaign/stylesheets/main.scss')
		),
		'main.scss should exist under campaigns/my-campaign/stylesheets/'
	);
	assert.ok(
		!fs.existsSync(
			path.join(
				repoRoot,
				'stylesheets/my-campaign/my-campaign.scss'
			)
		),
		'original my-campaign.scss should be gone from legacy path'
	);

	// Report reflects rename and move.
	assert.ok(
		report.renamed.some((p) => p.endsWith('main.scss')),
		'report.renamed should include main.scss'
	);
	assert.ok(
		report.moved.some((p) => p.endsWith('home.json')),
		'report.moved should include home.json'
	);
});

// ---------------------------------------------------------------------------
// Partial preservation
// ---------------------------------------------------------------------------

test('migrate preserves partials with their original names', async (t) => {
	const cleanupFns = [];
	t.after(() => cleanupFns.forEach((fn) => fn()));

	const repoRoot = copyFixture('legacy', cleanupFns);
	const getCampaign = mockGetCampaign({ 'uuid-my-campaign': 'my-campaign' });

	await migrate({
		repoRoot,
		campaigns: ['uuid-my-campaign'],
		getCampaign,
	});

	assert.ok(
		fs.existsSync(
			path.join(
				repoRoot,
				'campaigns/my-campaign/stylesheets/_variables.scss'
			)
		),
		'_variables.scss partial should be preserved at its original name'
	);
});

// ---------------------------------------------------------------------------
// Nested scss with same name as campaign must not be renamed to main.scss
// ---------------------------------------------------------------------------

test('migrate does not rename a nested scss file that shares the campaign name', async (t) => {
	const cleanupFns = [];
	t.after(() => cleanupFns.forEach((fn) => fn()));

	const repoRoot = copyFixture('legacy', cleanupFns);
	const getCampaign = mockGetCampaign({ 'uuid-my-campaign': 'my-campaign' });

	await migrate({
		repoRoot,
		campaigns: ['uuid-my-campaign'],
		getCampaign,
	});

	// The top-level entry stylesheet is renamed correctly.
	assert.ok(
		fs.existsSync(
			path.join(repoRoot, 'campaigns/my-campaign/stylesheets/main.scss')
		),
		'top-level my-campaign.scss should be renamed to main.scss'
	);

	// The nested file with the same name must keep its original name.
	assert.ok(
		fs.existsSync(
			path.join(
				repoRoot,
				'campaigns/my-campaign/stylesheets/theme/my-campaign.scss'
			)
		),
		'nested my-campaign.scss inside theme/ should NOT be renamed to main.scss'
	);
	assert.ok(
		!fs.existsSync(
			path.join(
				repoRoot,
				'campaigns/my-campaign/stylesheets/theme/main.scss'
			)
		),
		'there should be no main.scss created inside theme/'
	);
});

// ---------------------------------------------------------------------------
// A file already named main.scss in the source must land in report.moved, not report.renamed
// ---------------------------------------------------------------------------

test('migrate classifies a source main.scss as moved, not renamed', async (t) => {
	const cleanupFns = [];
	t.after(() => cleanupFns.forEach((fn) => fn()));

	// Uses a fixture where the stylesheet is already named main.scss (no <campaign>.scss to rename).
	const repoRoot = copyFixture('legacy-only-main-scss', cleanupFns);
	const getCampaign = mockGetCampaign({ 'uuid-my-campaign': 'my-campaign' });

	const report = await migrate({
		repoRoot,
		campaigns: ['uuid-my-campaign'],
		getCampaign,
	});

	// The file was moved (not renamed), so it must appear in report.moved, not report.renamed.
	assert.ok(
		report.moved.some((p) => p.endsWith('main.scss')),
		'report.moved should contain main.scss (source was already named main.scss)'
	);
	assert.ok(
		!report.renamed.some((p) => p.endsWith('main.scss')),
		'report.renamed must not contain main.scss when no rename occurred'
	);
});

// ---------------------------------------------------------------------------
// Multi-campaign migration + empty root cleanup
// ---------------------------------------------------------------------------

test('migrate handles a multi-campaign repo and deletes empty root directories', async (t) => {
	const cleanupFns = [];
	t.after(() => cleanupFns.forEach((fn) => fn()));

	const repoRoot = copyFixture('legacy-multi', cleanupFns);
	const getCampaign = mockGetCampaign({
		'uuid-one': 'campaign-one',
		'uuid-two': 'campaign-two',
	});

	const report = await migrate({
		repoRoot,
		campaigns: ['uuid-one', 'uuid-two'],
		getCampaign,
	});

	// Both campaigns landed at v2 paths.
	assert.ok(
		fs.existsSync(
			path.join(repoRoot, 'campaigns/campaign-one/pages/home.json')
		)
	);
	assert.ok(
		fs.existsSync(
			path.join(
				repoRoot,
				'campaigns/campaign-one/stylesheets/main.scss'
			)
		)
	);
	assert.ok(
		fs.existsSync(
			path.join(repoRoot, 'campaigns/campaign-two/pages/home.json')
		)
	);
	assert.ok(
		fs.existsSync(
			path.join(
				repoRoot,
				'campaigns/campaign-two/stylesheets/main.scss'
			)
		)
	);

	// Root legacy directories removed because they are now empty.
	assert.ok(
		!fs.existsSync(path.join(repoRoot, 'pages')),
		'root pages/ should be deleted after all campaigns migrated'
	);
	assert.ok(
		!fs.existsSync(path.join(repoRoot, 'stylesheets')),
		'root stylesheets/ should be deleted after all campaigns migrated'
	);
	assert.ok(
		report.deleted.some((p) => p.endsWith('pages')),
		'report.deleted should include pages/'
	);
	assert.ok(
		report.deleted.some((p) => p.endsWith('stylesheets')),
		'report.deleted should include stylesheets/'
	);
	assert.equal(report.orphans.length, 0, 'no orphans expected');
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('migrate is a no-op when run a second time on an already-migrated repo', async (t) => {
	const cleanupFns = [];
	t.after(() => cleanupFns.forEach((fn) => fn()));

	const repoRoot = copyFixture('legacy-multi', cleanupFns);
	const getCampaign = mockGetCampaign({
		'uuid-one': 'campaign-one',
		'uuid-two': 'campaign-two',
	});

	// First run — performs the actual migration.
	const firstReport = await migrate({
		repoRoot,
		campaigns: ['uuid-one', 'uuid-two'],
		getCampaign,
	});

	assert.ok(
		firstReport.moved.length > 0 || firstReport.renamed.length > 0,
		'first run should move or rename at least one file'
	);

	// Second run — everything is already in place.
	const secondReport = await migrate({
		repoRoot,
		campaigns: ['uuid-one', 'uuid-two'],
		getCampaign,
	});

	assert.equal(
		secondReport.moved.length,
		0,
		'second run should move nothing'
	);
	assert.equal(
		secondReport.renamed.length,
		0,
		'second run should rename nothing'
	);
	assert.equal(
		secondReport.deleted.length,
		0,
		'second run should delete nothing'
	);

	// Files still at the v2 paths after the second pass.
	assert.ok(
		fs.existsSync(
			path.join(repoRoot, 'campaigns/campaign-one/pages/home.json')
		)
	);
	assert.ok(
		fs.existsSync(
			path.join(
				repoRoot,
				'campaigns/campaign-one/stylesheets/main.scss'
			)
		)
	);
});

// ---------------------------------------------------------------------------
// Orphan handling
// ---------------------------------------------------------------------------

test('migrate leaves unconfigured campaign folders in place and lists them as orphans', async (t) => {
	const cleanupFns = [];
	t.after(() => cleanupFns.forEach((fn) => fn()));

	const repoRoot = copyFixture('legacy-multi', cleanupFns);

	// Only configure campaign-one; campaign-two becomes an orphan.
	const getCampaign = mockGetCampaign({ 'uuid-one': 'campaign-one' });

	const report = await migrate({
		repoRoot,
		campaigns: ['uuid-one'],
		getCampaign,
	});

	// campaign-one migrated.
	assert.ok(
		fs.existsSync(
			path.join(repoRoot, 'campaigns/campaign-one/pages/home.json')
		)
	);

	// campaign-two untouched in its legacy location.
	assert.ok(
		fs.existsSync(
			path.join(repoRoot, 'pages/campaign-two/home.json')
		),
		'orphan pages/campaign-two/ should remain'
	);
	assert.ok(
		fs.existsSync(
			path.join(
				repoRoot,
				'stylesheets/campaign-two/campaign-two.scss'
			)
		),
		'orphan stylesheets/campaign-two/ should remain'
	);

	// Orphans surfaced in the report.
	const orphanFolders = report.orphans.map((o) => o.folder);
	assert.ok(
		orphanFolders.some((f) => f.includes('campaign-two')),
		'campaign-two should appear in report.orphans'
	);

	// Root dirs not deleted (still contain the orphan).
	assert.ok(
		fs.existsSync(path.join(repoRoot, 'pages')),
		'pages/ should stay because the orphan is still there'
	);
	assert.ok(
		fs.existsSync(path.join(repoRoot, 'stylesheets')),
		'stylesheets/ should stay because the orphan is still there'
	);
});

// ---------------------------------------------------------------------------
// getCampaign failure — campaign processed independently
// ---------------------------------------------------------------------------

test('migrate continues processing remaining campaigns when one UUID cannot be resolved', async (t) => {
	const cleanupFns = [];
	t.after(() => cleanupFns.forEach((fn) => fn()));

	const repoRoot = copyFixture('legacy-multi', cleanupFns);

	// campaign-one resolves fine; campaign-two throws.
	const getCampaign = async ({ uuid }) => {
		if (uuid === 'uuid-one') return { data: { path: 'campaign-one' } };
		throw new Error('API error');
	};

	const report = await migrate({
		repoRoot,
		campaigns: ['uuid-one', 'uuid-bad'],
		getCampaign,
	});

	// campaign-one migrated normally.
	assert.ok(
		fs.existsSync(
			path.join(repoRoot, 'campaigns/campaign-one/pages/home.json')
		)
	);

	// Failed UUID listed as orphan.
	assert.ok(
		report.orphans.some((o) => o.folder === 'uuid-bad'),
		'unresolvable UUID should be listed in orphans'
	);
});
