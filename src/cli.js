import { program } from 'commander';
import { getPackageInfo } from './helpers.js';

/**
 * Action creator - only loads modules for commands when individually invoked
 * @param moduleLoader
 * @returns {(function(...[*]): Promise<void>)|*}
 */
function actionBuilder(moduleLoader) {
	return async function runtime(...args) {
		// load the module
		const { default: commandContext } = await moduleLoader();
		await commandContext(...args);
	};
}

// define actions
const init = actionBuilder(() => import('./init.js'));
const update = actionBuilder(() => import('./update.js'));
const start = actionBuilder(() => import('./start.js'));
const create = actionBuilder(() => import('./create.js'));
const deploy = actionBuilder(() => import('./deploy.js'));
const login = actionBuilder(() => import('./login.js'));
const local = actionBuilder(() => import('./local.js'));

export async function cli() {
	const pkg = getPackageInfo();
	program.version(pkg.version);

	program
		.command('init')
		.description('Initialize a remote Raisely campaign to this machine')
		.action(init);

	program
		.command('update')
		.description(
			'Synchronise (pull) a remote Raisely campaign with the files on this machine'
		)
		.action(update);

	program
		.command('deploy')
		.description(
			'Synchronise (push) a remote Raisely campaign with the files on this machine'
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
		.description('Authenticate with the Raisely api')
		.action(login);

	program
		.command('local')
		.description('Start local development server for a single campaign.')
		.action(local);

	// Make sure we show help after a bad command
	program.showHelpAfterError();

	program.parse(process.argv);

	// Show help if no values passed
	if (program.args.length === 0) {
		program.help();
	}
}
