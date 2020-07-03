.PHONY: init update deploy

init:
	npm install
	node ./bin/raisely init

update:
	node ./bin/raisely update

deploy:
	node ./bin/raisely deploy	
