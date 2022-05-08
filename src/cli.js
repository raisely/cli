import program from 'commander';
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

	program.command('init').action(init);

	program.command('update').action(update);

	program.command('start').action(start);

	program
		.command('create [name]')
		.description('create a new custom component')
		.action(create);

	program.command('deploy').action(deploy);

	program.command('login').action(login);

	program
		.command('local')
		.description('Start local development server for a single campaign.')
		.action(local);

	program.parse(process.argv);
}
