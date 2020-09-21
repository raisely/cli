import chalk from "chalk";
import get from "lodash/get";
import request from "request-promise-native";
import modConfig from "../package.json";

let updatePromise;
let latestVersion;

function checkUpdate() {
	if (!updatePromise) {
		const url = `https://registry.npmjs.org/-/package/${modConfig.name}/dist-tags`;
		updatePromise = request({
			url,
			json: true
		})
		.then(result => {			
			latestVersion = result.latest;
		})
		.catch(e => {
			// noop 
		})
	}
}

export function log(message, color) {
	console.log(chalk[color || "white"](message));
}

export function br() {
	return console.log("");
}

export function welcome() {
	checkUpdate();
	log(
		`
******************************
Raisely CLI (${modConfig.version})
******************************
        `,
		"magenta"
	);
}

export async function informUpdate() {
	if (updatePromise) {
		await updatePromise;
		if (latestVersion > modConfig.version) {
			log(
`
A new version of the Raisely cli is available (${latestVersion}), to update, run:
		npm update @raisely/cli
`,

        "white"
      );
		}
	}

}

export function error(e, loader) {
	const message = get(e, "response.body.errors[0].message") || e.message || e;
	if (loader) {
		loader.fail(message);
	} else {
		console.log(`${chalk.bgRed("Error:")} ${chalk.red(message)}`);
	}
}
