import ora from 'ora';
import { logout } from './actions/auth.js';
import { updateConfig } from './config.js';

export default async function logoutAction() {
	let logoutLoader = ora('Logging you out...').start();
	try {
        await logout();
        logoutLoader.info(`You have been logged out`);
    } catch (e) {
        // don't throw error, continue
    } finally {
        await updateConfig({
            token: null,
        });
        logoutLoader.stop()
    }
}
