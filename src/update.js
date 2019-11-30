import chalk from 'chalk';
import inquirer from 'inquirer';

import { welcome, log, br } from './helpers';
import { syncStyles, syncComponents } from './actions/sync';
import { loadConfig } from './config';

export default function update(program) {

    program
    .command('update')
    .action(async (dir, cmd) => {

        welcome();
        log(`You are about to update the styles and components in this directory`, 'white')
        br();
        console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
        br();
        log(`You will lose any unsaved changes.`, 'white');
        br();

        // collect login details
        const response = await inquirer
            .prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: 'Are you sure you want to continue?',
                }
            ]);

        if (!response.confirm) {
            br();
            return log('Update aborted', 'red');
        }

        // load config
        const config = await loadConfig();

        // sync down campaign stylesheets
        await syncStyles(config, process.cwd());

        // sync down custom components
        await syncComponents(config, process.cwd());

        br();
        log(`All done! Run ${chalk.bold.underline.white('raisely start')} to begin.`, 'green');

    })

}