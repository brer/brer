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

| Name              | Usage
| ----------------- | -----------------
| SERVER_HOST       | Listening host. Defaults to `127.0.0.1`.
| SERVER_PORT       | Server's post. Defaults to `3000`.
| SERVER_MODE       | Comma-separated values: `api`, `registry`, `controller`. Defaults to `api`.
| LOG_LEVEL         | [Pino](https://github.com/pinojs/pino) log level. Defaults to `info`.
| COUCHDB_URL       | CouchDB URL. Defaults to `http://127.0.0.1:5984/`.
| COUCHDB_USERNAME  |
| COUCHDB_PASSWORD  |
| K8S_FILE          | Kubeconfig filepath. Defaults to Current User's (OS) kubeconfig filepath.
| K8S_CONTEXT       | Kubeconfig context to use.
| K8S_CLUSTER       | Expected context's cluster.
| K8S_USER          | Expected context's user.
| K8S_NAMESPACE     | Expected kubeconfig namespace.
| **HMAC_SECRET**   | Secret used to hash Invocations' tokens.
| ADMIN_PASSWORD    | User's password for `admin`. Optional if `GATEWAY_URL` is defined.
| GATEWAY_URL       | Authentication gateway URL. Optional if `ADMIN_PASSWORD` is defined.
| COOKIE_SECRET     | Secret used to hash cookies (see [brer-web](https://github.com/brer/brer-web)).

### Start

```
npm run watch
```

### Test

```
chmod +x ./bin/test.sh && ./bin/test.sh
```

## Authentication for other Users

Brer is able to authenticate only the `admin` User. To authentication other Users add the `GATEWAY_URL` env. When an authentication is required, Brer will `POST` that URL with a JSON body containing `{ "username": "my.user", "password": "SuperS3cr3t" }`.

## Registry

Brer also expose a Registry proxy for Functions' images. Enable this feature adding the `registry` mode to the `SERVER_MODE` env variable.

Also set the next envs:

### Envs

| Name              | Usage
| ----------------- | -----------------
| **REGISTRY_URL**  | Required in `registry` mode. Docker/Distribution Registry URL to proxy.
| REGISTRY_USERNAME | Registry authentication username.
| REGISTRY_PASSWORD | Registry authentication password.
| **PUBLIC_URL**    | Required in `registry` mode.

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
- [x] Docker repository integration
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

## Acknowledgements

This project is kindly sponsored by [Evologi](https://evologi.it/).
