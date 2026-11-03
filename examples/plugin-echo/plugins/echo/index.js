// Prefix upstream text and write this stage's output.
// A plugin must not import Flowgit internals. It only uses the ctx argument.
export default {
  flowgitPlugin: 1,
  name: "echo",
  executor: {
    async run(ctx) {
      const prefix = typeof ctx.config.prefix === "string" ? ctx.config.prefix : "";
      const text = ctx.upstream.paths.map((rel) => ctx.upstream.read(rel)).join("\n");
      const output = ctx.stage.outputs[0];
      if (!output) throw new Error("echo 需要一个产物 / echo needs one output");
      ctx.log(`加上前缀 / prefixing ${ctx.upstream.paths.length} file(s)`);
      ctx.writeOutput(output.path, `${prefix}${text}`);
    },
  },
};
