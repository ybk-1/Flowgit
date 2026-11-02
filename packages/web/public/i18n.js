// Board chrome strings. Stage names, output text, and other flow content stay as written.
const LANG_KEY = "flowgit.board.lang";

const MESSAGES = {
  "doc.title": { zh: "Flowgit 看板", en: "Flowgit Board" },
  "doc.boardName": { zh: "看板", en: "Board" },
  "doc.tagline": { zh: "可运行、可修改、可回看 · 本机", en: "run, edit, and browse history · local" },
  "doc.noscript": { zh: "需要 JavaScript 才能看看板。", en: "JavaScript is required to show the board." },
  "lang.group": { zh: "语言", en: "Language" },
  "view.group": { zh: "视图", en: "View" },
  "view.cards": { zh: "卡片", en: "Cards" },
  "view.graph": { zh: "流程图", en: "Graph" },
  "hint.live": { zh: "实时更新", en: "live updates" },
  "hint.poll": { zh: "每 3 秒刷新", en: "refreshes every 3s" },
  "hint.lost": { zh: "实时更新已断开，改为每 3 秒刷新", en: "live updates lost, refreshing every 3 seconds" },
  "action.addStage": { zh: "新增阶段", en: "Add stage" },
  "action.preview": { zh: "预演", en: "Preview" },
  "action.runAll": { zh: "全部运行", en: "Run all" },
  "action.saveInputs": { zh: "保存输入", en: "Save inputs" },
  "action.close": { zh: "关闭", en: "Close" },
  "action.cancel": { zh: "取消", en: "Cancel" },
  "action.add": { zh: "添加", en: "Add" },
  "action.remove": { zh: "删除", en: "Remove" },
  "action.save": { zh: "保存", en: "Save" },
  "action.history": { zh: "历史", en: "History" },
  "action.run": { zh: "运行这一步", en: "Run" },
  "action.removeStage": { zh: "删除阶段", en: "Remove stage" },
  "action.compare": { zh: "对比", en: "Compare" },
  "action.restore": { zh: "回退到这个版本", en: "Restore" },
  "action.back": { zh: "返回", en: "Back" },
  "action.backHistory": { zh: "返回历史", en: "Back to history" },
  "action.backStage": { zh: "返回阶段", en: "Back to stage" },
  "inputs.heading": { zh: "流程输入", en: "Flow inputs" },
  "inputs.none": { zh: "这个流程没有输入", en: "This flow has no inputs." },
  "input.required": { zh: "必填", en: "required" },
  "input.mustNumber": { zh: "输入 {name} 必须是数字", en: 'input "{name}" must be a number' },
  "usage.totalPlaceholder": { zh: "模型用量合计", en: "total model usage" },
  "usage.total": {
    zh: "模型用量合计：{input} 输入 + {output} 输出 tokens（{calls} 次模型调用）",
    en: "total model usage: {input} input + {output} output tokens ({calls} model calls)",
  },
  "usage.none": { zh: "用量 · 0 tokens", en: "usage · 0 tokens" },
  "usage.line": {
    zh: "用量 · {total} tokens（{input} 输入 + {output} 输出，{calls} 次）",
    en: "usage · {total} tokens ({input} input + {output} output, {calls} call(s))",
  },
  "banner.missing": { zh: "还没填流程输入：{names}", en: "flow inputs not set: {names}" },
  "banner.hint": {
    zh: "在下面的表单里填写，或：flowgit inputs set {name}=...",
    en: "Fill in the form below, or: flowgit inputs set {name}=...",
  },
  "state.ok": { zh: "已完成", en: "ok" },
  "state.stale": { zh: "需重跑（上游或配置变了）", en: "stale" },
  "state.edited": { zh: "已手动修改", en: "edited" },
  "state.error": { zh: "上次运行失败", en: "error" },
  "state.neverRun": { zh: "可以运行", en: "never-run" },
  "state.waitingUpstream": { zh: "等上游", en: "waiting-upstream" },
  "state.unknown": { zh: "未知", en: "unknown" },
  "card.executor": { zh: "执行", en: "executor" },
  "card.runs": { zh: "{n} 个版本", en: "{n} run(s)" },
  "card.noRuns": { zh: "还没有版本", en: "no runs yet" },
  "card.outputs": { zh: "产物", en: "outputs" },
  "card.menu": { zh: "菜单", en: "Menu" },
  "edit.note": {
    zh: "下次运行这个阶段前，这次修改会存成单独的版本，不会丢失。",
    en: "Before this stage next runs, the edit is saved as its own version and is not lost.",
  },
  "run.waitingTitle": { zh: "等上游完成", en: "waiting for upstream" },
  "run.busy": { zh: "已有运行在进行", en: "a run is already in progress" },
  "run.confirmCalls": {
    zh: "这次最多调用 {calls} 次模型，继续吗？",
    en: "This run makes at most {calls} model calls. Continue?",
  },
  "model.label": { zh: "模型（可选）", en: "model (optional)" },
  "model.placeholder": { zh: "provider/model", en: "provider/model" },
  "model.differ": {
    zh: "各阶段填的模型不一样。全部运行请留空，或填成同一个。",
    en: "Model fields differ. For run all, leave them blank or use the same one.",
  },
  "plan.skip": { zh: "跳过", en: "skipped" },
  "plan.keepEdit": { zh: "保留手动修改", en: "keep your edit" },
  "plan.run": { zh: "运行", en: "run" },
  "plan.wait": { zh: "等你", en: "wait for you" },
  "plan.cannotRun": { zh: "不能运行", en: "cannot run" },
  "plan.notReached": { zh: "走不到", en: "not reached" },
  "plan.header": { zh: "预演 · 不会运行", en: "Preview · runs nothing" },
  "plan.atMost": { zh: "最多调用 {n} 次模型", en: "at most {n} model calls" },
  "plan.failed": { zh: "无法预演", en: "could not preview" },
  "plan.failedStatus": { zh: "无法预演（{status}）", en: "could not preview ({status})" },
  "log.run": { zh: "运行", en: "run" },
  "log.runFailed": { zh: "运行失败", en: "run failed" },
  "log.runFailedStatus": { zh: "运行失败（{status}）", en: "run failed ({status})" },
  "log.skip": { zh: "· {name} 跳过：{reason}", en: "· {name} skipped: {reason}" },
  "log.waiting": { zh: "「{name}」在等你：{missing}", en: "{name} is waiting for you: {missing}" },
  "log.finished": { zh: "运行结束", en: "run finished" },
  "graph.aria": { zh: "流程图", en: "Graph" },
  "graph.loading": { zh: "加载流程图…", en: "loading graph…" },
  "graph.empty": { zh: "还没有阶段", en: "no stages yet" },
  "graph.loadFailed": { zh: "无法加载流程图", en: "could not load the graph" },
  "graph.loadFailedStatus": { zh: "无法加载流程图（{status}）", en: "could not load the graph ({status})" },
  "common.loading": { zh: "加载中…", en: "loading…" },
  "history.openFailed": { zh: "无法打开历史", en: "could not open history" },
  "history.openFailedStatus": { zh: "无法打开历史（{status}）", en: "could not open history ({status})" },
  "history.hint": { zh: "点一个版本看当时的产物。", en: "Click a version to see what it produced." },
  "history.pickFirst": { zh: "先选一个版本", en: "pick a version first" },
  "history.pickDifferent": {
    zh: "选两个不同的版本，或一个版本和当前文件。",
    en: "Pick two different versions, or one version and the current files.",
  },
  "history.noOutputs": { zh: "这个阶段没有产物", en: "this stage has no outputs" },
  "history.errorLine": { zh: "错误：{error}", en: "error: {error}" },
  "diff.versionA": { zh: "版本 A", en: "version A" },
  "diff.versionB": { zh: "版本 B", en: "version B" },
  "diff.current": { zh: "当前文件", en: "current" },
  "diff.failed": { zh: "无法对比", en: "could not compare" },
  "diff.failedStatus": { zh: "无法对比（{status}）", en: "could not compare ({status})" },
  "diff.same": { zh: "相同", en: "same" },
  "diff.binarySame": { zh: "二进制相同", en: "binary same" },
  "diff.binaryDiffers": { zh: "二进制不同", en: "binary differs" },
  "diff.dirSame": { zh: "文件夹相同", en: "directory same" },
  "diff.added": { zh: "新增", en: "added" },
  "diff.removed": { zh: "删除", en: "removed" },
  "diff.changed": { zh: "改动", en: "changed" },
  "diff.none": { zh: "没有产物", en: "no outputs" },
  "diff.cannotShow": { zh: "无法显示这个差异", en: "could not show this diff" },
  "runStatus.ok": { zh: "成功", en: "ok" },
  "runStatus.error": { zh: "失败", en: "error" },
  "runStatus.manual": { zh: "手动修改", en: "manual edit" },
  "restore.confirm": {
    zh: "确定回退到 v{n}？当前产物会被这个版本替换，下游阶段会变成需重跑。",
    en: "Restore v{n}? Current outputs will be replaced by this version, and downstream stages will show as stale.",
  },
  "restore.failed": { zh: "没有回退", en: "not restored" },
  "restore.failedStatus": { zh: "没有回退（{status}）", en: "not restored ({status})" },
  "restore.done": { zh: "已回退到 v{n}", en: "restored v{n}" },
  "restore.kept": { zh: "你的手动修改已存为 v{n}", en: "your manual edit was saved as v{n}" },
  "output.openFailed": { zh: "无法打开", en: "could not open" },
  "output.openFailedStatus": { zh: "无法打开（{status}）", en: "could not open ({status})" },
  "output.notFound": { zh: "找不到这个产物", en: "output not found" },
  "save.saved": { zh: "已保存", en: "saved" },
  "save.failed": { zh: "没有保存", en: "not saved" },
  "save.failedStatus": { zh: "没有保存（{status}）", en: "not saved ({status})" },
  "files.empty": { zh: "空文件夹", en: "empty folder" },
  "upload.label": { zh: "上传文件", en: "Upload a file" },
  "upload.uploading": { zh: "上传中…", en: "uploading…" },
  "upload.failed": { zh: "没有上传", en: "not uploaded" },
  "upload.failedStatus": { zh: "没有上传（{status}）", en: "not uploaded ({status})" },
  "refresh.failed": { zh: "无法刷新看板", en: "could not refresh the board" },
  "refresh.failedStatus": { zh: "无法刷新看板（{status}）", en: "could not refresh the board ({status})" },
  "thumb.open": { zh: "打开产物", en: "open output" },
  "thumb.video": { zh: "视频", en: "video" },
  "thumb.empty": { zh: "空文件", en: "empty" },
  "thumb.noPreview": { zh: "无法预览", en: "no preview" },
  "thumb.notYet": { zh: "还没有这个产物", en: "not yet" },
  "thumb.lengthUnknown": { zh: "时长未知", en: "length unknown" },
  "thumb.seconds": { zh: "{n} 秒", en: "{n} s" },
  "thumb.files": { zh: "共 {n} 个文件", en: "{n} files" },
  "thumb.filesOne": { zh: "共 {n} 个文件", en: "1 file" },
  "count.items": { zh: "{n} 项", en: "{n} items" },
  "fold.more": { zh: "展开", en: "more" },
  "fold.less": { zh: "收起", en: "less" },
  "stage.type": { zh: "类型", en: "Type" },
  "stage.type.human": { zh: "人工", en: "human" },
  "stage.type.llm": { zh: "模型", en: "llm" },
  "stage.type.script": { zh: "脚本", en: "script" },
  "stage.type.agent": { zh: "agent", en: "agent" },
  "stage.idLabel": { zh: "id", en: "id" },
  "stage.name": { zh: "名称", en: "Name" },
  "stage.after": { zh: "插在哪个阶段后面", en: "After" },
  "stage.upstream": { zh: "上游阶段", en: "Upstream stages" },
  "stage.upstreamHelp": { zh: "不选就用它前面那个阶段。", en: "Leave this empty to use the stage before it." },
  "stage.outputs": { zh: "产物", en: "Outputs" },
  "stage.outputsHint": { zh: "一行一个路径。不填就用默认产物。", en: "One path per line. Leave empty for the default output." },
  "stage.outputsHintScript": {
    zh: "script 阶段必须写产物路径和命令。一行一个路径。",
    en: "A script stage needs an output path and a command. One path per line.",
  },
  "stage.prompt": { zh: "提示词", en: "Prompt" },
  "stage.promptPlaceholder": { zh: "prompts/stage.md", en: "prompts/stage.md" },
  "stage.command": { zh: "命令", en: "Command" },
  "stage.commandPlaceholder": { zh: "node scripts/check.mjs", en: "node scripts/check.mjs" },
  "stage.agent": { zh: "Agent", en: "Agent" },
  "stage.detach": { zh: "一起断开依赖", en: "detach downstream" },
  "stage.atEnd": { zh: "加在最后", en: "at the end" },
  "stage.notAdded": { zh: "没有添加", en: "not added" },
  "stage.notAddedStatus": { zh: "没有添加（{status}）", en: "not added ({status})" },
  "stage.removeAsk": {
    zh: "删除阶段「{label}」（{id}）？产物和 runs/ 都会留下。",
    en: 'Remove stage "{label}" ({id})? Its outputs and runs/ stay.',
  },
  "stage.removeDeps": {
    zh: "这些阶段还把「{id}」当作输入：{names}",
    en: 'These stages still use "{id}" as an input: {names}',
  },
  "stage.removeDepsShort": { zh: "还有阶段依赖它", en: "other stages still depend on it" },
  "stage.notRemoved": { zh: "没有删除", en: "not removed" },
  "stage.notRemovedStatus": { zh: "没有删除（{status}）", en: "not removed ({status})" },
};

