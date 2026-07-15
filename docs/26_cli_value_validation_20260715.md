# CLI実務価値検証記録 — 2026-07-15

Date: 2026-07-15 JST
Repository ref at start: `7acfa27d7536638011fca6350f405cdd4fe10244`
Runtime: Node `v24.14.0`
Scope: CLIの実務価値検証のみ。機能変更、detector変更、配布・公開変更は含まない。

## 結論

5回のpublic-safe試行では、packetの構造化、安全境界、主要事実の転記には一貫した価値があった。一方、CLI独自の実務価値を一般配布の根拠にできるほどの時間短縮・追加質問削減は確認できなかった。

判定は **PRIVATE CONTINUE / DISTRIBUTION HOLD** とする。CLIはprivate iterationに残すが、機能追加や公開判断へ進まず、次の判断材料は同じ5タスクを使ったtemplate-only方式との比較とする。

## 対象と安全境界

公開repository [`Driedsandwich/line-ops-ledger`](https://github.com/Driedsandwich/line-ops-ledger)だけを対象にした。検証用checkoutはpublic repositoryのshallow cloneであり、private repository本文、個人ログ、実secretは入力していない。

試行は次の5件。

| ID | Command kind | Public target |
|---|---|---|
| H1 | handoff | `Driedsandwich/line-ops-ledger` |
| T1 | triage | [Issue #207](https://github.com/Driedsandwich/line-ops-ledger/issues/207) |
| T2 | triage | [Issue #212](https://github.com/Driedsandwich/line-ops-ledger/issues/212) |
| R1 | review | [PR #287](https://github.com/Driedsandwich/line-ops-ledger/pull/287) |
| R2 | review | [PR #289](https://github.com/Driedsandwich/line-ops-ledger/pull/289) |

raw packet本文とGitHub本文はこの記録へ保存せず、公開URL、集計値、判定だけを残した。

## 測定方法

### 時間

- 各試行で1回warm-up後、CLIと直接収集を交互順で3回ずつ実行し、medianを採用した。
- CLI時間はpacket生成完了までのwall-clock time。
- 直接収集時間は、CLIと同じsource fieldsをread-onlyな`git` / `gh` commandで順番に取得する時間。
- 直接収集は人間による読解、情報選別、Markdown作成を含まない。そのため「手作業時間」の下限であり、完全なmanual workflowではない。

### 必要修正と不要情報

packetを下流へ渡す前に必要な、事実・安全・対象repository手順の訂正行だけを必要修正として数えた。好みの文体、短縮可能なboilerplate、既知のlimitationsは数えていない。

対象repositoryの`package.json`には`npm test` scriptがなく、`check`、`test:sidepanel`、`test:e2e`が定義されている。全packetに固定表示された`Run npm test.`は対象に適用不能なため、各packetで1行の必要修正かつtarget-inappropriate lineと判定した。

### 追加質問

- triageはreproduction、expected、actual、environmentの4項目をraw GitHub JSONとpacketへ独立適用した。
- reviewはPR description、changed-file summary、status checksの3項目を独立適用した。
- handoffは必要なread-only commandの取得失敗数を比較した。
- downstream LLMは使用していない。ここでの質問数は、固定rubricで不足したsource factsの件数であり、実際のAI会話turn数ではない。

### 露出と事実一致

次を各packetで確認した。

- repository / issue / PRの主要事実がdirect sourceと一致する。
- local checkout pathをraw表示しない。
- raw current branch名を表示しない。
- obvious GitHub-token-like valueを表示しない。
- untrusted-content boundaryを表示する。

これは限定した検査であり、完全なsecret / PII scanを意味しない。

## 実測結果

| ID | CLI median | Direct collection median | Overhead | Ratio | Nonblank lines | Required edits | Missing questions raw → packet | Exposure |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| H1 | 1,964 ms | 1,585 ms | +379 ms | 1.24x | 85 | 1 | 0 → 0 | 0 |
| T1 | 590 ms | 523 ms | +67 ms | 1.13x | 90 | 1 | 4 → 4 | 0 |
| T2 | 618 ms | 477 ms | +140 ms | 1.29x | 90 | 1 | 3 → 3 | 0 |
| R1 | 765 ms | 643 ms | +122 ms | 1.19x | 96 | 1 | 0 → 0 | 0 |
| R2 | 736 ms | 602 ms | +135 ms | 1.22x | 96 | 1 | 0 → 0 | 0 |
| **Total** | **4,673 ms** | **3,830 ms** | **+843 ms** | **1.22x** | **457** | **5** | **7 → 7** | **0** |

Aggregate observations:

- CLI command timeはdirect collection lower boundより`843 ms`、約`22%`長かった。
- 人間のpacket組み立て時間を測っていないため、end-to-endの時間短縮有無は未確認。
- 必要修正は`5 / 457` nonblank lines、約`1.1%`。量は小さいが、5/5 packetで同じ対象非適合が再現した。
- target-inappropriate lineも`5 / 457`、約`1.1%`。
- 固定rubric上の不足情報は`7 → 7`で、追加質問削減は`0`。
- 主要事実一致は`5 / 5`。
- preflightは`5 / 5`で`pass`。
- local path、raw current branch、obvious GitHub-token-like valueの意図しない露出は`0 / 5`。
- untrusted-content boundaryは`5 / 5`で存在した。

## 評価

### 確認できた価値

1. handoff、triage、reviewを同じ15-section packetへ安定して正規化した。
2. 主要metadataは5件すべてでdirect sourceと一致した。
3. untrusted-content boundaryとbest-effort preflightを毎回表示した。
4. raw packetを保存しなくても、検証可能な集計へ落とせた。

### 確認できなかった価値

1. direct collectionだけとの比較ではCLIが速いとは言えない。
2. 固定rubric上、source factsの不足数は減らなかった。
3. downstream AIの回答品質や実際の追加質問turn数は測定していない。
4. 5件は同一public repositoryの小標本であり、一般化できない。

### 実装せずに残したfinding

- verification planの`Run npm test.`は対象repositoryに適用できず、5件すべてで修正が必要だった。
- このfindingは価値検証PRへ機能修正として混ぜない。修正する場合は、repository-specific verification commandをどう取得・表現するかを別concernで扱う。

## Decision

- CLIをprivate iterationのpacket generatorとして保持する。
- 一般公開、npm配布、release、visibility変更、外部告知へ進まない。
- この結果だけを根拠にCLI機能を増やさない。
- 次の比較を行う場合は、同じ5タスクでtemplate-only方式の作成時間、修正量、完全性を測り、CLI固有の上積みを判定する。

## Reproduction notes

- supported runtime: Node `v24.14.0`
- timing repetitions: 3 per path after 1 warm-up
- CLI commands: one `handoff`, two `triage`, two `review`
- source access: read-only local `git` and authenticated read-only `gh`
- GitHub write、外部LLM API、package/release操作は使用していない
