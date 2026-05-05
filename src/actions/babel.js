let BabelAlreadyLoaded = false;

export async function loadBabelCore() {
	const [
		{ default: Babel },
		{ default: presetEnv },
		{ default: presetReact },
		{ default: classProps },
	] = await Promise.all([
		import('@babel/core'),
		import('@babel/preset-env'),
		import('@babel/preset-react'),
		import('@babel/plugin-proposal-class-properties'),
	]);

	if (!BabelAlreadyLoaded) {
		Babel.createConfigItem(presetEnv);
		Babel.createConfigItem(presetReact);
		Babel.createConfigItem(classProps);
		BabelAlreadyLoaded = true;
	}

	return { Babel, presetEnv, presetReact, classProps };
}
