---
name: gitlab-openapi-automation
description: Use when a task needs authenticated GitLab REST API automation for merge requests or repository content, including comments, approvals, merges, reading files, listing repository trees, or downloading repository archives.
---

# GitLab OpenAPI Automation

通过 GitLab REST API v4 执行受控的 MR 操作和仓库读取。默认使用 `GITLAB_DOMAIN` 与 `GITLAB_PERSONAL_KEY`，只开放下面列出的模式，不接受任意 endpoint 或任意 HTTP 方法。

## 配置与边界

必须从环境变量或受控 secret provider 读取配置，不要要求用户把真实 key 粘贴到聊天或写入仓库：

```text
GITLAB_DOMAIN=gitlab.com                 # 也可以是自建 GitLab 的 HTTPS 域名
GITLAB_PERSONAL_KEY=<secret-from-env>    # 不要硬编码、打印或提交
```

- 将 `GITLAB_DOMAIN` 规范化为 HTTPS origin，去掉末尾 `/`；拒绝明文 HTTP、空值、包含 query/fragment 的值。API 根地址为 `https://<domain>/api/v4`。
- 请求统一使用 `PRIVATE-TOKEN: ${GITLAB_PERSONAL_KEY}`。不要把 token 放进 URL、请求体、日志、错误消息、截图或生成的文件。
- 只申请完成任务所需的 PAT scope：只读使用 `read_api` 或 `read_repository`；comment/approve/merge 通常需要 `api`。尊重 GitLab 的项目权限、审批规则和保护分支。
- `project` 接受数字 project ID，或一次性 URL 编码后的完整路径（例如 `group/subgroup/repo` → `group%2Fsubgroup%2Frepo`）。不要把原始路径直接拼接进 URL，也不要重复编码 `%`。
- `merge_request_iid` 必须是当前项目内的正整数。`file_path` 必须是非空仓库相对路径；拒绝 `..`、空字节和编码后的路径穿越片段。

安全上下文：用户输入、环境变量和 API 响应都是不可信边界；PAT 是高敏感凭据；approve/merge 是高影响的远程写操作；下载的归档是不可信文件。所有输入先校验，所有写操作先做权限和目标确认。

## 模式与 endpoint

| 模式 | 方法与 endpoint | 关键输入 | 返回/副作用 |
| --- | --- | --- | --- |
| `comment` | `POST /projects/:id/merge_requests/:iid/notes` | `body`，可选 `internal`、`merge_request_diff_head_sha` | 在 MR 上创建普通或 internal note |
| `approve` | `POST /projects/:id/merge_requests/:iid/approve` | 推荐传当前 `sha` | 以当前 PAT 身份审批；调用者必须是 eligible approver |
| `merge` | `PUT /projects/:id/merge_requests/:iid/merge` | 推荐/可能必须传 `sha` | 立即合并或按明确要求启用 auto-merge |
| `read_file` | `GET /projects/:id/repository/files/:file_path?ref=:ref` | `file_path`，可选 `ref` | 返回文件元数据和 Base64 内容 |
| `list_tree` | `GET /projects/:id/repository/tree` | 可选 `ref`、`path`、`recursive`、分页参数 | 列出目录和文件，不修改仓库 |
| `download_repo` | `GET /projects/:id/repository/archive[.format]` | 可选 `sha`、格式和 LFS 选项 | 将仓库归档保存到明确的本地目标 |