function fill(template, vars) {
  if (!vars) return template;
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
    if (vars[name] == null) return match;
    return String(vars[name]);
  });
}

function normalizeLang(value) {
  return value === "zh" || value === "en" || value === "both" ? value : null;
}

function browserLang() {
  try {
    let raw = "";
    if (typeof navigator !== "undefined" && navigator) {
      raw = navigator.language || (navigator.languages && navigator.languages[0]) || "";
    }
    return String(raw).toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function storage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredLang() {
  try {
    const store = storage();
    if (!store) return null;
    return normalizeLang(store.getItem(LANG_KEY));
  } catch {
    return null;
  }
}

function writeStoredLang(value) {
  try {
    const store = storage();
    if (!store) return;
    store.setItem(LANG_KEY, value);
  } catch {
    // Private mode or blocked storage. The choice still applies until reload.
  }
}

let lang = "en";
const langListeners = [];

function translate(key, mode, vars) {
  const entry = MESSAGES[key];
  if (!entry) return key;
  const zh = fill(entry.zh, vars);
  const en = fill(entry.en, vars);
  if (mode === "en") return en;
  if (mode === "both") return zh === en ? zh : `${zh} / ${en}`;
  return zh;
}

function t(key, vars) {
  return translate(key, lang, vars);
}

function tLang(key, mode, vars) {
  return translate(key, mode === "en" || mode === "both" || mode === "zh" ? mode : "zh", vars);
}

function currentLang() {
  return lang;
}

/** API text is already "中文 / English". Show one half, or the whole string when it does not split. */
function apiText(message) {
  if (message == null) return "";
  const text = String(message);
  const splitAt = text.indexOf(" / ");
  if (splitAt === -1) return text;
  if (lang === "zh") return text.slice(0, splitAt);
  if (lang === "en") return text.slice(splitAt + 3);
  return text;
}

function applyDocumentLang() {
  try {
    if (typeof document === "undefined" || !document.documentElement) return;
    document.documentElement.lang = lang === "en" ? "en" : "zh";
    if (document.documentElement.dataset) document.documentElement.dataset.lang = lang;
  } catch {
    // The page still renders.
  }
}

function applyStatic() {
  try {
    if (typeof document === "undefined" || !document.querySelectorAll) return;
    for (const node of document.querySelectorAll("[data-i18n]")) {
      const key = node.getAttribute("data-i18n");
      if (!key) continue;
      node.textContent = t(key);
      if (node.tagName === "TITLE") document.title = node.textContent;
    }
    for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
      const key = node.getAttribute("data-i18n-placeholder");
      if (key) node.setAttribute("placeholder", t(key));
    }
    for (const node of document.querySelectorAll("[data-i18n-aria-label]")) {
      const key = node.getAttribute("data-i18n-aria-label");
      if (key) node.setAttribute("aria-label", t(key));
    }
    for (const node of document.querySelectorAll("[data-i18n-title]")) {
      const key = node.getAttribute("data-i18n-title");
      if (key) node.setAttribute("title", t(key));
    }
  } catch {
    // The page still renders.
  }
}

function syncLangPressed() {
  try {
    if (typeof document === "undefined" || !document.querySelectorAll) return;
    for (const button of document.querySelectorAll(".lang-switch [data-lang]")) {
      button.setAttribute("aria-pressed", button.getAttribute("data-lang") === lang ? "true" : "false");
    }
  } catch {
    // The page still renders.
  }
}

function onLangChange(fn) {
  if (typeof fn === "function") langListeners.push(fn);
}

function setLang(next) {
  const normalized = normalizeLang(next);
  if (!normalized) return lang;
  if (normalized === lang) return lang;
  lang = normalized;
  writeStoredLang(lang);
  applyDocumentLang();
  syncLangPressed();
  applyStatic();
  for (const fn of langListeners.slice()) {
    try {
      fn(lang);
    } catch {
      // One listener failed. The new language still applies to the rest of the page.
    }
  }
  return lang;
}

function initLang() {
  lang = readStoredLang() || browserLang();
  applyDocumentLang();
  syncLangPressed();
  applyStatic();
}

initLang();

try {
  if (typeof document !== "undefined" && document.querySelector) {
    const group = document.querySelector(".lang-switch");
    if (group) {
      group.addEventListener("click", (event) => {
        const target = event.target;
        const button = target && target.closest ? target.closest("button[data-lang]") : null;
        if (!button) return;
        setLang(button.getAttribute("data-lang"));
      });
    }
  }
} catch {
  // The page still renders.
}

globalThis.flowgitI18n = { MESSAGES, t, tLang, apiText, setLang, currentLang, onLangChange };
globalThis.t = t;
globalThis.tLang = tLang;
globalThis.apiText = apiText;
globalThis.setLang = setLang;
globalThis.currentLang = currentLang;
globalThis.onLangChange = onLangChange;
