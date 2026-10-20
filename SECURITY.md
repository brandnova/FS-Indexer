# Security policy

## Supported versions

Security fixes go into the latest release. Please update before reporting.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Report it privately:

- Use GitHub's **Report a vulnerability** button on the repository's Security tab, or
- email **brandnova.dev@gmail.com** with "Security" in the subject.

Include what you found, how to reproduce it, the versions of the agent and app, and what an attacker could do with it.

I'll acknowledge your report within **7 days**, tell you what I plan to do, and credit you in the release notes if you'd like. This is a small, spare-time project, so please allow reasonable time for a fix before you disclose it.

## Scope

In scope: the agent (the phone API and the dashboard), the app, and the release downloads.

Known and documented, so not a vulnerability by itself: the connection between phone and PC is **not encrypted yet** and is meant for trusted networks (see the [security model](docs/SECURITY_MODEL.md)).

## Good-faith research

Testing your own devices and network is welcome. Please don't access other people's data, disrupt other people's services, or use social engineering.

How the project protects you, and what it doesn't: [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).