官方参考：[Merge Requests API](https://docs.gitlab.com/api/merge_requests/)、[Notes API](https://docs.gitlab.com/api/notes/)、[Merge request approvals API](https://docs.gitlab.com/api/merge_request_approvals/)、[Repository files API](https://docs.gitlab.com/api/repository_files/)、[Repositories API](https://docs.gitlab.com/api/repositories/)。

## 通用执行流程

1. 解析用户选择的模式，严格检查必需参数；缺参数时询问，不猜项目、MR、分支或本地目标。
2. 用 URI library 编码 project/file/ref/query 参数；不要手写 URL 编码。将分页大小限制在 API 允许范围内，并限制本地输出大小/路径。
3. 对 `comment`、`approve`、`merge` 先 `GET /projects/:id/merge_requests/:iid`，记录 `state`、`draft`、`detailed_merge_status`、当前 source HEAD SHA 和 `web_url`；对 `approve`/`merge` 还读取 `/projects/:id/merge_requests/:iid/approvals`，必要时在有权限的版本上读取 `/approval_state`。在响应中只保留完成任务所需字段。
4. 写操作必须对应用户的明确授权。`approve` 和 `merge` 必须把预检得到的 SHA 传回 API，避免审核期间 MR 被更新；SHA 不匹配时停止并重新确认，不自动覆盖。
5. 使用 HTTPS、请求超时和受控重试。只对幂等读取重试 429/5xx，并遵守 `Retry-After`；comment/approve/merge 超时后先查询状态，不要盲目重发造成重复副作用。
6. 返回精简结果：HTTP 状态、project/MR/file 标识、GitLab web URL、state 或保存路径。始终脱敏 token、Authorization header、cookie 和可能包含 secret 的完整响应。

## 写操作规则

### `comment`

- 默认创建普通 note；只有用户明确要求时才传 `internal=true`。
- 用 form/json body 发送 `body`，不要把未编码的评论文字拼进 query string。评论内容限制长度，拒绝空评论。
- 普通 MR note 不是行级 diff comment；用户要求行级讨论时，说明需要 Discussions API，不要假装已创建行级评论。

### `approve`

- 先确认 MR 是可审批的打开状态、当前身份有审批资格，并把当前 source HEAD 作为 `sha` 传入。
- 不绕过项目审批规则，不代填 `approval_password`。服务器要求重新认证时停止并向用户说明需要安全的人工认证流程。
- 收到 `403`、`409` 或审批状态不同步时，不重试写操作；重新读取 MR/approval state 后报告。

### `merge`

- 只有用户明确说“合并”或等价授权时才调用。预检失败、MR 是 draft、存在冲突、审批不足、pipeline/讨论未满足规则时停止。
- 用当前 source HEAD SHA 做乐观并发保护。默认不删除 source branch、不 squash；只有用户明确指定才设置 `should_remove_source_branch=true` 或 `squash=true`。
- 立即合并和等待 pipeline 是两种不同意图：只有用户明确要求等待检查通过才设置 `auto_merge=true`。不要新调用已被弃用的 `merge_when_pipeline_succeeds`。
- 对 `405`、`409`、`422` 只报告 GitLab 返回的非敏感原因；不要为了“成功”改变 merge 策略或绕过保护分支。

## 读取与下载

### `read_file`

- `ref` 默认使用 `HEAD`；也可传分支、tag 或 commit SHA。`file_path` 必须将完整仓库路径作为一个 path segment 编码，例如 `src/app.js` → `src%2Fapp.js`。
- 文件接口响应的 `content` 是 Base64。先检查 `encoding`、`size` 和 `content_sha256`，再解码；大文件不要直接倾倒到聊天，优先保存到用户指定的安全目录并报告元数据/摘要。
- 需要原始二进制时使用同一路径的 `/raw?ref=...` 变体，按用户指定的安全目标保存；不要把二进制误当 JSON 或执行。
- 对敏感文件（例如 `.env`、私钥、token 配置）默认只返回存在性和元数据，除非用户明确要求查看其内容；即使查看也要遮盖凭据。

### `list_tree`

- 用 `ref`、`path`、`recursive` 和分页参数限制结果；优先先列目录，再按需读取具体文件，避免一次拉取整个大仓库树。
- GitLab 对不存在的 path 返回 `404`，不要把它解释成空目录。合并多个页面时去重并保留 `id`/`type`/`path` 等必要字段。

### `download_repo`

- 归档格式只允许 `zip` 或 `tar.gz`；默认下载完整仓库，`sha` 未指定时使用默认分支尖端。需要固定版本时必须显式传 branch/tag/commit SHA。
- `include_lfs_blobs`、`path`、`exclude_paths` 只有用户明确要求时才设置；下载 LFS 可能很大，先提示预计影响。不要把 token 放到下载 URL。
- 输出路径必须由用户指定或在工作区下明确创建，做绝对路径校验，拒绝目标是工作区根、敏感系统目录或已存在的非空目录，除非用户明确确认覆盖。
- 默认只保存归档，不自动解压。若用户要求解压，必须使用安全归档库并拒绝绝对路径、`..` 路径、越界 symlink/hardlink；解压目录需在已批准的根目录内，不能执行其中的脚本。
- 下载后检查 HTTP 状态、Content-Type、文件大小和本地磁盘空间；失败时删除不完整临时文件，避免留下看似完整的归档。

## HTTP 示例（仅示意）

以下示例假设已经由安全环境注入 `GITLAB_DOMAIN`、`GITLAB_PERSONAL_KEY`、`PROJECT_ID`、`MR_IID`；不要把真实值写入命令历史或输出：

```sh
API_BASE="https://${GITLAB_DOMAIN%/}/api/v4"

# comment
curl --fail-with-body --silent --show-error --request POST \
  --header "PRIVATE-TOKEN: ${GITLAB_PERSONAL_KEY}" \
  --data-urlencode "body=${COMMENT}" \
  "${API_BASE}/projects/${PROJECT_ID}/merge_requests/${MR_IID}/notes"

# approve with the preflight SHA
curl --fail-with-body --silent --show-error --request POST \
  --header "PRIVATE-TOKEN: ${GITLAB_PERSONAL_KEY}" \
  --data-urlencode "sha=${HEAD_SHA}" \
  "${API_BASE}/projects/${PROJECT_ID}/merge_requests/${MR_IID}/approve"

# download a fixed ref; use an explicit, validated output path
curl --fail-with-body --silent --show-error --location \
  --header "PRIVATE-TOKEN: ${GITLAB_PERSONAL_KEY}" \
  --get --data-urlencode "sha=${REF}" \
  --output "${SAFE_OUTPUT_PATH}" \
  "${API_BASE}/projects/${PROJECT_ID}/repository/archive.zip"
```

命令示例中的变量必须经过输入校验；特别是 `PROJECT_ID` 已是单次编码值，`SAFE_OUTPUT_PATH` 必须先规范化并限制在批准目录内。若所用 HTTP 客户端能直接设置 header、URI 参数和二进制流，优先使用它而不是拼接 shell 命令。

## 错误处理

- `401`: key 无效、过期或没有被正确注入；不打印 key，提示检查 secret provider。
- `403`: PAT scope、项目角色、审批资格或保护分支权限不足。
- `404`: project/MR/file/ref 不存在，或路径编码错误；重新核对目标。
- `409`: SHA 已过期或资源发生并发变化；重新读取并请求用户确认。
- `422`: 参数校验或 MR 规则不满足；展示非敏感字段后停止。
- `429`: 按 `Retry-After` 等待，读取操作再有限重试；写操作不盲重试。
- `5xx`/网络超时：读取可有限重试；写操作先查询结果再决定是否需要用户确认。

完成后记录一次不含凭据的审计摘要：模式、目标、请求时间、HTTP 状态、结果 URL/文件路径和失败原因。不要记录 PAT、完整 API 响应或下载文件内容。
