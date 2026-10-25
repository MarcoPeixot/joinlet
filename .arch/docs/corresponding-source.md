> Joinlet · Fonte: `SOURCE.md`. Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.

# Corresponding source

Joinlet application source: <https://github.com/MarcoPeixot/joinlet>.

Releases and container images must identify their source commit. Build a release image from a clean, reviewed checkout and pass its commit as `--build-arg JOINLET_REVISION=<commit>`. Keep the source revision and build/deployment instructions available to recipients and to users entitled to source under the AGPL. A repository homepage pointing to a different version is not a substitute for the corresponding source.

If operating a modified version over a network, follow the AGPL source-offer requirements for that version. Operational credentials and customer data are not corresponding source and must not be included in a source release.

The product repository is the source-distribution endpoint. Releases and published images must use an accessible revision from it. The old development repository and private operations materials are not source-distribution endpoints.

Third-party notices and asset terms are in `THIRD_PARTY_NOTICES.md` and `docs/third-party/`.
