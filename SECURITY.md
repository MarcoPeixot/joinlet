# Security policy

## Reporting a vulnerability

Use **Security → Report a vulnerability** on this repository when private vulnerability reporting is enabled. If it is unavailable, open an issue requesting a private reporting channel without including exploit details, credentials or customer data. Maintainers must enable private reporting before the public launch.

Never put a token, live invitation link, private workspace, personal API key or secret-bearing log in a public issue. A report can describe the affected version, configuration, expected behavior, impact and a minimal reproduction with synthetic data.

## Supported versions

Joinlet is in beta. Security fixes target the current maintained revision. No long-term support or response-time SLA is promised for self-hosted installations.

## Installation boundaries

The local API in `apps/server` has filesystem/Git access and is intended for its local execution model. Use the remote backend and the documented production configuration for hosting. Self-hosting operators must supply their own GitHub application, encryption key, TLS, backups and access controls.

The public source code contains no operational credentials for Joinlet Cloud. Modifying a local installation's quotas or configuration grants no access to the official hosted service. Do not commit credentials even to a private repository.

## Automated checks

The security workflow checks tracked-file boundaries and scans Git history and the working directory with Gitleaks. Secret-redaction fixtures use explicit example values; this initial release adds no scanner exceptions. A passing scan is not proof that all confidential or personal information has been identified.
