.PHONY: init update deploy start

init:
	npm install
	node ./bin/raisely init

update:
	node ./bin/raisely update

deploy:
	node ./bin/raisely deploy

start:
	node ./bin/raisely start	

