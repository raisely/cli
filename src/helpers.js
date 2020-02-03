import chalk from "chalk";
import get from "lodash/get";

export function log(message, color) {
	console.log(chalk[color || "white"](message));
}

export function br() {
	return console.log("");
}

export function welcome() {
	log(
		`
******************************
Raisely CLI (1.1.1)
******************************
        `,
		"magenta"
	);
}

export function error(e, loader) {
	const message = get(e, "response.body.errors[0].message") || e.message || e;
	if (loader) {
		loader.fail(message);
	} else {
		console.log(`${chalk.bgRed("Error:")} ${chalk.red(message)}`);
	}
}
