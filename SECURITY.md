# Security Policy

## Supported versions

This project is pre-1.0. Only the latest released version (and `main`) receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/anuu1989/playwright-sapui5/security/advisories/new)
(Security tab → "Report a vulnerability"). Include:

- what the issue is and its impact,
- steps or a minimal repro (affected file/feature, versions of Node, Playwright and SAPUI5 if relevant),
- any suggested fix, if you have one.

You can expect an acknowledgement within a few days. We'll keep you updated as we investigate,
and credit you in the release notes once a fix ships, unless you'd rather stay anonymous.

## Scope

In scope: the library under `src/`, the `pw-sapui5` CLI and generators (for example, unsafe file
writes or command execution), and the CI workflow.

Things to keep in mind when using the framework: the `.env` file and saved Playwright auth state
(`storageState`) contain credentials, so keep them out of version control (see `.env.example` and
`.gitignore`), and traces, reports and API catalogs generated from test traffic can contain
tokens or personal data, so review them before sharing.

Vulnerabilities in SAPUI5/OpenUI5 or Playwright themselves should be reported to their respective
maintainers.
