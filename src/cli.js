import { InvalidArgumentError, program } from 'commander';
import { getPackageInfo } from './helpers.js';
import { flushTelemetry, trackEvent } from './telemetry.js';

/**
 * Action creator - only loads modules for commands when individually invoked
 * @param moduleLoader
 * @returns {(function(...[*]): Promise<void>)|*}
 */
function actionBuilder(moduleLoader, commandName) {
	return async function runtime(...args) {
		const startedAt = Date.now();
		let outcome = 'success';
		let errorCode;
		try {
			// load the module
			const { default: commandContext } = await moduleLoader();
			await commandContext(...args);
		} catch (error) {
			outcome = 'error';
			errorCode =
				error?.subcode || error?.code || error?.status || error?.name;
			throw error;
		} finally {
			trackEvent(`cli.${commandName}`, {
				outcome,
				durationMs: Date.now() - startedAt,
				...(errorCode ? { errorCode } : {}),
			});
			await flushTelemetry();
		}
	};
}

function parsePort(value) {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new InvalidArgumentError('Port must be an integer between 1 and 65535');
	}
	return port;
}

// define actions
const init = actionBuilder(() => import('./init.js'), 'init');
const update = actionBuilder(() => import('./update.js'), 'update');
const start = actionBuilder(() => import('./start.js'), 'start');
const create = actionBuilder(() => import('./create.js'), 'create');
const deploy = actionBuilder(() => import('./deploy.js'), 'deploy');
const login = actionBuilder(() => import('./login.js'), 'login');
const logout = actionBuilder(() => import('./logout.js'), 'logout');
const local = actionBuilder(() => import('./local.js'), 'local');
const list = actionBuilder(() => import('./list.js'), 'list');
const migrate = actionBuilder(() => import('./migrate.js'), 'migrate');
const mediaList = actionBuilder(() => import('./media/list.js'), 'media.list');
const mediaDelete = actionBuilder(
	() => import('./media/delete.js'),
	'media.delete'
);

export async function cli() {
	const pkg = getPackageInfo();
	program.version(pkg.version);

	program
		.command('init')
		.description('Initialize a remote Raisely campaign to this machine')
		.option(
			'--uuid <uuid>',
			'Initialize a specific campaign by UUID (skips the campaign picker)'
		)
		.action(init);

	program
		.command('update')
		.description(
			'Synchronise (pull) a remote Raisely campaign with the files on this machine'
		)
		.option(
			'-f, --force',
			'Update without asking for confirmation (non-interactive)'
		)
		.action(update);

	program
		.command('deploy')
		.description(
			'Synchronise (push) a remote Raisely campaign with the files on this machine'
		)
		.option(
			'--no-validate',
			'Skip pre-flight SCSS/component validation before upload'
		)
		.option(
			'-f, --force',
			'Deploy without asking for confirmation (non-interactive)'
		)
		.action(deploy);

	program
		.command('start')
		.description(
			'Start a watcher instance. Updates configured Raisely campaigns when component or style changes are made locally'
		)
		.action(start);

	program
		.command('create [name]')
		.description('Create a new custom component')
		.action(create);

	program
		.command('login')
		.description(
			'Sign in with OAuth (browser); stores tokens in the OS keychain'
		)
		.action(login);

	program
		.command('logout')
		.description('Revoke the CLI session and clear stored credentials')
		.action(logout);

	program
		.command('local')
		.description('Start local development server for a single campaign.')
		.option(
			'--uuid <uuid>',
			'Open a specific campaign by UUID (skips the campaign picker)'
		)
		.option('--port <port>', 'Override the local server port', parsePort, 8015)
		.option('--no-open', 'Do not open a browser window')
		.action(local);

	program
		.command('list')
		.description('List all campaigns in your organisation (Name, Uuid)')
		.option('--json', 'Output as JSON (forces machine format)')
		.option('--tsv', 'Output as tab-separated values (forces machine format)')
		.action(list);

	program
		.command('migrate')
		.description(
			'Migrate an existing repo from the v1 layout to the v2 layout (one-shot, idempotent)'
		)
		.action(migrate);

	const media = program
		.command('media')
		.description('Manage campaign and organisation media assets')
		.action(function () {
			this.help();
		});

	media
		.command('list')
		.description('List media for a campaign or organisation')
		.option(
			'--campaign <slug>',
			'Campaign path/slug (defaults to the first campaign in .raisely.json)'
		)
		.option('--organisation <uuid>', 'Organisation UUID')
		.option('--json', 'Output as JSON')
		.action(mediaList);

	media
		.command('delete <uuid>')
		.description('Delete a media asset by UUID')
		.option(
			'--campaign <slug>',
			'Campaign path/slug (defaults to the first campaign in .raisely.json)'
		)
		.option('--organisation <uuid>', 'Organisation UUID')
		.option('--json', 'Output result as JSON')
		.action(mediaDelete);

	// Make sure we show help after a bad command
	program.showHelpAfterError();

	program.parse(process.argv);

	// Show help if no values passed
	if (program.args.length === 0) {
		program.help();
	}
}
