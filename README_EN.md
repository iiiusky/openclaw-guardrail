# OpenClaw Guardrail System

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/iiiusky/openclaw-guardrail?style=social)](https://github.com/iiiusky/openclaw-guardrail)

[English](README_EN.md) | [中文](README.md)

OpenClaw Guardrail is a comprehensive security system for AI agents, providing real-time interception, sensitive data protection (DLP), and centralized policy management. It ensures safe execution of AI tools by auditing inputs, blocking dangerous commands, and monitoring asset distribution across your fleet.

![Dashboard](docs/img/dashboard.png)

## Features

- **Real-time Interception**: Blocks high-risk operations (e.g., filesystem access, unauthorized network calls) via `before_tool_call` hooks.
- **DLP Protection**: Deep inspection of HTTP request/response bodies to prevent credential leaks (AK/SK, Tokens).
- **Asset Visibility**: Automatically reports installed Skills, Plugins, and Providers every 10 minutes.
- **Centralized Policy**: Version-controlled security policies distributed to all agents with local caching support.
- **Audit & Logging**: Full audit trails for tool calls and network traffic, stored locally and reported to the server.
- **Modern Dashboard**: Vue 3 + Naive UI admin panel for visualizing threats, devices, and compliance status.

## Quick Start

Launch the full system (Server + MySQL + Redis + Web UI) with a single command:

```bash
git clone https://github.com/iiiusky/openclaw-guardrail.git
cd openclaw-guardrail
docker compose up -d
```

- **Dashboard**: `http://localhost`
- **Admin Key**: Run `docker compose exec server cat /app/secret.txt` to get the default key.

## Key Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_PORT` | Service port | `80` |
| `ADMIN_API_KEY` | Admin dashboard key | (Auto-generated) |
| `MYSQL_HOST` | Database host | `mysql` |
| `REDIS_HOST` | Cache host | `redis` |
| `COS_PLUGIN_URL` | Plugin distribution URL | (Empty) |

## Documentation

| Document | Description |
|----------|-------------|
| [Installation Guide](docs/INSTALL.md) | Docker / Manual deployment / Plugin install / Packaging |
| [User Guide](docs/USER_GUIDE.md) | End-user installation and usage guide |
| [Technical Article](docs/ARTICLE.md) | Design philosophy and technical overview |
| [Contributing](docs/CONTRIBUTING.md) | How to contribute, submit code, report issues |
| [Code of Conduct](docs/CODE_OF_CONDUCT.md) | Community behavior guidelines |

## License

This project is licensed under the [Business Source License 1.1 (BSL 1.1)](LICENSE).

- **Free Use**: Individuals, non-profits, and teams under 10 people.
- **Commercial Use**: Requires a license for teams > 10 or commercial services.
- **Change Date**: Converts to Apache 2.0 on 2030-03-20.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=iiiusky/openclaw-guardrail&type=Date)](https://star-history.com/#iiiusky/openclaw-guardrail&Date)
