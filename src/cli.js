import program from "commander";

import init from "./init";
import update from "./update";
import start from "./start";
import create from "./create";

export async function cli(args) {
	program.version("1.3.0");
	program.option("-a, --api <api>", "custom api url");

	init(program);
	update(program);
	start(program);
	create(program);

	program.parse(process.argv);
}
