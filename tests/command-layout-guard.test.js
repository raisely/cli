import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import update from '../src/update.js';
import deploy from '../src/deploy.js';
import local from '../src/local.js';
import start from '../src/start.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const originalCwd = process.cwd();

async function runInFixture(fixtureName, commandFn) {
	const logs = [];
	const originalLog = console.log;
	const previousExitCode = process.exitCode;
	let exitCodeAtReturn;

	process.chdir(path.join(fixturesDir, fixtureName));
	process.exitCode = undefined;
	console.log = (...args) => logs.push(args.join(' '));

	try {
		await commandFn();
		exitCodeAtReturn = process.exitCode;
	} catch {
		// Commands that pass the layout gate will throw when they hit auth or
		// network calls with no real credentials. Capture the exit code as it
		// stood when the throw happened; that is enough to verify the gate.
		exitCodeAtReturn = process.exitCode;
	} finally {
		console.log = originalLog;
		process.chdir(originalCwd);
		process.exitCode = previousExitCode;
	}

	return { output: logs.join('\n'), exitCode: exitCodeAtReturn };
}

function runInLegacyFixture(commandFn) {
	return runInFixture('legacy', commandFn);
}

function runInV2Fixture(commandFn) {
	return runInFixture('v2', commandFn);
}

test('update refuses to run on legacy layout', async () => {
	const { output, exitCode } = await runInLegacyFixture(() =>
		update({ force: true })
	);
	assert.equal(exitCode, 1);
	assert.match(output, /Cannot run `raisely update`/);
	assert.match(output, /npm install -g @raisely\/cli@2/);
	assert.match(output, /raisely migrate/);
});

test('deploy refuses to run on legacy layout', async () => {
	const { output, exitCode } = await runInLegacyFixture(() =>
		deploy({ force: true })
	);
	assert.equal(exitCode, 1);
	assert.match(output, /Cannot run `raisely deploy`/);
	assert.match(output, /npm install -g @raisely\/cli@2/);
	assert.match(output, /raisely migrate/);
});

test('local refuses to run on legacy layout', async () => {
	const { output, exitCode } = await runInLegacyFixture(() =>
		local({ open: false })
	);
	assert.equal(exitCode, 1);
	assert.match(output, /Cannot run `raisely local`/);
	assert.match(output, /npm install -g @raisely\/cli@2/);
	assert.match(output, /raisely migrate/);
});

test('start refuses to run on legacy layout', async () => {
	const { output, exitCode } = await runInLegacyFixture(() => start());
	assert.equal(exitCode, 1);
	assert.match(output, /Cannot run `raisely start`/);
	assert.match(output, /npm install -g @raisely\/cli@2/);
	assert.match(output, /raisely migrate/);
});

// ---------------------------------------------------------------------------
// v2 fixture: commands pass the layout gate
// ---------------------------------------------------------------------------

test('update passes the layout gate on a v2 fixture', async () => {
	const { output, exitCode } = await runInV2Fixture(() =>
		update({ force: true })
	);
	assert.notEqual(exitCode, 1);
	assert.doesNotMatch(output, /Cannot run `raisely update`/);
});

test('deploy passes the layout gate on a v2 fixture', async () => {
	const { output, exitCode } = await runInV2Fixture(() =>
		deploy({ force: true })
	);
	assert.notEqual(exitCode, 1);
	assert.doesNotMatch(output, /Cannot run `raisely deploy`/);
});

test('local passes the layout gate on a v2 fixture', async () => {
	const { output, exitCode } = await runInV2Fixture(() =>
		local({ open: false })
	);
	assert.notEqual(exitCode, 1);
	assert.doesNotMatch(output, /Cannot run `raisely local`/);
});

test('start passes the layout gate on a v2 fixture', async () => {
	const { output, exitCode } = await runInV2Fixture(() => start());
	assert.notEqual(exitCode, 1);
	assert.doesNotMatch(output, /Cannot run `raisely start`/);
});
