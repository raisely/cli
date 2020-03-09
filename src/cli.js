import program from "commander";

import init from "./init";
import update from "./update";
import start from "./start";
import create from "./create";
import deploy from "./deploy";

export async function cli(args) {
	program.version("1.4.0");
	program.option("-a, --api <api>", "custom api url");

	init(program);
	update(program);
	start(program);
	create(program);
	deploy(program);

	program.parse(process.argv);
}
