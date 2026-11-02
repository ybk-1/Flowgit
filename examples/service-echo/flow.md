---
format: flowgit
version: "0.1"
id: service-echo
inputs:
  topic:
    type: string
    description: 交给服务的题目 / Topic sent to the service
    required: true
---

# 服务回声

把一段笔记交给一个 HTTP 服务，拿回 JSON。演示 service 执行器：POST、请求头里的环境变量、超时。 / Send a note to an HTTP service and keep the JSON it returns. Shows the service executor: POST, an env var in a header, and a timeout.

## 笔记 {#note}

人先写一段笔记。 / A person writes a short note first.

```flowgit
executor:
  type: human
  instructions: 把要发给服务的文字写进 note.md。 / Write what you want to send in note.md.
outputs:
  - {type: text/markdown, path: note.md}
```

## 回声 {#echo}

把笔记 POST 给服务，服务应返回 JSON。把地址换成你自己的接口。 / POST the note to a service that returns JSON. Point the URL at your own API.

```flowgit
inputs: [note]
executor:
  type: service
  method: POST
  url: http://127.0.0.1:8787/echo
  headers:
    Authorization: Bearer {{env.ECHO_TOKEN}}
  timeoutSec: 30
outputs:
  - {type: application/json, path: echo.json}
```
