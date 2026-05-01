import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import glob from 'glob-promise';

import { fetchStyles, processStyles } from '../src/actions/campaigns.js';
import { compileAllLocalPages } from '../src/actions/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const originalCwd = process.cwd();

/**
 * Run fn() with process.cwd() pointing at fixtures/<name>, then restore.
 */
function withFixture(fixtureName, fn) {
	return async () => {
		process.chdir(path.join(fixturesDir, fixtureName));
		try {
			await fn();
		} finally {
			process.chdir(originalCwd);
		}
	};
}

// ---------------------------------------------------------------------------
// fetchStyles
// ---------------------------------------------------------------------------

describe('fetchStyles – v2 layout', () => {
	test(
		'reads main.scss as css for my-campaign',
		withFixture('v2', async () => {
			const result = await fetchStyles({ campaign: 'my-campaign' });
			assert.ok(
				result.css.includes('.raisely-campaign'),
				'css should contain .raisely-campaign rule'
			);
		})
	);

	test(
		'excludes main.scss from configFiles',
		withFixture('v2', async () => {
			const result = await fetchStyles({ campaign: 'my-campaign' });
			assert.ok(
				!Object.prototype.hasOwnProperty.call(result.configFiles, 'main.scss'),
				'main.scss should not appear in configFiles'
			);
		})
	);

	test(
		'includes _variables.scss in configFiles',
		withFixture('v2', async () => {
			const result = await fetchStyles({ campaign: 'my-campaign' });
			assert.ok(
				Object.prototype.hasOwnProperty.call(
					result.configFiles,
					'_variables.scss'
				),
				'_variables.scss should be present in configFiles'
			);
			assert.ok(
				result.configFiles['_variables.scss'].includes('$primary'),
				'_variables.scss content should include $primary'
			);
		})
	);

	test(
		'returns empty configFiles when campaign has no partials',
		withFixture('v2', async () => {
			const result = await fetchStyles({ campaign: 'spring_2026' });
			assert.deepEqual(
				result.configFiles,
				{},
				'spring_2026 has no partials'
			);
		})
	);

	test(
		'reads each campaign independently in a multi-campaign repo',
		withFixture('v2-multi', async () => {
			const one = await fetchStyles({ campaign: 'campaign-one' });
			const two = await fetchStyles({ campaign: 'campaign-two' });
			assert.ok(
				one.css.includes('#e63946'),
				'campaign-one css should include #e63946'
			);
			assert.ok(
				two.css.includes('#457b9d'),
				'campaign-two css should include #457b9d'
			);
			assert.notEqual(
				one.css,
				two.css,
				'each campaign should have its own distinct css'
			);
		})
	);

	test(
		'campaign-two has no partials in multi-campaign repo',
		withFixture('v2-multi', async () => {
			const result = await fetchStyles({ campaign: 'campaign-two' });
			assert.deepEqual(result.configFiles, {});
		})
	);
});

// ---------------------------------------------------------------------------
// processStyles
// ---------------------------------------------------------------------------

describe('processStyles – v2 layout', () => {
	test(
		'concatenates main.scss and partials for my-campaign',
		withFixture('v2', async () => {
			const output = await processStyles({ campaign: 'my-campaign' });
			assert.ok(
				output.includes('.raisely-campaign'),
				'output should include main scss rule'
			);
			assert.ok(
				output.includes('$primary'),
				'output should include content from _variables.scss partial'
			);
		})
	);

	test(
		'returns only main.scss content when no partials exist',
		withFixture('v2', async () => {
			const output = await processStyles({ campaign: 'spring_2026' });
			assert.ok(output.includes('.raisely-campaign'));
			assert.ok(output.includes('#0b7a75'));
		})
	);

	test(
		'returns independent output for each campaign in multi-campaign repo',
		withFixture('v2-multi', async () => {
			const one = await processStyles({ campaign: 'campaign-one' });
			const two = await processStyles({ campaign: 'campaign-two' });
			assert.notEqual(one, two);
		})
	);
});

// ---------------------------------------------------------------------------
// compileAllLocalPages
// ---------------------------------------------------------------------------

describe('compileAllLocalPages – v2 layout', () => {
	test(
		'compiles pages from campaigns/*/pages/**/*.json in single-campaign repo',
		withFixture('v2', async () => {
			const map = await compileAllLocalPages();
			assert.ok(
				Object.prototype.hasOwnProperty.call(map, 'page-uuid-001'),
				'map should include page-uuid-001 from my-campaign'
			);
			assert.ok(
				Object.prototype.hasOwnProperty.call(map, 'page-uuid-special-v2'),
				'map should include page-uuid-special-v2 from spring_2026'
			);
		})
	);

	test(
		'filters pages by campaignUuid when provided',
		withFixture('v2', async () => {
			const map = await compileAllLocalPages({
				campaignUuid: 'campaign-uuid-my-campaign',
			});
			assert.ok(
				Object.prototype.hasOwnProperty.call(map, 'page-uuid-001')
			);
			assert.ok(
				!Object.prototype.hasOwnProperty.call(map, 'page-uuid-special-v2'),
				'page from a different campaign should be excluded'
			);
		})
	);

	test(
		'compiles pages from all campaigns in a multi-campaign repo',
		withFixture('v2-multi', async () => {
			const map = await compileAllLocalPages();
			assert.ok(
				Object.prototype.hasOwnProperty.call(map, 'page-uuid-001'),
				'map should include page from campaign-one'
			);
			assert.ok(
				Object.prototype.hasOwnProperty.call(map, 'page-uuid-002'),
				'map should include page from campaign-two'
			);
		})
	);

	test(
		'returns empty map when campaigns/ directory does not exist',
		withFixture('legacy', async () => {
			const map = await compileAllLocalPages();
			assert.deepEqual(map, {});
		})
	);
});

// ---------------------------------------------------------------------------
// deploy-time page glob
// ---------------------------------------------------------------------------

describe('deploy-time page glob – campaigns/*/pages/**/*.json', () => {
	test('finds all page files in a single-campaign v2 repo', async () => {
		const fixturePath = path.join(fixturesDir, 'v2');
		const files = await glob('campaigns/*/pages/**/*.json', {
			cwd: fixturePath,
		});
		assert.equal(files.length, 2, 'should find home.json for both campaigns');
		assert.ok(
			files.some((f) => f.includes('my-campaign')),
			'should find my-campaign page'
		);
		assert.ok(
			files.some((f) => f.includes('spring_2026')),
			'should find spring_2026 page'
		);
	});

	test('finds pages from all campaigns in a multi-campaign v2 repo', async () => {
		const fixturePath = path.join(fixturesDir, 'v2-multi');
		const files = await glob('campaigns/*/pages/**/*.json', {
			cwd: fixturePath,
		});
		assert.equal(files.length, 2);
		assert.ok(files.some((f) => f.includes('campaign-one')));
		assert.ok(files.some((f) => f.includes('campaign-two')));
	});

	test('returns no files for a legacy repo', async () => {
		const fixturePath = path.join(fixturesDir, 'legacy');
		const files = await glob('campaigns/*/pages/**/*.json', {
			cwd: fixturePath,
		});
		assert.equal(files.length, 0);
	});
});
