# Licensing

alca-bots is open source under the [Apache License 2.0](LICENSE).

## Origin

alca-bots is a derivative work of
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) by Milind Soni and
the OpenMausBot contributors, used under the Apache License 2.0. As that
license requires (section 4):

- the [LICENSE](LICENSE) text is kept unchanged;
- the upstream [NOTICE](NOTICE) is kept in full, preceded by a statement that
  this project is a modified version;
- the files of this project were modified from the originals: the product was
  renamed throughout, and the upstream `enterprise/` directory was removed.

## What was not taken

Upstream's `enterprise/` directory is source-available under a separate
OpenMausBot Enterprise License, not Apache 2.0, and is **not part of this
repository**. Upstream supports building without it: the server then reports
`{"edition":"oss"}` and ordinary standalone operation is unchanged.

## Contributions

Contributions are accepted under the Apache License 2.0. Submit only code you
wrote or have the right to contribute.

## Third-party components

Bundled third-party software keeps its own licenses; notices, license texts and
source locations are listed in [NOTICE](NOTICE) and
[`third_party/`](third_party/).

## ego lite

Bots browse through [ego lite](https://lite.ego.app/), a browser by Citro Labs
that each person installs on their own computer. It is proprietary software
under [its own terms](https://lite.ego.app/terms), which the person accepts
with Citro Labs; this repository does not include or distribute ego lite or its
`ego-browser` CLI, and only runs the CLI the person installed. The bots'
guidance for it adapts the MIT-licensed ego-browser skill from
[citrolabs/ego-lite](https://github.com/citrolabs/ego-lite); its license is in
[`third_party/ego-lite/LICENSE`](third_party/ego-lite/LICENSE).

## Trademarks

OpenMausBot and MausBot, and the OpenMausBot mascot, are trademarks of Supamaus
Software Private Limited. The Apache License does not grant trademark rights
(section 6), so this project uses its own name. alca-bots is not affiliated with
or endorsed by Milind Soni, OpenMausBot or Supamaus Software Private Limited.
