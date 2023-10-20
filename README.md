# Brer

A simple Kubernetes task runner.

## Why

Brer is a simple task runner that uses some core Kubernetes features for process management.

The whole point of this project is to be a simple and effective task runner without doing other similar things (like a serverless framework). The goal is to schedule and manage multiple isolated tasks and be able to monitor them with ease. Unlike other similar projects, Pod images are left untouched, leaving full freedom to the developers. Small dependencies will be available for the major languages to integrate with Brer.

## Roadmap

Proposals for future versions.

- [x] Invocation init timeout
- [x] See Invocations' logs
- [x] Use Kubernetes secrets
- [x] Arbitrary payload for Invocations
- [x] Recover running Invocations without Pod
- [x] Runtime validation after image update
- [x] [Web UI](https://github.com/brer/brer-web)
- [x] [Node.js bindings](https://github.com/brer/brer-nodejs)
- [x] Previous Invocations history limit
- [ ] Max running Invocations limit
- [ ] OpenAPI
- [ ] Integration tests
- [ ] Support namespaces
- [ ] Configure pod resources (cpu and memory)
- [ ] Authentication and authorization (users and policies)
- [ ] Helm chart
- [ ] Invocation attempts (retry)
- [ ] Callback URL
- [ ] Go bindings
- [ ] Rust bindings
- [ ] PHP bindings
- [ ] Brer CLI
- [ ] Docker repository integration

## Acknowledgements

This project is kindly sponsored by [Evologi](https://evologi.it/).
