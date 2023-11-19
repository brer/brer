#!/bin/bash

CONTAINER_NAME="brer-test"

COUCHDB_VERSION="3"
COUCHDB_PORT="5555"
COUCHDB_USERNAME="admin"
COUCHDB_PASSWORD="admin" # TODO: why only "admin" works as password?

docker container stop $CONTAINER_NAME >/dev/null 2>&1
docker container rm $CONTAINER_NAME >/dev/null 2>&1

echo "run fresh $CONTAINER_NAME container"
docker run -d --name $CONTAINER_NAME -e COUCHDB_USER=$COUCHDB_USERNAME -e COUCHDB_PASSWORD=$COUCHDB_PASSWORD -p $COUCHDB_PORT:5984 couchdb:$COUCHDB_VERSION

echo "wait for couchdb to become available"
sleep 5

echo "init database"
npm run init -- --url=http://127.0.0.1:$COUCHDB_PORT/ --username=$COUCHDB_USERNAME --password=$COUCHDB_PASSWORD 1> /dev/null

npx ava

echo "stop couchdb container"
docker container stop $CONTAINER_NAME 1> /dev/null
