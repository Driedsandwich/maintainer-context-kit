# Repository-aware verification plan 検証記録 — 2026-07-15

> **履歴資料:** 以下のPRIVATE CONTINUE／DISTRIBUTION HOLD判定は当時の検証判断です。現在の公開状態と保守方針は[Current status](03_status.md)を正本とします。修正結果と限界は履歴証拠として保持します。

Date: 2026-07-15 JST
MCK base ref: `f7d48246ddb3f7c1af83a7f7644f1f1fd144bd6d`
Public target ref: `0df077f722583a36f519e5243404b78d7b4ad47a`
Runtime: Node `v24.14.0`, npm `10.9.8`
Scope: verification planの正確性修正と同一5件の再検証のみ。

## 結論

対象repositoryに存在しない固定`Run npm test.`を出力する問題は、repository identity、npm利用根拠、実在scriptを確認する最小修正で解消した。

同じ5件のpublic-safe対象では、verification plan由来の必要修正は`5件 → 0件`となった。主要事実、packet構造、untrusted-content境界、自動preflightは5件すべてで維持され、意図しないlocal path・remote URL・local usernameの露出は0件だった。

この結果はhybrid方針下でのprivate CLI正確性修正を支持する。現在判断は **CLI AND TEMPLATE HYBRID / PRIVATE CONTINUE / DISTRIBUTION HOLD** のままであり、一般配布、package公開、detector拡張、新commandを承認しない。

## 修正方針

- issue / PRのGitHub URLとlocal git remoteが同一repositoryを示す場合だけlocal package metadataを使用する。
- npm利用は`packageManager: npm@...`、`package-lock.json`、`npm-shrinkwrap.json`のいずれかで確認する。
- verification commandは、静的allowlistにあり、かつ`package.json` scriptsに実在する名前だけから組み立てる。script本文は読み込んでもpacketへ出力しない。
- repository一致、npm利用、対応scriptのどれかを確認できない場合は、repository文書に従う一般表現へ退避し、commandを推測しない。
- MCK source checkout相対の`node src/cli.ts ...`や、対象repositoryに存在するとは限らないMCK用npm scriptも出力しない。

## Test結果

| Check | Result |
| --- | --- |
| Repository-aware対象tests | 27 / 27 pass |
| 全regression tests | 53 / 53 pass |
| `npm run doctor:json` | exit 0 |
| `npm run handoff` | exit 0 |
| `npm run triage:demo` | exit 0 |
| `npm run review:demo` | exit 0 |
| `node src/cli.ts --help` | exit 0 |
| `node src/cli.ts --version` | exit 0 |
| `git diff --check` | pass |

## 5件の再検証

`docs/26_cli_value_validation_20260715.md`と`docs/27_template_only_comparison_20260715.md`で使用した同じpublic repository、issue 2件、PR 2件を使用した。raw packet本文とraw GitHub本文は保存していない。

| ID | Kind | Verification edits | Fact parity | 15 sections | Untrusted boundary | Unintended exposure | Preflight |
| --- | --- | ---: | --- | --- | --- | ---: | --- |
| H1 | handoff | 0 | pass | pass | pass | 0 | warning |
| T1 | triage | 0 | pass | pass | pass | 0 | pass |
| T2 | triage | 0 | pass | pass | pass | 0 | pass |
| R1 | review | 0 | pass | pass | pass | 0 | pass |
| R2 | review | 0 | pass | pass | pass | 0 | pass |

H1のwarningは既知のlocal-path-like findingであり、raw local pathはpacketへ出力されていない。

## 限界

1. 自動提案はnpmと静的allowlist上のscript名だけを対象とする。pnpm、Yarn、Python、Rust、Go等のcommandは推測しない。
2. scriptが存在することは確認するが、script本文の安全性や実行コストは判定しない。packetはcommandを自動実行しない。
3. GitHub.comのremoteだけをrepository照合対象とし、GitHub Enterpriseは一般表現へ退避する。
4. 5件は同一public repositoryの小標本であり、他の技術stackやprivate repositoryへ一般化しない。
5. Downstream AIの品質、人間の読解時間、配布価値は再評価していない。

## 境界

- `docs/26_cli_value_validation_20260715.md`と`docs/27_template_only_comparison_20260715.md`は書き換えていない。
- 新dependency、detector、command、distribution設定を追加していない。
- GitHub write、commit、push、Issue、PR、package、tag、release、外部LLM APIを使用していない。
