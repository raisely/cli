const inquirer = require('inquirer');
const program = require('commander');
const chalk = require('chalk');

const log = (message, color) => {
    console.log(chalk[color || 'white'](message))
}

const br = () => console.log('');

const welcome = () => {
    log(`
******************************
Raisely CLI (1.0.0)
******************************
    `, 'magenta')
}

program
    .version('1.0.0')
    .command('init')
    .action((dir, cmd) => {

        welcome();
        log(`You're about to initialize a Raisely campaign in this directory`, 'white')
        br();
        console.log(`    ${chalk.inverse(`${process.cwd()}`, 'inverse')}`);
        br();
        log(`Log in to your Raisely account to start:`, 'white');
        br();

        inquirer
            .prompt([
                {
                    type: 'input',
                    name: 'email',
                    message: 'Enter your email address',
                    validate: (value) => (value.length ? true : 'Please enter your email address')
                },
                {
                    type: 'password',
                    message: 'Enter your password',
                    name: 'password',
                    validate: (value) => (value.length ? true : 'Please enter a password')
                }
            ])
            .then(answers => {
                console.log(answers);
            })

    })


program.parse(process.argv)