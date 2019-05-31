import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs';
import path from 'path';

import { welcome, log, br, error } from './helpers';
import { login } from './actions/auth';
import { getCampaigns } from './actions/campaigns';
import { syncStyles, syncComponents } from './actions/sync';

export default function update(program) {

    program
    .command('update')
    .action(async (dir, cmd) => {

        const data = {};

        welcome();
        log(`You are about to update the styles and components in this directory`, 'white')
        br();
        console.log(`    ${chalk.inverse(`${__dirname}`)}`);
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
        let config;
        try {
            const configJson = fs.readFileSync(path.join(__dirname, 'raisely.json'));
            config = JSON.parse(configJson);
        } catch(e) {
            return error(`No raisely.json found. Run ${chalk.bold.underline.white('raisely init')} to start.`);
        }

        // sync down campaign stylesheets
        await syncStyles(config, __dirname);

        // sync down custom components
        await syncComponents(config, __dirname);

        br();
        log(`All done! Run ${chalk.bold.underline.white('raisely start')} to begin.`, 'green');

    })

}