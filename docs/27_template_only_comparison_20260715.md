# CLIとtemplate-onlyの比較記録 — 2026-07-15

> **履歴資料:** 以下のPRIVATE CONTINUE／DISTRIBUTION HOLD判定は当時の検証判断です。現在の公開状態と保守方針は[Current status](03_status.md)を正本とします。比較結果と限界は履歴証拠として保持します。

Date: 2026-07-15 JST
MCK ref: `f7d48246ddb3f7c1af83a7f7644f1f1fd144bd6d`
Public target ref: `0df077f722583a36f519e5243404b78d7b4ad47a`
Runtime: Node `v24.14.0`
Scope: CLI固有の実務価値を判定する比較のみ。製品コード、detector、dependency、配布設定は変更していない。

## 結論

判定は **CLIとtemplateのhybridへ収束 / PRIVATE CONTINUE / DISTRIBUTION HOLD** とする。

5件のpublic-safe比較では、CLIはtemplate-only baselineより速くなく、固定rubric上の完全性も改善しなかった。一方、CLIは中央集約されたread-only command policyと自動preflightを5件すべてで提供した。template-only baselineは主要事実、15セクション構造、untrusted-content boundaryを再現できたが、安全確認はmanual warningに留まり、自動preflightを持たなかった。

したがって、packet specificationとtemplateをportableな正本として維持し、CLIはprivateな任意collector / safety gateとして残す。CLIを主役として機能拡張する根拠にも、CLIを直ちに廃止する根拠にもならない。一般公開、npm配布、release、visibility変更、外部告知は引き続き承認しない。

## 比較対象

