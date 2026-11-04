/*
 * Board language: Simplified Chinese ("zh") or English ("en"), one at a time.
 * Strings live in the two dictionaries below and go through i18next (https://www.i18next.com),
 * served from the i18next package as /vendor/i18next.js and loaded before this file.
 *
 * The first visit follows the browser language (Chinese for any zh-*, English otherwise); the
 * switch in the header stores the choice in localStorage. Elements written with I18N.text,
 * I18N.raw or I18N.attr carry their key (or raw text) in data attributes, so a switch re-translates
 * them in place without re-rendering; the board itself re-renders on the "change" callback.
 *
 * Messages from the server and from flow files are often bilingual ("中文 / English");
 * I18N.pick keeps the half for the current language.
 */
"use strict";

export const I18N = (() => {
  const STORE_KEY = "flowgit.board.lang";
  const LANGS = ["zh", "en"];

  const zh = {
    board: "看板",
    docTitle: "{{name}} · 看板",
    tagline: "可运行、可修改、可回看 · 本机",
    lang: { group: "语言" },
    view: { group: "视图", cards: "卡片", graph: "流程图" },
    live: { on: "实时更新", poll: "每 3 秒刷新", lost: "实时更新已断开，改为每 3 秒刷新" },
    top: {
      addStage: "新增阶段",
      preview: "预演",
      runAll: "全部运行",
      runAllHelp: "按住 1 秒直接运行，卡片上会先预演",
    },
    usage: {
      label: "模型用量合计",
      none: "用量 · 0 tokens",
      stage: "用量 · {{total}} tokens（输入 {{input}} + 输出 {{output}}，{{count}} 次）",
      total: "模型用量合计：输入 {{input}} + 输出 {{output}} tokens（{{count}} 次模型调用）",
    },
    inputs: {
      heading: "流程输入",
      save: "保存输入",
      none: "这个流程没有输入。",
      required: "必填",
      notNumber: "输入 {{name}} 必须是数字",
      missing: "还没填流程输入：{{names}}",
      missingHint: "在下面的表单里填写，或运行：{{cmd}}",
    },
    state: {
      ok: "已完成",
      stale: "需重跑（上游或配置变了）",
      edited: "已手动修改",
      error: "上次运行失败",
      "never-run": "可以运行",
      "waiting-upstream": "等上游",
      running: "运行中",
      unknown: "未知",
    },
    editNote: "下次运行这个阶段前，这次修改会存成单独的版本，不会丢失。",
    plan: {
      skip: "跳过",
      "keep-edit": "保留手动修改",
      run: "运行",
      wait: "等你",
      "cannot-run": "不能运行",
      "not-reached": "走不到",
      callsModel: "调用模型",
      together: "与 {{names}} 同时",
      header: "预演 · 不会运行",
      calls_other: "最多调用 {{count}} 次模型",
    },
    graph: { label: "流程图", loading: "加载流程图…", empty: "还没有阶段", error: "无法加载流程图", mode: "流程图样式", depth: "立体", flat: "平面" },
    editor: {
      toggle: "编辑",
      flow: "编辑流程",
      grip: "拖动以移动，位置只记在这台浏览器里",
      name: "名称",
      type: "执行器",
      model: "模型",
      modelDefault: "默认（claude-opus-5-5）",
      promptPath: "提示词文件",
      prompt: "提示词",
      promptHint: "输入 {{ 补全 {{inputs.名称}}。上游产物会自动附在提示词后面。",
      command: "命令",
      timeout: "超时（秒）",
      timeoutHint: "空着表示不限时。",
      retries: "重试次数",
      retriesHint: "只对网络错误、429 和 5xx 重试。空着表示不重试。",
      outputs: "产物",
      outputType: "类型",
      outputPath: "路径",
      addOutput: "添加产物",
      removeRow: "删除",
      agent: "智能体",
      agentCommand: "自定义命令",
      args: "额外参数",
      argsHint: "一行一个。",
      instructions: "给人的说明",
      save: "保存",
      flowName: "流程名称",
      description: "说明",
      concurrency: "同时运行",
      concurrencyHint: "空着就是默认 2。",
      inputs: "流程输入定义",
      addInput: "添加输入",
      inputName: "名字",
      inputType: "类型",
      inputEnum: "enum（逗号分开）",
      inputDefault: "默认值",
      inputDescription: "说明",
      inputRequired: "必填",
      human: "人工",
      llm: "模型",
      script: "脚本",
      agentType: "智能体",
    },
    stage: {
      back: "返回阶段",
      noRuns: "还没有版本",
      restored: "v{{n}} · 已回退（最新是 v{{latest}}）",
      history: "历史",
      run: "运行这一步",
      waiting: "等上游完成",
      remove: "删除阶段",
      executor: "执行 · {{name}}",
      runs_other: "{{count}} 个版本",
      outputs: "产物",
      model: "模型（可选）",
      menu: "菜单 · {{id}}",
    },
    thumb: {
      open: "打开产物",
      video: "视频",
      empty: "空文件",
      noPreview: "无法预览",
      notYet: "还没有这个产物",
      files_other: "共 {{count}} 个文件",
      items_other: "{{count}} 项",
      seconds: "{{n}} 秒",
      lengthUnknown: "时长未知",
      more: "展开",
      less: "收起",
    },
    run: {
      modelsDiffer: "各阶段填的模型不一样。全部运行请留空，或填成同一个。",
      busy: "已有运行在进行",
      previewError: "无法预演",
      confirm_other: "这次最多调用 {{count}} 次模型，继续吗？",
      all: "全部运行",
      one: "运行 {{stage}}",
      failed: "运行失败",
      finished: "运行结束",
      skipped: "{{name}} 跳过：{{reason}}",
      waiting: "「{{name}}」在等你：{{missing}}",
      released: "✗ 松手了（{{pct}}%），什么都没运行",
    },
    trust: {
      changed: "这个流程要运行的命令和你上次确认的不一样了，现在是：",
      copied: "这个流程是从 {{source}} 复制来的，会在你的电脑上做这些事：",
      ask: "确认后运行吗？命令不变就不会再问。",
      declined: "没有确认，什么都没运行",
      failed: "确认失败",
    },
    panel: { close: "关闭", back: "返回", backToHistory: "返回历史", loading: "加载中…" },
    withStatus: "{{msg}}（{{status}}）",
    history: {
      title: "{{name}} · 历史",
      openError: "无法打开历史",
      hint: "拖、甩或用 ← → 翻版本；最前面那张可以看产物、和当前文件对比或回退。",
      compareHint: "对比任意两个版本",
      versions: "版本",
      manual: "手动修改",
      byHand: "手改",
      ok: "成功",
      error: "失败",
      head: "v{{n}} · {{result}} · {{time}} · {{who}}",
      headCurrent: "v{{n}} · {{result}} · {{time}} · {{who}} · 当前",
      now: "当前",
      isCurrent: "现在的文件就是这一版，不用回退。",
      errorLine: "错误：{{msg}}",
      open: "看这个版本的产物",
      compare: "和当前文件对比",
      restore: "回退到这个版本",
      noOutputs: "这个阶段没有产物",
    },
    compare: {
      a: "版本 A",
      b: "版本 B",
      current: "当前文件",
      go: "对比",
      pickFirst: "先选一个版本",
      pickDifferent: "选两个不同的版本，或一个版本和当前文件。",
    },
    diff: {
      title: "{{name}} · 对比",
      error: "无法对比",
      noOutputs: "没有产物",
      same: "相同",
      binarySame: "二进制相同",
      binaryDiffers: "二进制不同",
      dirSame: "文件夹相同",
      added: "新增",
      removed: "删除",
      changed: "改动",
      cannotShow: "无法显示这个差异",
    },
    restore: {
      confirm: "确定回退到 v{{n}}？当前产物会被这个版本替换，下游阶段会变成需重跑。",
      failed: "没有回退",
      done: "已回退到 v{{n}}",
      doneKept: "已回退到 v{{n}} · 你的手动修改已存为 v{{kept}}",
    },
    file: {
      openError: "无法打开",
      notFound: "找不到这个产物",
      save: "保存",
      saved: "已保存",
      notSaved: "没有保存",
      empty: "空文件夹",
      upload: "上传文件",
      uploading: "上传中…",
      notUploaded: "没有上传",
    },
    refreshError: "无法刷新看板",
    add: {
      title: "新增阶段",
      type: "类型",
      human: "人工",
      llm: "模型",
      script: "脚本",
      agent: "智能体",
      name: "名称",
      after: "插在哪个阶段后面",
      atEnd: "加在最后",
      upstream: "上游阶段",
      upstreamHelp: "不选就用它前面那个阶段。",
      outputs: "产物",
      outputsHelp: "一行一个路径。不填就用默认产物。",
      outputsHelpScript: "script 阶段必须写产物路径和命令。一行一个路径。",
      prompt: "提示词",
      command: "命令",
      cancel: "取消",
      save: "添加",
      notAdded: "没有添加",
    },
    generate: {
      heading: "用一句话生成流程",
      hint: "先给出预演和文件列表，确认后才写入。已有流程不会被覆盖；要写到新文件夹，填文件夹名。",
      description: "描述",
      placeholder: "例如：把一周的笔记整理成周报",
      folder: "文件夹",
      folderPlaceholder: "留空则写在当前目录",
      language: "语言",
      languageAuto: "跟着描述",
      model: "模型（可选）",
      md: "写成 flow.md",
      preview: "生成预演",
      working: "正在生成…",
      dryRun: "预演 · 还没写文件",
      files: "要写入的文件",
      runsCommands: "会在你的电脑上运行命令",
      write: "确认写入",
      cancel: "取消",
      wrote: "已写入",
      failed: "没有生成",
      exists: "这里已经有流程，没有覆盖。换一个文件夹再生成。",
    },
    remove: {
      title: "删除阶段",
      text: "删除阶段「{{label}}」（{{id}}）？产物和 runs/ 都会留下。",
      cancel: "取消",
      confirm: "删除",
      force: "一起断开依赖",
      deps: "这些阶段还把「{{id}}」当作输入：{{names}}",
      depsUnknown: "还有阶段依赖它",
      notRemoved: "没有删除",
    },
    timeline: {
      reexport: "重新导出",
      undo: "撤销",
      redo: "重做",
      play: "播放",
      pause: "暂停",
      zoom: "缩放",
      snap: "吸附配音",
      noVoice: "没有配音可吸附",
      exportStale: "导出需要重跑",
      hint: "Tab 选镜头，← → 移动，[ ] 改时长，空格播放。点镜头之间的缝隙换转场",
      styleLabel: "字幕样式",
      styleName: { classic: "经典", bold: "加粗", outline: "描边", soft: "柔和", lower: "底部" },
      gap: "切换转场",
      trans: { cut: "硬切", fade: "淡化", slide: "滑动", zoom: "缩放" },
      volume: "背景音乐音量",
      noSafe: "这个平台没有公布安全区",
      picture: "画面",
      caption: "字幕",
      voice: "配音",
      music: "背景音乐",
      assets: "换成素材",
      assetsEmpty: "assets/ 里还没有图片或视频",
      card: "文字卡",
      empty: "没有镜头",
      playhead: "播放头",
      bad: "时间线不是合法的 JSON",
    },
    storyboard: {
      line: "台词",
      duration: "时长",
      uploaded: "已上传",
      missing: "未上传",
      asset: "素材",
      empty: "没有镜头",
      visual: "画面",
    },
    desktop: {
      title: "不用命令行的 Flowgit",
      tagline: "打开文件夹，或从模板新建一个流程。",
      recent: "最近打开",
      recentEmpty: "还没有打开过流程。",
      open: "打开文件夹",
      create: "从模板新建",
      doctor: "这台电脑",
      doctorEmpty: "正在检查…",
      opening: "正在打开…",
      creating: "正在创建…",
      failed: "没有完成",
      lang: "语言",
    },
  };

  const en = {
    board: "Board",
    docTitle: "{{name}} · Board",
    tagline: "Run, edit and browse history · local",
    lang: { group: "Language" },
    view: { group: "View", cards: "Cards", graph: "Graph" },
    live: { on: "Live updates", poll: "Refreshes every 3s", lost: "Live updates lost, refreshing every 3 seconds" },
    top: {
      addStage: "Add stage",
      preview: "Preview",
      runAll: "Run all",
      runAllHelp: "Hold 1s to run; the cards preview it first",
    },
    usage: {
      label: "Total model usage",
      none: "Usage · 0 tokens",
      stage_one: "Usage · {{total}} tokens ({{input}} in + {{output}} out, 1 call)",
      stage_other: "Usage · {{total}} tokens ({{input}} in + {{output}} out, {{count}} calls)",
      total_one: "Total model usage: {{input}} in + {{output}} out tokens (1 model call)",
      total_other: "Total model usage: {{input}} in + {{output}} out tokens ({{count}} model calls)",
    },
    inputs: {
      heading: "Flow inputs",
      save: "Save inputs",
      none: "This flow has no inputs.",
      required: "required",
      notNumber: "Input \"{{name}}\" must be a number",
      missing: "Flow inputs not set: {{names}}",
      missingHint: "Fill them in below, or run: {{cmd}}",
    },
    state: {
      ok: "Done",
      stale: "Needs a re-run (upstream or config changed)",
      edited: "Edited by hand",
      error: "Last run failed",
      "never-run": "Ready to run",
      "waiting-upstream": "Waiting for upstream",
      running: "Running",
      unknown: "Unknown",
    },
    editNote: "Before this stage next runs, the edit is saved as its own version and is not lost.",
    plan: {
      skip: "Skipped",
      "keep-edit": "Keep your edit",
      run: "Run",
      wait: "Waits for you",
      "cannot-run": "Cannot run",
      "not-reached": "Not reached",
      callsModel: "calls a model",
      together: "together with {{names}}",
      header: "Preview · runs nothing",
      calls_one: "At most 1 model call",
      calls_other: "At most {{count}} model calls",
    },
    graph: { label: "Graph", loading: "Loading graph…", empty: "No stages yet", error: "Could not load the graph", mode: "Graph style", depth: "3D", flat: "Flat" },
    editor: {
      toggle: "Edit",
      flow: "Edit flow",
      grip: "Drag to move. The position stays in this browser only",
      name: "Name",
      type: "Executor",
      model: "Model",
      modelDefault: "Default (claude-opus-5-5)",
      promptPath: "Prompt file",
      prompt: "Prompt",
      promptHint: "Type {{ to insert {{inputs.name}}. Upstream outputs are appended automatically.",
      command: "Command",
      timeout: "Timeout (seconds)",
      timeoutHint: "Empty means no limit.",
      retries: "Retries",
      retriesHint: "Only network errors, 429 and 5xx. Empty means no retries.",
      outputs: "Outputs",
      outputType: "Type",
      outputPath: "Path",
      addOutput: "Add output",
      removeRow: "Remove",
      agent: "Agent",
      agentCommand: "Custom command",
      args: "Extra arguments",
      argsHint: "One per line.",
      instructions: "Instructions",
      save: "Save",
      flowName: "Flow name",
      description: "Description",
      concurrency: "At once",
      concurrencyHint: "Empty means the default of 2.",
      inputs: "Flow input definitions",
      addInput: "Add input",
      inputName: "Name",
      inputType: "Type",
      inputEnum: "enum (comma-separated)",
      inputDefault: "Default",
      inputDescription: "Description",
      inputRequired: "Required",
      human: "Human",
      llm: "Model",
      script: "Script",
      agentType: "Agent",
    },
    stage: {
      back: "Back to stage",
      noRuns: "No runs yet",
      restored: "v{{n}} · restored (latest is v{{latest}})",
      history: "History",
      run: "Run",
      waiting: "Waiting for upstream",
      remove: "Remove stage",
      executor: "Executor · {{name}}",
      runs_one: "1 run",
      runs_other: "{{count}} runs",
      outputs: "Outputs",
      model: "Model (optional)",
      menu: "Menu · {{id}}",
    },
    thumb: {
      open: "open output",
      video: "video",
      empty: "empty",
      noPreview: "no preview",
      notYet: "not yet",
      files_one: "1 file",
      files_other: "{{count}} files",
      items_one: "1 item",
      items_other: "{{count}} items",
      seconds: "{{n}} s",
      lengthUnknown: "length unknown",
      more: "more",
      less: "less",
    },
    run: {
      modelsDiffer: "Model fields differ. For run all, leave them blank or use the same one.",
      busy: "A run is already in progress",
      previewError: "Could not preview",
      confirm_one: "This run makes at most 1 model call. Continue?",
      confirm_other: "This run makes at most {{count}} model calls. Continue?",
      all: "Run all",
      one: "Run {{stage}}",
      failed: "Run failed",
      finished: "Run finished",
      skipped: "{{name}} skipped: {{reason}}",
      waiting: "\"{{name}}\" is waiting for you: {{missing}}",
      released: "✗ Released at {{pct}}%, nothing ran",
    },
    trust: {
      changed: "This flow's commands changed since you confirmed them. Now it does:",
      copied: "This flow was copied from {{source}} and does this on your computer:",
      ask: "Confirm and run? You won't be asked again unless the commands change.",
      declined: "Not confirmed; nothing ran",
      failed: "Could not confirm",
    },
    panel: { close: "Close", back: "Back", backToHistory: "Back to history", loading: "Loading…" },
    withStatus: "{{msg}} ({{status}})",
    history: {
      title: "{{name}} · History",
      openError: "Could not open history",
      hint: "Drag, flick or use ← → to flip through versions; open, compare or restore the one in front.",
      compareHint: "Compare any two versions",
      versions: "Versions",
      manual: "Manual edit",
      byHand: "By hand",
      ok: "OK",
      error: "Error",
      head: "v{{n}} · {{result}} · {{time}} · {{who}}",
      headCurrent: "v{{n}} · {{result}} · {{time}} · {{who}} · current",
      now: "current",
      isCurrent: "The current files are this version, so there is nothing to restore.",
      errorLine: "Error: {{msg}}",
      open: "Open its outputs",
      compare: "Compare with current",
      restore: "Restore this version",
      noOutputs: "This stage has no outputs",
    },
    compare: {
      a: "Version A",
      b: "Version B",
      current: "Current files",
      go: "Compare",
      pickFirst: "Pick a version first",
      pickDifferent: "Pick two different versions, or one version and the current files.",
    },
    diff: {
      title: "{{name}} · Compare",
      error: "Could not compare",
      noOutputs: "No outputs",
      same: "Same",
      binarySame: "Binary, same",
      binaryDiffers: "Binary, differs",
      dirSame: "Folder is the same",
      added: "Added",
      removed: "Removed",
      changed: "Changed",
      cannotShow: "Could not show this diff",
    },
    restore: {
      confirm: "Restore v{{n}}? Current outputs will be replaced by this version, and downstream stages will show as stale.",
      failed: "Not restored",
      done: "Restored v{{n}}",
      doneKept: "Restored v{{n}} · your manual edit was saved as v{{kept}}",
    },
    file: {
      openError: "Could not open",
      notFound: "Output not found",
      save: "Save",
      saved: "Saved",
      notSaved: "Not saved",
      empty: "Empty folder",
      upload: "Upload a file",
      uploading: "Uploading…",
      notUploaded: "Not uploaded",
    },
    refreshError: "Could not refresh the board",
    add: {
      title: "Add stage",
      type: "Type",
      human: "Human",
      llm: "Model (LLM)",
      script: "Script",
      agent: "Agent",
      name: "Name",
      after: "After",
      atEnd: "At the end",
      upstream: "Upstream stages",
      upstreamHelp: "Leave this empty to use the stage before it.",
      outputs: "Outputs",
      outputsHelp: "One path per line. Leave empty for the default output.",
      outputsHelpScript: "A script stage needs an output path and a command. One path per line.",
      prompt: "Prompt",
      command: "Command",
      cancel: "Cancel",
      save: "Add",
      notAdded: "Not added",
    },
    generate: {
      heading: "Generate a flow from one sentence",
      hint: "Shows a dry run and the file list first, and writes only after you confirm. An existing flow is left as it is; type a folder name to write somewhere new.",
      description: "Description",
      placeholder: "For example: turn a week of notes into a report",
      folder: "Folder",
      folderPlaceholder: "Leave empty to write here",
      language: "Language",
      languageAuto: "Follow the description",
      model: "Model (optional)",
      md: "Write flow.md",
      preview: "Preview",
      working: "Generating…",
      dryRun: "Dry run · nothing written yet",
      files: "Files to write",
      runsCommands: "Runs commands on your computer",
      write: "Write these files",
      cancel: "Cancel",
      wrote: "Wrote the files",
      failed: "Could not generate",
      exists: "This folder already has a flow, so nothing was overwritten. Generate into another folder.",
    },
    remove: {
      title: "Remove stage",
      text: "Remove stage \"{{label}}\" ({{id}})? Its outputs and runs/ stay.",
      cancel: "Cancel",
      confirm: "Remove",
      force: "Detach downstream",
      deps: "These stages still use \"{{id}}\" as an input: {{names}}",
      depsUnknown: "Other stages still depend on it",
      notRemoved: "Not removed",
    },
    timeline: {
      reexport: "Re-export",
      undo: "Undo",
      redo: "Redo",
      play: "Play",
      pause: "Pause",
      zoom: "Zoom",
      snap: "Snap to voice",
      noVoice: "No voiceover to snap to",
      exportStale: "Export needs a re-run",
      hint: "Tab selects a shot, ← → moves it, [ ] changes length, Space plays. Click the gap between shots to change the transition",
      styleLabel: "Caption style",
      styleName: { classic: "Classic", bold: "Bold", outline: "Outline", soft: "Soft", lower: "Lower" },
      gap: "Change transition",
      trans: { cut: "Cut", fade: "Fade", slide: "Slide", zoom: "Zoom" },
      volume: "Music volume",
      noSafe: "This platform publishes no safe area",
      picture: "Picture",
      caption: "Captions",
      voice: "Voice",
      music: "Music",
      assets: "Swap asset",
      assetsEmpty: "No image or video in assets/ yet",
      card: "Text card",
      empty: "No shots",
      playhead: "Playhead",
      bad: "Timeline is not valid JSON",
    },
    storyboard: {
      line: "Line",
      duration: "Length",
      uploaded: "Uploaded",
      missing: "Not uploaded",
      asset: "Asset",
      empty: "No shots",
      visual: "Visual",
    },
    desktop: {
      title: "Flowgit without the command line",
      tagline: "Open a folder, or start a flow from a template.",
      recent: "Recent",
      recentEmpty: "No flows opened yet.",
      open: "Open a folder",
      create: "New from a template",
      doctor: "This computer",
      doctorEmpty: "Checking…",
      opening: "Opening…",
      creating: "Creating…",
      failed: "That didn't finish",
      lang: "Language",
    },
  };

  /** Storage can throw in private mode; the choice then lasts for this visit only. */
  function stored() {
    try {
      const value = window.localStorage.getItem(STORE_KEY);
      return LANGS.includes(value) ? value : "";
    } catch {
      return "";
    }
  }

  function store(value) {
    try {
      window.localStorage.setItem(STORE_KEY, value);
    } catch {
      // private mode or blocked storage
    }
  }

  /** Chinese for any zh-* browser language, English for the rest. */
  function fromBrowser() {
    const list = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    const first = String(list[0] || "").toLowerCase();
    if (!first) return "zh";
    return first === "zh" || first.startsWith("zh-") ? "zh" : "en";
  }

  const engine = globalThis.i18next.createInstance();
  engine.init({
    lng: stored() || fromBrowser(),
    fallbackLng: "zh",
    supportedLngs: LANGS,
    resources: { zh: { translation: zh }, en: { translation: en } },
    interpolation: { escapeValue: false }, // text goes into textContent, never innerHTML
    initAsync: false,
    returnNull: false,
  });

  const listeners = [];
  const HAN = /[㐀-鿿豈-﫿]/;
  const LATIN = /[A-Za-z]/;

  function lang() {
    return engine.language === "en" ? "en" : "zh";
  }

  /**
   * Keeps one half of a bilingual line "中文 / English": the first "/ " whose left side has
   * Chinese and whose right side has Latin letters and no Chinese. Other lines come back as they are.
   */
  function pickLine(line, which) {
    let from = 0;
    for (;;) {
      const at = line.indexOf("/ ", from);
      if (at < 0) return line;
      const before = at === 0 ? "" : line[at - 1];
      if (at > 0 && (before === " " || HAN.test(before) || /[。？！，；：）」]/.test(before))) {
        const left = line.slice(0, at).trimEnd();
        const right = line.slice(at + 2).trim();
        if (HAN.test(left) && LATIN.test(right) && !HAN.test(right)) return which === "en" ? right : left;
      }
      from = at + 2;
    }
  }

  function pick(text, which = lang()) {
    if (text == null) return "";
    return String(text)
      .split("\n")
      .map((line) => pickLine(line, which))
      .join("\n");
  }

  /** A value may be a string, a number, { key, vars } to translate, or { raw } to pick. */
  function value(item) {
    if (item && typeof item === "object") {
      if (typeof item.key === "string") return t(item.key, item.vars);
      if ("raw" in item) return pick(item.raw);
    }
    return item;
  }

  function t(key, vars) {
    const options = {};
    for (const [name, item] of Object.entries(vars || {})) options[name] = value(item);
    return engine.t(key, options);
  }

  function clearMarks(node) {
    delete node.dataset.i18n;
    delete node.dataset.i18nVars;
    delete node.dataset.i18nRaw;
  }

  /** Writes a translated string and remembers its key, so a language switch updates it. */
  function text(node, key, vars) {
    clearMarks(node);
    node.dataset.i18n = key;
    if (vars) node.dataset.i18nVars = JSON.stringify(vars);
    node.textContent = t(key, vars);
    return node;
  }

  /** Writes text that may be bilingual ("中文 / English"), keeping the current language's half. */
  function raw(node, source) {
    clearMarks(node);
    node.dataset.i18nRaw = String(source ?? "");
    node.textContent = pick(source);
    return node;
  }

  /** Sets a translated attribute (aria-label, title, placeholder) and remembers its key. */
  function attr(node, name, key, vars) {
    let marks = {};
    try {
      marks = JSON.parse(node.dataset.i18nAttr || "{}");
    } catch {
      marks = {};
    }
    marks[name] = vars ? [key, vars] : [key];
    node.dataset.i18nAttr = JSON.stringify(marks);
    node.setAttribute(name, t(key, vars));
    return node;
  }

  function readVars(node) {
    if (!node.dataset.i18nVars) return undefined;
    try {
      return JSON.parse(node.dataset.i18nVars);
    } catch {
      return undefined;
    }
  }

  /** Re-translates every marked element under root (the root included). */
  function apply(root = document) {
    const scope = root === document ? document.documentElement : root;
    const all = (selector) => {
      const found = [...scope.querySelectorAll(selector)];
      if (scope.matches && scope.matches(selector)) found.unshift(scope);
      return found;
    };
    for (const node of all("[data-i18n]")) node.textContent = t(node.dataset.i18n, readVars(node));
    for (const node of all("[data-i18n-raw]")) node.textContent = pick(node.dataset.i18nRaw);
    for (const node of all("[data-i18n-attr]")) {
      let marks = {};
      try {
        marks = JSON.parse(node.dataset.i18nAttr || "{}");
      } catch {
        marks = {};
      }
      for (const [name, [key, vars]] of Object.entries(marks)) node.setAttribute(name, t(key, vars));
    }
    if (root === document) {
      document.documentElement.lang = lang() === "en" ? "en" : "zh-CN";
      for (const button of document.querySelectorAll("[data-lang]")) {
        button.setAttribute("aria-pressed", button.getAttribute("data-lang") === lang() ? "true" : "false");
      }
    }
  }

  function set(next) {
    if (!LANGS.includes(next) || next === lang()) return;
    engine.changeLanguage(next);
    store(next);
    apply(document);
    for (const listener of listeners) listener(next);
  }

  function onChange(listener) {
    listeners.push(listener);
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-lang]") : null;
    if (button) set(button.getAttribute("data-lang") || "");
  });
  apply(document);

  return { t, text, raw, attr, apply, pick, lang, set, onChange };
})();
