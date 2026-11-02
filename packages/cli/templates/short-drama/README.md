# 竖屏短剧剧本 / Vertical short drama

从一句梗概写出一部竖屏短剧：先定人物，再排每一集的钩子、冲突、反转和悬念，然后逐集写剧本。每一步都能改，改了人物或大纲，剧本会提示需要重跑。

Write a vertical short drama from a one-line premise: settle the characters, plan each episode's hook, conflict, twist and cliffhanger, then write the scripts. Every step can be edited; change a character or the outline and the script is marked stale.

## 阶段 / Stages

1. **人物 characters**（模型）：`characters.json`，3 到 5 个人物：身份、想要什么、藏着什么。
2. **分集大纲 outline**（模型）：`episodes.json`，正好 `episodes` 集，每集有开头钩子、冲突、反转和结尾悬念。
3. **剧本 script**（模型）：`script.md`，每集一个 `## E1`，`△` 写场景和动作，`人物名：台词` 写台词，最后一行是 `【悬念】`。
4. **检查 check**（脚本）：`check-report.md`。集数对不对、估算的每集时长（台词每秒约 4 个汉字，每行动作约 3 秒）、哪集没写悬念、哪个人物没出场。只提醒，不拦。

1. **characters** (model): `characters.json`, 3 to 5 characters: who they are, what they want, what they hide.
2. **outline** (model): `episodes.json`, exactly `episodes` episodes, each with an opening hook, conflict, twist and cliffhanger.
3. **script** (model): `script.md`, one `## E1` per episode, `△` for scene and action, `Name: line` for dialogue, and a `[Cliffhanger]` last line.
4. **check** (script): `check-report.md`. Is the episode count right, estimated length per episode (about 2.5 English words of dialogue a second, about 3 seconds per action line), episodes without a cliffhanger, characters who never appear. It warns; it does not block.

想拍成视频：把一集的剧本交给短视频模板（`flowgit init -t short-video`）当主题，或者直接按剧本拍。

Want to shoot it? Use one episode as the topic for the short-video template (`flowgit init -t short-video`), or shoot straight from the script.

## 怎么跑 / How to run

```bash
flowgit init ~/my-drama -t short-drama
cd ~/my-drama
flowgit inputs set premise=被裁员的程序员回老家开面馆，前老板来应聘
flowgit inputs set episodes=5
flowgit run all
```

没有 API key 时，用固定回复跑通。示例只写了 3 集短的，所以检查会提示集数对不上、每集偏短：

Without an API key, the canned replies run the flow. The sample has only 3 short episodes, so the check reports the count mismatch and short episodes:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```
