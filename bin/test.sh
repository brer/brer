#!/bin/bash

CONTAINER_NAME="brer-test"

COUCHDB_VERSION="3"
COUCHDB_PORT="5555"
COUCHDB_USERNAME="admin"
COUCHDB_PASSWORD="admin" # TODO: why only "admin" works as password?

if [ ! $(docker ps -a -q -f name=$CONTAINER_NAME) ]; then
  echo "run fresh $CONTAINER_NAME container"
  docker run -d --name $CONTAINER_NAME -e COUCHDB_USER=$COUCHDB_USERNAME -e COUCHDB_PASSWORD=$COUCHDB_PASSWORD -p $COUCHDB_PORT:5984 couchdb:$COUCHDB_VERSION
else
  echo "start $CONTAINER_NAME container"
  docker container start $CONTAINER_NAME 1> /dev/null
fi

echo "wait for couchdb to become available"
sleep 5

echo "init database"
./bin/init.ts --url=http://127.0.0.1:$COUCHDB_PORT/ --username=$COUCHDB_USERNAME --password=$COUCHDB_PASSWORD 1> /dev/null

npm test

echo "stop couchdb container"
docker container stop $CONTAINER_NAME 1> /dev/null

# docker container rm $CONTAINER_NAME 1> /dev/null
