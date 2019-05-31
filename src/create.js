import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs';
import path from 'path';

import { welcome, log, br, error } from './helpers';
import { syncComponents } from './actions/sync';
import { createComponent } from './actions/components';

export default function create(program) {

    program
    .command('create')
    .action(async (name, cmd) => {

        // load config
        let config;
        try {
            const configJson = fs.readFileSync(path.join(process.cwd(), 'raisely.json'));
            config = JSON.parse(configJson);
        } catch(e) {
            return error(`No raisely.json found. Run ${chalk.bold.underline.white('raisely init')} to start.`);
        }

        welcome();
        log(`You are creating a new custom component. The component will be downloaded to:`, 'white')
        br();
        console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
        br();

        // get component name
        const response = await inquirer
            .prompt([
                {
                    type: 'input',
                    name: 'name',
                    message: 'Name of your component',
                    validate: (value) => {
                        return (value && /^[a-z0-9-]+$/.test(value)) ? true : 'Name can only use lowercase letters, "-" and numbers'
                    }
                }
            ]);

        // save component
        const componentLoader = ora(`Creating custom component called "${response.name}"...`)
        try {
            await createComponent(response, config.token);
            componentLoader.succeed();
        } catch(e) {
            return error(e, componentLoader);
        }

        // sync down custom components
        await syncComponents(config, process.cwd(), response.name);

        br();
        log(`All done! Run ${chalk.bold.underline.white('raisely start')} to begin.`, 'green');

    })

}