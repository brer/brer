# Brer

A simple Kubernetes task runner.

## Why

Brer is a simple task runner that uses some core Kubernetes features for process management.

The whole point of this project is to be a simple and effective task runner without doing other similar things (like a serverless framework). The goal is to schedule and manage multiple isolated tasks and be able to monitor them with ease. Unlike other similar projects, Pod images are left untouched, leaving full freedom to the developers. Small dependencies will be available for the major languages to integrate with Brer.

## Overview

![Brer happy path](docs/flow_chart.jpg)

### Components

- [API server](https://github.com/brer/brer-api)
- [Invoker](https://github.com/brer/brer-invoker)
- [Controller](https://github.com/brer/brer-controller)
- [Web UI](https://github.com/brer/brer-web)
- [CLI](https://github.com/brer/brer-cli)

### Runtimes

- [Node.js](https://github.com/brer/brer-nodejs)

## Features

- Initialization timeout (handle Pods stuck in `Pending` status)
- User code execution timeout
- Save Invocation stdout (logs)
- Arbitrary (binary) Invocation's payload
- Function's runtime validation
- Invocations history limit
- Stop running Invocations
- Progress update
- Limit number of concurrently running Invocations
- Retry Invocation on error

## Acknowledgements

This project is kindly sponsored by [Evologi](https://evologi.it/).
