> Joinlet · Fonte: `SECURITY.md`. Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.

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

The scanner uses an explicit default-rules configuration outside the repository and a fresh ignore path. Repository-supplied Gitleaks configuration, ignore files and allow comments cannot suppress findings. The integration suite verifies this with generated synthetic test credentials and checks that deleting a credential does not remove it from history. Changes to the workflow and scanner still require maintainer review.

The file gate rejects nested backups, common private-key/configuration filenames, archives, database sidecars and case variants of private paths. It does not classify the meaning of arbitrary JSON, source comments or images. See [release boundaries](docs/releases.md) for how reviewed source reaches a hosted installation.
