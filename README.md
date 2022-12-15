# Brer

A simple Kubernetes task runner.

## Why

Brer is a simple task runner that uses some core Kubernetes features for process management.

The whole point of this project is to be a simple and effective task runner without doing other similar things (like a serverless framework). The goal is to schedule and manage multiple isolated tasks and be able to monitor them with ease. Unlike other similar projects, Pod images are left untouched, leaving full freedom to the developers. Small dependencies will be available for the major languages to integrate with Brer.

## Roadmap

- [ ] Invocation init timeout
- [ ] Previous Invocations history limit
- [ ] Max running Invocations limit
- [x] [NSQ](https://nsq.io/) for Invocations spawn
- [ ] Function image validation after an update
- [ ] Store logs somewhere (pods will be deleted)
- [ ] Swagger / OpenAPI
- [ ] Support secrets (CRUD)
- [ ] Tests
- [ ] Support namespaces
- [ ] Configure pod resources (cpu and memory)
- [ ] Make auth configurable
- [ ] Helm chart
- [ ] Invocation attempts (retry)
- [ ] Arbitrary payload for Invocations
- [ ] Callback URL
- [ ] Function concurrency (max pending/running Invocations allowed)
- [ ] Recover running Invocations without Pod

## Related projects

- [brer-nodejs](https://github.com/brer/brer-nodejs) Node.js bindings for Brer.
