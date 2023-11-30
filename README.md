# Brer

A simple Kubernetes task runner.

## Why

Brer is a simple task runner that uses some core Kubernetes features for process management.

The whole point of this project is to be a simple and effective task runner without doing other similar things (like a serverless framework). The goal is to schedule and manage multiple isolated tasks and be able to monitor them with ease. Unlike other similar projects, Pod images are left untouched, leaving full freedom to the developers. Small dependencies will be available for the major languages to integrate with Brer.

## Setup

### Dependencies

- [Node.js](https://nodejs.org/) v20.6.0 or later
- [CouchDB](https://couchdb.apache.org/) v3.x.x
- A Kubernetes cluster (any non-ancient version, [minikube](https://minikube.sigs.k8s.io/docs/) is ok)

### Envs

Create a `.env` file with the following envs:

#### Common

| Name              | Description
| ----------------- | -----------------
| NODE_ENV          |
| SERVER_HOST       | Listening host. Defaults to `127.0.0.1`.
| SERVER_PORT       | Server's post. Defaults to `3000`.
| SERVER_MODE       | Comma-separated values: `api`, `registry`, `controller`. Defaults to `api`.
| LOG_LEVEL         | [Pino](https://github.com/pinojs/pino) log level. Defaults to `info`.
| COUCHDB_URL       | CouchDB URL. Defaults to `http://127.0.0.1:5984/`.
| COUCHDB_USERNAME  |
| COUCHDB_PASSWORD  |
| **JWT_SECRET**    |
| PUBLIC_URL        | Defaults to local server.

#### API

| Name              | Description
| ----------------- | -----------------
| K8S_NAMESPACE     |
| INVOKER_URL       |
| COOKIE_NAME       | Defaults to `brer_session`.
| COOKIE_DOMAIN     |
| ADMIN_PASSWORD    | User's password for `admin`. Optional if `GATEWAY_URL` is defined.
| GATEWAY_URL       | Authentication gateway URL. Optional if `ADMIN_PASSWORD` is defined.

#### Invoker

| Name              | Description
| ----------------- | -----------------
| K8S_FILE          | Kubeconfig filepath. Defaults to Current User's (OS) kubeconfig filepath.
| K8S_CONTEXT       | Kubeconfig context to use.
| K8S_CLUSTER       | Expected context's cluster.
| K8S_USER          | Expected context's user.
| K8S_NAMESPACE     | Expected kubeconfig namespace.
| API_URL           |
| INVOKER_URL       |

#### Registry

| Name              | Description
| ----------------- | -----------------
| **REGISTRY_URL**  |
| REGISTRY_USERNAME |
| REGISTRY_PASSWORD |
| K8S_NAMESPACE     |
| API_URL           |
| PUBLIC_URL        |

### Start

Initialize the database:

```
npm run init -- --url=couchdb_url --username=couchdb_username --password=couchdb_username
```

Start the server:

```
npm run watch
```

### Test

Install Docker Engine (the `docker` command) and run:

```
npm test
```

## Authentication for other Users

Brer is able to authenticate only the `admin` User. To authentication other Users add the `GATEWAY_URL` env. When an authentication is required, Brer will `POST` that URL with a JSON body containing `{ "username": "my.user", "password": "SuperS3cr3t" }`.

## Roadmap

- [x] Invocation init timeout
- [x] See Invocations' logs
- [x] Use Kubernetes secrets
- [x] Arbitrary payload for Invocations
- [x] Recover running Invocations without Pod
- [x] Runtime validation after image update
- [x] [Web UI](https://github.com/brer/brer-web)
- [x] [Node.js bindings](https://github.com/brer/brer-nodejs)
- [x] Previous Invocations history limit
- [x] Authentication and authorization
- [x] Docker Registry integration
- [x] Stop Invocations
- [x] Progress update
- [ ] Max running Invocations limit
- [ ] Swagger/OpenAPI
- [ ] Configure pod resources (cpu and memory)
- [ ] Helm chart
- [ ] Invocation attempts (retry)
- [ ] Callback URL
- [ ] Go bindings
- [ ] Rust bindings
- [ ] CLI
- [ ] Play/Pause Invocations
- [ ] Invocation max running time (with global default)

## Acknowledgements

This project is kindly sponsored by [Evologi](https://evologi.it/).
