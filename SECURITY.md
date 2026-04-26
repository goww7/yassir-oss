# Security

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

1. Open a **private** [GitHub security advisory](https://github.com/goww7/yassir-oss/security/advisories/new) for this repository, or  
2. Email the maintainers with details and reproduction steps (use the contact method you prefer if listed on your GitHub profile).

Include: affected version or commit, impact, and steps to reproduce where possible.

We will acknowledge receipt and work on a fix and disclosure timeline.

## Scope

This project runs with API keys on your machine and can access external services. Protect your `.env` file, rotate keys if exposed, and review any deployment-specific access controls before exposing the web UI publicly.
