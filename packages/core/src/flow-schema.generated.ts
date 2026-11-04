// Generated from schema/flow.schema.json by scripts/gen-schema.mjs. Do not edit.
export const flowSchemaJson: Record<string, unknown> = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://flowgit.dev/schema/flow/0.1.json",
  "title": "Flowgit flow.json (v0.1)",
  "description": "A flow is an ordered set of stages. Each stage declares what it reads (inputs), what it produces (outputs) and who runs it (executor). Every run of a stage is recorded as a version under runs/<stage>/<n>/.",
  "type": "object",
  "required": [
    "format",
    "version",
    "name",
    "stages"
  ],
  "additionalProperties": false,
  "properties": {
    "format": {
      "const": "flowgit",
      "description": "Always \"flowgit\"."
    },
    "version": {
      "type": "string",
      "pattern": "^0\\.1(\\.[0-9]+)?$",
      "description": "Spec version this file follows."
    },
    "id": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]{0,63}$",
      "description": "Optional stable slug (lowercase letters, digits, hyphens). Used as the exported skill name and, later, the gallery URL."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "description": "Human-readable flow name."
    },
    "description": {
      "type": "string"
    },
    "language": {
      "type": "string",
      "description": "Primary language of prompts and docs, e.g. \"zh\" or \"en\". Defaults to \"zh\"."
    },
    "author": {
      "type": "object",
      "required": [
        "name"
      ],
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": "string"
        },
        "url": {
          "type": "string"
        }
      }
    },
    "license": {
      "type": "string",
      "description": "SPDX identifier for the flow itself (prompts, scripts). Artifacts may carry their own licenses."
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "forkedFrom": {
      "type": "object",
      "description": "Where this flow was copied from, when init cloned a Git URL. Not set for a local directory, so a path that may contain a user name is never stored.",
      "additionalProperties": false,
      "required": [
        "source"
      ],
      "properties": {
        "source": {
          "type": "string",
          "minLength": 1,
          "description": "The Git URL that was cloned, or dify:<filename> / n8n:<filename> when flowgit import created the flow (file name only, never a local path)."
        },
        "ref": {
          "type": "string",
          "minLength": 1,
          "description": "Branch or tag, when --ref was passed."
        },
        "commit": {
          "type": "string",
          "minLength": 1,
          "description": "Commit that was cloned (git rev-parse HEAD)."
        }
      }
    },
    "inputs": {
      "type": "object",
      "description": "Flow-level parameters the user fills in once (e.g. topic). Values live in flowgit.local.json or are passed with --input key=value.",
      "additionalProperties": {
        "$ref": "#/$defs/flowInput"
      }
    },
    "mcpServers": {
      "type": "object",
      "description": "Named MCP servers, shaped like Claude Desktop and Cursor. A stdio server has command, args and env; a remote server has url (Streamable HTTP). Every env value must be ${VAR}, read from the environment at run time. A literal secret is rejected.",
      "additionalProperties": {
        "$ref": "#/$defs/mcpServer"
      }
    },
    "concurrency": {
      "type": "integer",
      "minimum": 1,
      "description": "How many stages `run all` may run at once. Stages with no dependency between them share a wave, up to this many. Default 2. `flowgit run all --concurrency` overrides it."
    },
    "stages": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/stage"
      }
    }
  },
  "$defs": {
    "flowInput": {
      "type": "object",
      "required": [
        "type"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "enum": [
            "string",
            "text",
            "number",
            "boolean",
            "file"
          ]
        },
        "description": {
          "type": "string"
        },
        "default": {},
        "required": {
          "type": "boolean",
          "default": false
        },
        "enum": {
          "type": "array",
          "minItems": 1,
          "description": "Allowed values / 允许的取值, e.g. [\"zh\", \"en\"]."
        }
      }
    },
    "stage": {
      "type": "object",
      "required": [
        "id",
        "name",
        "executor",
        "outputs"
      ],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_-]*$",
          "description": "Stable identifier, used in inputs of other stages and in runs/<id>/."
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "description": {
          "type": "string"
        },
        "inputs": {
          "type": "array",
          "description": "Ids of stages whose outputs this stage reads. They must be able to run first.",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        },
        "executor": {
          "$ref": "#/$defs/executor"
        },
        "outputs": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/output"
          }
        }
      }
    },
    "output": {
      "type": "object",
      "required": [
        "type",
        "path"
      ],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "type": {
          "type": "string",
          "description": "MIME-like type of the artifact: text/markdown, application/json, flowgit/storyboard+json, video/mp4, dir ..."
        },
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "Path relative to the flow directory. Ends with / for a directory."
        },
        "description": {
          "type": "string"
        },
        "schema": {
          "type": "string",
          "minLength": 1,
          "description": "Relative path of a JSON Schema file. Only for JSON outputs (application/json or a type ending in +json). Checked after the stage runs; an llm stage gets one automatic repair attempt."
        }
      }
    },
    "executor": {
      "type": "object",
      "required": [
        "type"
      ],
      "discriminator": {
        "propertyName": "type"
      },
      "oneOf": [
        {
          "$ref": "#/$defs/executorHuman"
        },
        {
          "$ref": "#/$defs/executorLlm"
        },
        {
          "$ref": "#/$defs/executorScript"
        },
        {
          "$ref": "#/$defs/executorAgent"
        },
        {
          "$ref": "#/$defs/executorWorkflow"
        },
        {
          "$ref": "#/$defs/executorService"
        },
        {
          "$ref": "#/$defs/executorMcp"
        },
        {
          "$ref": "#/$defs/executorPlugin"
        },
        {
          "$ref": "#/$defs/executorImage"
        }
      ]
    },
    "executorHuman": {
      "type": "object",
      "required": [
        "type"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "const": "human"
        },
        "instructions": {
          "type": "string",
          "description": "What the person should do. Shown when the stage is waiting for them."
        }
      }
    },
    "executorLlm": {
      "type": "object",
      "required": [
        "type",
        "prompt"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "const": "llm"
        },
        "prompt": {
          "type": "string",
          "description": "Path to a prompt file (Markdown). {{inputs.key}} is replaced by flow inputs; upstream artifacts are appended automatically."
        },
        "system": {
          "type": "string"
        },
        "model": {
          "type": "string",
          "description": "Model as \"<model>\" or \"<provider>/<model>\", e.g. \"glm/glm-5.3\". No prefix means the anthropic provider. Endpoints and keys are local config, never part of the flow. Defaults to the FLOWGIT_MODEL env var, then claude-opus-5-5.",
          "minLength": 1
        },
        "effort": {
          "enum": [
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ]
        },
        "maxTokens": {
          "type": "integer",
          "minimum": 256
        },
        "retries": {
          "type": "integer",
          "minimum": 0,
          "description": "Extra attempts after a network error, HTTP 429 or 5xx. Default 0. Other 4xx and schema failures are not retried. Each retry is recorded in run.json."
        }
      }
    },
    "executorScript": {
      "type": "object",
      "required": [
        "type",
        "run"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "const": "script"
        },
        "run": {
          "type": "string",
          "description": "Shell command. Runs in the flow directory with FLOWGIT_* environment variables set."
        },
        "requires": {
          "type": "array",
          "description": "Programs the command needs on PATH besides its own, e.g. [\"ffmpeg\"]. Checked before the command runs and by flowgit doctor.",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_.+-]+$"
          },
          "uniqueItems": true
        },
        "cwd": {
          "type": "string"
        },
        "env": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "timeoutSec": {
          "type": "integer",
          "minimum": 1,
          "description": "Stop the whole process tree after this many seconds. Unset means no limit."
        }
      }
    },
    "executorAgent": {
      "type": "object",
      "required": [
        "type",
        "agent",
        "prompt"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "const": "agent"
        },
        "agent": {
          "enum": [
            "claude-code",
            "codex",
            "cursor",
            "gemini",
            "custom"
          ],
          "description": "Which agent CLI to start headless in the flow directory. \"custom\" runs `command`."
        },
        "prompt": {
          "type": "string",
          "description": "Path to a prompt file (Markdown). {{inputs.key}} is replaced by flow inputs; Flowgit appends the upstream artifacts and the files the agent must write."
        },
        "command": {
          "type": "string",
          "minLength": 1,
          "description": "custom only: shell command run in the flow directory. {{promptFile}} is replaced by the rendered prompt's path; the prompt is also piped to stdin."
        },
        "args": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Extra arguments for the agent command, e.g. a model flag. Built-in adapters never pass a bypass-all-permissions flag; adding one here (e.g. Cursor's --force) is your own choice. See docs/spec.md."
        },
        "timeoutSec": {
          "type": "integer",
          "minimum": 1,
          "description": "Stop the whole process tree after this many seconds. Unset means no limit."
        }
      },
      "if": {
        "properties": {
          "agent": {
            "const": "custom"
          }
        }
      },
      "then": {
        "required": [
          "command"
        ]
      }
    },
    "executorWorkflow": {
      "type": "object",
      "description": "Run a workflow file. engine \"flowgit\" runs a Flowgit sub-flow (a flow.json). Other engines (ComfyUI, n8n, ...) are reserved; their params stay an arbitrary object.",
      "required": [
        "type",
        "engine",
        "file"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "const": "workflow"
        },
        "engine": {
          "type": "string",
          "minLength": 1
        },
        "file": {
          "type": "string",
          "minLength": 1
        },
        "params": {
          "type": "object",
          "description": "For engine flowgit: { inputs?, copy? }. inputs are passed to the sub-flow (strings may use {{inputs.key}}). copy maps a sub-flow output path to this stage's output path, and must cover every output. Other engines: any object."
        }
      },
      "allOf": [
        {
          "if": {
            "required": [
              "engine"
            ],
            "properties": {
              "engine": {
                "const": "flowgit"
              }
            }
          },
          "then": {
            "properties": {
              "params": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "inputs": {
                    "type": "object"
                  },
                  "copy": {
                    "type": "object",
                    "additionalProperties": {
                      "type": "string",
                      "minLength": 1
                    }
                  }
                }
              }
            }
          }
        }
      ]
    },
    "executorService": {
      "type": "object",
      "description": "Call an HTTP service. Header values may use {{env.NAME}}; the key is read from the environment and never written to a file.",
      "required": [
        "type",
        "url"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "const": "service"
        },
        "url": {
          "type": "string",
          "minLength": 1
        },
        "method": {
          "enum": [
            "GET",
            "POST"
          ]
        },
        "headers": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "timeoutSec": {
          "type": "integer",
          "minimum": 1,
          "description": "Abort the request after this many seconds. Default 60. Same field name as script and agent timeouts."
        },
        "retries": {
          "type": "integer",
          "minimum": 0,
          "description": "Extra attempts after a network error, HTTP 429 or 5xx. Default 0. Other 4xx and a response that is not the expected body are not retried. Each retry is recorded in run.json."
        }
      }
    },
    "mcpServer": {
      "description": "One MCP server: either a local stdio process or a Streamable HTTP endpoint.",
      "oneOf": [
        {
          "$ref": "#/$defs/mcpStdioServer"
        },
        {
          "$ref": "#/$defs/mcpHttpServer"
        }
      ]
    },
    "mcpStdioServer": {
      "type": "object",
      "description": "A local MCP server started as a child process. Same shape as Claude Desktop / Cursor stdio servers.",
      "required": [
        "command"
      ],
      "additionalProperties": false,
      "properties": {
        "command": {
          "type": "string",
          "minLength": 1,
          "description": "Program to start (looked up on PATH), e.g. npx or node."
        },
        "args": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Arguments for command."
        },
        "env": {
          "type": "object",
          "description": "Environment variables for the child. Each value must be ${VAR}; the variable is read from the environment when the stage runs and is never written to a file.",
          "additionalProperties": {
            "type": "string"
          }
        }
      }
    },
    "mcpHttpServer": {
      "type": "object",
      "description": "A remote MCP server reached over Streamable HTTP.",
      "required": [
        "url"
      ],
      "additionalProperties": false,
      "properties": {
        "url": {
          "type": "string",
          "minLength": 1,
          "description": "Streamable HTTP endpoint, http or https."
        }
      }
    },
    "executorMcp": {
      "type": "object",
      "description": "Call one tool on an MCP server named in mcpServers, and write the result to this stage's single output.",
      "required": [
        "type",
        "server",
        "tool"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "const": "mcp"
        },
        "server": {
          "type": "string",
          "minLength": 1,
          "description": "Name of an entry in mcpServers."
        },
        "tool": {
          "type": "string",
          "minLength": 1,
          "description": "Tool name on that server."
        },
        "args": {
          "type": "object",
          "description": "Arguments passed to the tool. Strings may use {{inputs.key}}, {{upstream.<stageId>}} (relative path of that stage's first output) and {{upstream.<stageId>.content}} (its text)."
        },
        "timeoutSec": {
          "type": "integer",
          "minimum": 1,
          "description": "Stop the call and kill the stdio child after this many seconds. Default 60."
        }
      }
    },
    "executorPlugin": {
      "type": "object",
      "description": "Run a plugin from the flow directory. A package name resolves only from that directory's node_modules. A ./ path must stay inside the flow directory.",
      "required": [
        "type",
        "plugin"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "const": "plugin"
        },
        "plugin": {
          "type": "string",
          "minLength": 1,
          "description": "Package name (resolved from the flow directory's node_modules only) or a ./ path inside the flow directory."
        },
        "config": {
          "type": "object",
          "description": "JSON object passed to the plugin as ctx.config. Counts toward the staleness hash."
        },
        "timeoutSec": {
          "type": "integer",
          "minimum": 1,
          "description": "Abort the plugin's signal after this many seconds and fail the run. Unset means no limit."
        }
      }
    },
    "imageEach": {
      "type": "object",
      "description": "Generate one image per item of an array inside an upstream JSON output.",
      "required": [
        "from",
        "path",
        "field"
      ],
      "additionalProperties": false,
      "properties": {
        "from": {
          "type": "string",
          "minLength": 1,
          "description": "Relative path of an upstream JSON output."
        },
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "Dotted path to the array inside that JSON, e.g. shots."
        },
        "field": {
          "type": "string",
          "minLength": 1,
          "description": "Field on each item. Its text is appended to the rendered prompt."
        }
      }
    },
    "executorImage": {
      "type": "object",
      "description": "Generate pictures into the stage's one directory output. The model is <provider>/<model>. The key is read from the provider's environment variable and never written to a file.",
      "required": [
        "type",
        "model",
        "prompt"
      ],
      "additionalProperties": false,
      "properties": {
        "type": {
          "const": "image"
        },
        "model": {
          "type": "string",
          "minLength": 1,
          "description": "Image model as <provider>/<model>, e.g. zhipu/cogview-4, openai/gpt-image-1, volcengine/doubao-seedream-5-0-pro-260628, dashscope/wan2.6-t2i."
        },
        "prompt": {
          "type": "string",
          "minLength": 1,
          "description": "Path to a prompt file (Markdown). {{inputs.key}} is replaced. With each, the item's field is appended."
        },
        "size": {
          "type": "string",
          "minLength": 1,
          "description": "Image size, e.g. 1024x1024. Default 1024x1024. DashScope is sent 1024*1024."
        },
        "n": {
          "type": "integer",
          "minimum": 1,
          "description": "How many pictures of this one prompt. Default 1. With each, omit it or set 1: one picture per array item."
        },
        "each": {
          "$ref": "#/$defs/imageEach"
        },
        "timeoutSec": {
          "type": "integer",
          "minimum": 1,
          "description": "Stop one picture, including DashScope polling, after this many seconds. Default 180."
        }
      }
    }
  }
};