前回のvalue-validationと同じ公開repository [`Driedsandwich/line-ops-ledger`](https://github.com/Driedsandwich/line-ops-ledger)を使用した。

| ID | Kind | Public target |
| --- | --- | --- |
| H1 | handoff | `Driedsandwich/line-ops-ledger` |
| T1 | triage | [Issue #207](https://github.com/Driedsandwich/line-ops-ledger/issues/207) |
| T2 | triage | [Issue #212](https://github.com/Driedsandwich/line-ops-ledger/issues/212) |
| R1 | review | [PR #287](https://github.com/Driedsandwich/line-ops-ledger/pull/287) |
| R2 | review | [PR #289](https://github.com/Driedsandwich/line-ops-ledger/pull/289) |

private repository本文、個人log、実credentialは入力していない。raw packetとraw GitHub本文は成果物へ保存せず、実行中のmemory内だけで評価した。

## 方法

### 共通条件

- 同じMac、同じCodex operator、同じNode runtime、同じtarget checkoutを使用した。
- 各方式を1回warm-upした後、3回ずつ実行してmedianを採用した。
- method順はtrialとrepetitionごとに交互化した。
- 時間はsource collection開始からMarkdown packet構築完了までを測定した。
- 評価rubricは測定前に固定した。

### CLI方式

現行mainの`mck handoff`、`mck triage`、`mck review`を対象repository contextで実行した。製品のcollector、read-only wrapper、preflight、rendererをそのまま使用した。

### Template-only方式

MCKのsource codeをimportせず、直接のread-only `git` / `gh` commandで同等fieldsを取得し、Maintainer Task Packet v0.1の15セクションへ決定的に組み立てた。

- GitHub/repository由来textはuntrusted contentとしてdynamic Markdown fenceへ入れた。
- local path、remote URL、raw local branch名はpacketへ入れなかった。
- target repositoryの`package.json`を読み、存在するverification scriptsを使用した。
- MCKの自動preflightは使わず、`Preflight: warning`とmanual safety reviewを明記した。

このbaselineは「templateと直接commandだけで再現できる範囲」を比較するための評価用one-off harnessである。harness自体は製品機能ではなく、成果物にも含めない。

## 時間結果

| ID | CLI median | Template-only median | CLI差分 | Ratio |
| --- | ---: | ---: | ---: | ---: |
| H1 | 1,622 ms | 1,435 ms | +187 ms | 1.13x |
| T1 | 675 ms | 550 ms | +125 ms | 1.23x |
| T2 | 571 ms | 513 ms | +58 ms | 1.11x |
| R1 | 706 ms | 687 ms | +19 ms | 1.03x |
| R2 | 735 ms | 741 ms | -6 ms | 0.99x |
| **Total** | **4,309 ms** | **3,926 ms** | **+383 ms** | **1.10x** |

この測定ではCLIが約9.8%長かった。差は小さく、network latencyを含む5件の小標本なので、一般的な速度差へ外挿しない。

## 品質結果

| Metric | CLI | Template-only |
| --- | ---: | ---: |
| Nonblank lines | 457 | 409 |
| Required factual / safety / target-command edits | 5 | 0 |
| Fixed-rubric missing information | 7 | 7 |
| Key factual parity | 5/5 | 5/5 |
| Required 15-section structure | 5/5 | 5/5 |
| Untrusted-content boundary | 5/5 | 5/5 |
| Unintended local/credential-like exposure | 0/5 | 0/5 |
| Automated preflight | 5/5 | 0/5 |

CLI側の5件のrequired editは、target repositoryに存在しない固定の`Run npm test.`を各packetが提案したためである。Template-only側はtargetの`package.json`に存在する`check`、`test:sidepanel`、`test:e2e`、`build`を条件付き候補として使用した。

固定rubric上のmissing informationは双方とも7件で、sourceに存在しない情報をpacket生成方式だけで補うことはできなかった。

## 判定理由

### CLIだけを中心に継続しない理由

1. 今回のend-to-end command時間はtemplate-onlyより短くなかった。
2. 固定rubric上の情報不足は減らなかった。
3. repository非対応のverification lineが5件すべてで修正を要した。
4. Node 24 runtimeとCLI保守を一般配布のために負担する価値は、この比較でも立証されていない。

### Template-onlyへ全面縮小しない理由

1. Template-only baselineは自動preflightを持たず、manual warningへ退行した。
2. CLIのcentral read-only policyはwrite-capable commandをsubprocess実行前に拒否する再利用可能な安全境界である。
3. One-off harnessの作成時間と保守費用は測定しておらず、templateだけで継続運用できるとは証明していない。
4. CLIは既にprivate local collectorとして動作し、主要事実、構造、安全表示を5件すべてで再現した。

### Hybridの意味

- packet specification、template、安全ガイドをportableな中心成果物として扱う。
- CLIはprivate local use向けの任意collectorとautomated safety gateとして保持する。
- CLI固有の新機能を自動的に増やさない。
- repository-aware verification planを修正する場合も独立した小concernとして再承認する。
- public distributionは別の価値証拠と明示的なmaintainer decisionがない限り再開しない。

## 限界

1. Template-only baselineはCodexが作成した決定的なone-off harnessであり、人間が手でMarkdownを作る時間を再現していない。
2. Harnessの初回設計・実装時間は各packetの時間へ含めていない。
3. Downstream AIの回答品質、実際の追加質問turn、人間の読解負荷は測定していない。
4. 5件は同一public repositoryの小標本であり、private repositoryや異なる技術stackへ一般化できない。
5. Template-only側のmanual warningは、MCK preflightと同等の検出能力を持たない。
6. 初回測定はmacOSのtemporary-directory realpath差によりCLI main entryが起動せず、harness defectとして全結果を破棄した。realpathへ修正後、CLI packetが非空であることを確認して全件を再測定した。本記録は再測定結果だけを使用する。

## 境界確認

- GitHub writeは行っていない。
- commit、push、Issue、PR、review、mergeは行っていない。
- package、tag、release、visibility、settingsを変更していない。
- dependencyを追加していない。
- 外部LLM APIを呼んでいない。
- 製品コード、detector、distribution設定を変更していない。
- 比較前から存在したdocs-only差分は変更していない。

## Current decision

**CLIとtemplateのhybridへ収束 / PRIVATE CONTINUE / DISTRIBUTION HOLD**

この記録はhybrid方針の判断材料であり、repository-aware verification planの実装、package publication、public release、visibility変更、outside contribution、外部告知を承認しない。
