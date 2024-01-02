import {
  ApiPath,
  DEFAULT_API_HOST,
  DEFAULT_MODELS,
  OpenaiPath,
  REQUEST_TIMEOUT_MS,
  ServiceProvider,
} from "@/app/constant";
import {
  ChatMessage,
  ChatStat,
  useAccessStore,
  useAppConfig,
  useChatStore,
} from "@/app/store";

import { ChatOptions, getHeaders, LLMModel, LLMUsage } from "../api";
import Locale from "../../locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "@/app/utils/format";
import { getClientConfig } from "@/app/config/client";
import { makeAzurePath } from "@/app/azure";
import { Mask } from "@/app/store/mask";
import { camelizeKeys, decamelizeKeys } from "humps";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

export interface ListAssistantRequest {}

export interface ChatGPTMessageFile {
  id: string;
  object: string;
  createAt: number;
  messageId: string;
}

export interface ChatGPTRunObject {
  id: string;
  object: string;
  created_at: number;
  assistant_id: string[];
  thread_id: string;
  status: string;
  started_at: number;
  expires_at?: number;
  cancelled_at?: number;
  failed_at?: number;
  completed_at?: number;
  last_error?: string;
  model: string;
  instructions?: string;
  metadata?: {};
}

export interface ChatGPTMessageContent {
  type: string;
  imageFile?: {
    fileId: string;
  };
  text?: {
    value: string;
    annotations?: [];
  };
}

export interface ChatGPTMessage {
  id: string;
  createdAt: number;
  threadId: string;
  role: string;
  content: ChatGPTMessageContent[];
  assistantId?: string;
  runId?: string;
  fileIds?: string[];
  metadata?: {};
  preview?: boolean;
  streaming?: false;
}

export interface PageableResponse {
  firstId: string;
  lastId: string;
  hasMore: boolean;
}

export interface OpenAIListMessagesResponse extends PageableResponse {
  object: string;
  data: ChatGPTMessage[];
}

export interface ChatGPTThread extends OpenAIListMessagesResponse {
  id: string;
  topic?: string;
  object: string;
  createdAt: number;
  metaData: {};
}

export interface ChatGPTAssistant {
  id: string;
  object: string;
  createdAt: number;
  description?: string;
  model: string;
  instructions?: string;
  name: string;
  tools?: string[];
  fileIds?: string[];
  threads: ChatGPTThread[];
}

export interface ChatGPTFile {
  id: string;
  bytes: number;
  createdAt: number;
  filename: string;
  object: string;
  purpose: string;
}

export interface OpenAIListAssistantResponse extends PageableResponse {
  object: string;
  data: Array<ChatGPTAssistant>;
}

export interface ChatGPTBaseDeleteResponse {
  id: string;
  object: string;
  deleted: boolean;
}

export class ChatGPTApi {
  private disableListModels = true;

  async listFiles() {
    let finalPath = this.path(OpenaiPath.FilePath);
    console.log("listFiles:", finalPath);
    const res = await fetch(finalPath, {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const result = camelizeKeys(await res.json())["data"] as ChatGPTFile[];
      console.log("[OPENAI] listFiles|OK|:", result);
      return result;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] listFiles|FAIL|", errorInfo.message);

      throw new Error(`Error listFiles: ${errorInfo.message}`);
    }
  }

  async uploadFile(rep: { file: File; purpose: string }) {
    let finalPath = this.path(OpenaiPath.FilePath);
    console.log("uploadFile:", finalPath);
    // 创建一个 FormData 实例
    const formData = new FormData();
    // 添加文件
    formData.append("file", rep.file);
    // 添加其他表单字段
    formData.append("purpose", rep.purpose);
    const headers = getHeaders();
    delete headers["Content-Type"]; // 删除 Content-Type 属性const headers = getHeaders();

    const res = await fetch(finalPath, {
      method: "POST",
      body: formData,
      headers: {
        ...headers,
      },
    });

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const result = camelizeKeys(await res.json()) as ChatGPTFile;
      console.log("[OPENAI] uploadFile|OK|:", result);
      return result;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] uploadFile|FAIL|", res);
      throw new Error(`Error uploadFile: ${errorInfo.message}`);
    }
  }

  async deleteFile(fileId: string) {
    let finalPath = this.path(OpenaiPath.FilePath, fileId);
    console.log("deleteFile:", finalPath);
    const res = await fetch(finalPath, {
      method: "DELETE",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const result = camelizeKeys(
        await res.json(),
      ) as ChatGPTBaseDeleteResponse;
      console.log("[OPENAI] deleteFile|OK|:", result);
      return result;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] deleteFile|FAIL|", errorInfo.message);

      throw new Error(`Error deleteFile: ${errorInfo.message}`);
    }
  }

  async createAssistant(assistant: {
    name?: string;
    description?: string;
    instructions?: string;
    model: string;
    fileIds?: string[];
    tools?: { type: string }[];
  }) {
    const res = await fetch(this.path(OpenaiPath.AssistantPath), {
      method: "POST",
      body: JSON.stringify(decamelizeKeys(assistant)),
      headers: {
        ...getHeaders(),
      },
    });
    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const assist = camelizeKeys(await res.json()) as ChatGPTAssistant;
      console.log("[OPENAI] createAssistant|OK|:", assist);
      return assist;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] createAssistant|FAIL|", errorInfo.message);

      throw new Error(`Error creating new assistant: ${errorInfo.message}`);
    }
  }

  async retrieveAssistant(assistantId: string) {
    console.log("[OPENAI] retrieveAssistant|id:", assistantId);
    const res = await fetch(this.path(OpenaiPath.AssistantPath, assistantId), {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });
    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const assist = camelizeKeys(await res.json()) as ChatGPTAssistant;
      console.log("[OPENAI] retrieveAssistant|OK|:", assist);
      return assist;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] retrieveAssistant|FAIL|", errorInfo.message);
      throw new Error(`Error creating new assistant: ${errorInfo.message}`);
    }
  }

  async modifyAssistant(assistant: ChatGPTAssistant) {
    console.log("[OPENAI] modify|id:", assistant);
    const res = await fetch(this.path(OpenaiPath.AssistantPath, assistant.id), {
      method: "POST",
      body: JSON.stringify(decamelizeKeys(assistant)),
      headers: {
        ...getHeaders(),
      },
    });
    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const assist = camelizeKeys(await res.json()) as ChatGPTAssistant;
      console.log("[OPENAI] modifyAssistant|OK|:", assist);
      return assist;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] modifyAssistant|FAIL|", errorInfo.message);

      throw new Error(`Error creating new assistant: ${errorInfo.message}`);
    }
  }

  async listAssistants() {
    let finalPath = this.path(OpenaiPath.AssistantPath);
    console.log("getAssistant:", finalPath);
    const res = await fetch(finalPath, {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const result = camelizeKeys(
        await res.json(),
      ) as OpenAIListAssistantResponse;
      console.log("[OPENAI] listAssistants|OK|:", result);
      return result;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] listAssistants|FAIL|", errorInfo.message);

      throw new Error(`Error listAssistants: ${errorInfo.message}`);
    }
  }

  async deleteAssistant(assistant: ChatGPTAssistant) {
    const res = await fetch(this.path(OpenaiPath.AssistantPath, assistant.id), {
      method: "DELETE",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const result = camelizeKeys(
        await res.json(),
      ) as ChatGPTBaseDeleteResponse;
      console.log("[OPENAI] deleteAssistant|OK|:", result);
      return result;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] deleteAssistant|FAIL|", errorInfo.message);
      throw new Error(`Error deleting new thread: ${errorInfo.message}`);
    }
  }

  async createThread() {
    const res = await fetch(this.path(OpenaiPath.ThreadPath), {
      method: "POST",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const thread = camelizeKeys(await res.json()) as ChatGPTThread;
      console.log("[OPENAI] createThread|OK|:", thread);
      return thread;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] createThread|FAIL|", errorInfo.message);
      throw new Error(`Error createThread: ${errorInfo.message}`);
    }
  }

  async deleteThread(threadId: string) {
    const res = await fetch(this.path(OpenaiPath.ThreadPath, threadId), {
      method: "DELETE",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const result = camelizeKeys(
        await res.json(),
      ) as ChatGPTBaseDeleteResponse;
      console.log("[OPENAI] deleteThread|OK|:", result);
      return result;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] deleteThread|FAIL|", errorInfo.message);
      throw new Error(`Error deleteThread: ${errorInfo.message}`);
    }
  }

  async retrieveThread(threadId: string) {
    const res = await fetch(this.path(OpenaiPath.ThreadPath, threadId), {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const thread = camelizeKeys(await res.json()) as ChatGPTThread;
      console.log("[OPENAI] retrieveThread|OK|:", thread);
      return thread;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] retrieveThread|FAIL|", errorInfo.message);
      throw new Error(`Error retrieveThread: ${errorInfo.message}`);
    }
  }

  async createMessage(threadId: string, content: string) {
    let payload = {
      role: "user",
      content: content,
    };

    const res = await fetch(
      this.path(OpenaiPath.ThreadPath, threadId, "messages"),
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          ...getHeaders(),
        },
      },
    );

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const message = camelizeKeys(await res.json()) as ChatGPTMessage;
      console.log("[OPENAI] createMessage|OK|:", message);
      return message;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] createMessage|FAIL|", errorInfo.message);
      throw new Error(`Error createMessage: ${errorInfo.message}`);
    }
  }

  async retrieveMessage(threadId: string, messageId: string) {
    const res = await fetch(
      this.path(OpenaiPath.ThreadPath, threadId, "messages", messageId),
      {
        method: "GET",
        headers: {
          ...getHeaders(),
        },
      },
    );

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const message = camelizeKeys(await res.json()) as ChatGPTMessage;
      console.log("[OPENAI] retrieveMessage|OK|:", message);
      return message;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] retrieveMessage|FAIL|", errorInfo.message);
      throw new Error(`Error retrieveMessage: ${errorInfo.message}`);
    }
  }

  async listMessages(request: {
    threadId: string;
    limit?: string;
    order?: string;
    before?: string;
    after?: string;
  }) {
    // 构建查询参数字符串
    const queryParams = new URLSearchParams();
    if (request.limit) queryParams.append("limit", request.limit);
    if (request.order) queryParams.append("order", request.order);
    if (request.before) queryParams.append("before", request.before);
    if (request.after) queryParams.append("after", request.after);

    // 构建完整的URL，包括路径参数和查询参数
    const url = `${this.path(
      OpenaiPath.ThreadPath,
      request.threadId,
      "messages",
    )}?${queryParams.toString()}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      // 请求成功，返回解析后的JSON
      const response = camelizeKeys(
        await res.json(),
      ) as OpenAIListMessagesResponse;
      console.log("[OPENAI] listMessages|OK|", response);
      return response;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] listMessages|FAIL|", errorInfo.message);
      throw new Error(`Error listMessages: ${errorInfo.message}`);
    }
  }

  async retrieveMessageFile(
    threadId: string,
    messageId: string,
    fileId: string,
  ) {
    const res = await fetch(
      this.path(
        OpenaiPath.ThreadPath,
        threadId,
        "messages",
        messageId,
        "files",
        fileId,
      ),
      {
        method: "GET",
        headers: {
          ...getHeaders(),
        },
      },
    );

    if (res.ok) {
      const file = camelizeKeys(await res.json()) as ChatGPTMessageFile;
      console.log("[OPENAI] retrieveMessageFile|OK|", file);
      return file;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] retrieveMessageFile|FAIL|", errorInfo.message);
      throw new Error(`Error retrieveMessageFile: ${errorInfo.message}`);
    }
  }

  async listMessageFiles(request: {
    threadId: string;
    messageId: string;
    limit?: string;
    order?: string;
    before?: string;
    after?: string;
  }) {
    // 构建查询参数字符串
    const queryParams = new URLSearchParams();
    if (request.limit) queryParams.append("limit", request.limit);
    if (request.order) queryParams.append("order", request.order);
    if (request.before) queryParams.append("before", request.before);
    if (request.after) queryParams.append("after", request.after);

    // 构建完整的URL，包括路径参数和查询参数
    const url = `${this.path(
      OpenaiPath.ThreadPath,
      request.threadId,
      "messages",
      request.messageId,
      "files",
    )}?${queryParams.toString()}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      const files = camelizeKeys(await res.json()) as Array<ChatGPTMessageFile>;
      console.log("[OPENAI] listMessageFiles|OK|", files);
      return files;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] listMessageFiles|FAIL|", errorInfo.message);
      throw new Error(`Error listMessageFiles: ${errorInfo.message}`);
    }
  }

  async createRun(threadId: string, assistantId: string) {
    let payload = {
      assistant_id: assistantId,
    };

    const res = await fetch(
      this.path(OpenaiPath.ThreadPath, threadId, "runs"),
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          ...getHeaders(),
        },
      },
    );

    if (res.ok) {
      const run = camelizeKeys(await res.json()) as ChatGPTRunObject;
      console.log("[OPENAI] createRun|OK|", run);
      return run;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] createRun|FAIL|", errorInfo.message);
      throw new Error(`Error createRun: ${errorInfo.message}`);
    }
  }

  async retrieveRun(threadId: string, runId: string) {
    const res = await fetch(
      this.path(OpenaiPath.ThreadPath, threadId, "runs", runId),
      {
        method: "GET",
        headers: {
          ...getHeaders(),
        },
      },
    );

    if (res.ok) {
      const run = camelizeKeys(await res.json()) as ChatGPTRunObject;
      console.log("[OPENAI] retrieveRun|OK|", run);
      return run;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] retrieveRun|FAIL|", errorInfo.message);
      throw new Error(`Error retrieveRun: ${errorInfo.message}`);
    }
  }

  async listRuns(request: {
    threadId: string;
    limit?: string;
    order?: string;
    before?: string;
    after?: string;
  }) {
    // 构建查询参数字符串
    const queryParams = new URLSearchParams();
    if (request.limit) queryParams.append("limit", request.limit);
    if (request.order) queryParams.append("order", request.order);
    if (request.before) queryParams.append("before", request.before);
    if (request.after) queryParams.append("after", request.after);

    // 构建完整的URL，包括路径参数和查询参数
    const url = `${this.path(
      OpenaiPath.ThreadPath,
      request.threadId,
      "runs",
    )}?${queryParams.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    if (res.ok) {
      const runs = camelizeKeys(await res.json()) as Array<ChatGPTRunObject>;
      console.log("[OPENAI] listRuns|OK|", runs);
      return runs;
    } else {
      // 请求失败，抛出错误或返回错误信息
      const errorInfo = await res.json();
      console.error("[OPENAI] listRuns|FAIL|", errorInfo.message);
      throw new Error(`Error listRuns: ${errorInfo.message}`);
    }
  }

  path(...path: string[]): string {
    let totalPath = path.join("/");
    const accessStore = useAccessStore.getState();

    const isAzure = accessStore.provider === ServiceProvider.Azure;

    if (isAzure && !accessStore.isValidAzure()) {
      throw Error(
        "incomplete azure config, please check it in your settings page",
      );
    }

    let baseUrl = isAzure ? accessStore.azureUrl : accessStore.openaiUrl;

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      baseUrl = isApp ? DEFAULT_API_HOST : ApiPath.OpenAI;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.OpenAI)) {
      baseUrl = "https://" + baseUrl;
    }

    if (isAzure) {
      totalPath = makeAzurePath(totalPath, accessStore.azureApiVersion);
    }
    console.log("baseUrl:", baseUrl);
    console.log("path:", totalPath);

    return [baseUrl, totalPath].join("/");
  }

  extractMessage(res: any) {
    return res.choices?.at(0)?.message?.content ?? "";
  }

  async chat(options: ChatOptions) {
    const messages = options.messages.map((v) => ({
      role: v.role,
      content: v.content,
    }));

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
      },
    };

    const requestPayload = {
      messages,
      stream: options.config.stream,
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      presence_penalty: modelConfig.presence_penalty,
      frequency_penalty: modelConfig.frequency_penalty,
      top_p: modelConfig.top_p,
      // max_tokens: Math.max(modelConfig.max_tokens, 1024),
      // Please do not ask me why not send max_tokens, no reason, this param is just shit, I dont want to explain anymore.
    };

    console.log("[Request] openai payload: ", requestPayload);

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const chatPath = this.path(OpenaiPath.ChatPath);
      console.log("chat path:", chatPath);
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      if (shouldStream) {
        let responseText = "";
        let remainText = "";
        let finished = false;

        // animate response to make it looks smooth
        function animateResponseText() {
          if (finished || controller.signal.aborted) {
            responseText += remainText;
            console.log("[Response Animation] finished");
            return;
          }

          if (remainText.length > 0) {
            const fetchCount = Math.max(1, Math.round(remainText.length / 60));
            const fetchText = remainText.slice(0, fetchCount);
            responseText += fetchText;
            remainText = remainText.slice(fetchCount);
            options.onUpdate?.(responseText, fetchText);
          }

          requestAnimationFrame(animateResponseText);
        }

        // start animaion
        animateResponseText();

        const finish = () => {
          if (!finished) {
            finished = true;
            options.onFinish(responseText + remainText);
          }
        };

        controller.signal.onabort = finish;

        fetchEventSource(chatPath, {
          ...chatPayload,
          async onopen(res) {
            clearTimeout(requestTimeoutId);
            const contentType = res.headers.get("content-type");
            console.log(
              "[OPENAI] request response content type: ",
              contentType,
            );

            if (contentType?.startsWith("text/plain")) {
              responseText = await res.clone().text();
              return finish();
            }

            if (
              !res.ok ||
              !res.headers
                .get("content-type")
                ?.startsWith(EventStreamContentType) ||
              res.status !== 200
            ) {
              const responseTexts = [responseText];
              let extraInfo = await res.clone().text();
              try {
                const resJson = await res.clone().json();
                extraInfo = prettyObject(resJson);
              } catch {}

              if (res.status === 401) {
                responseTexts.push(Locale.Error.Unauthorized);
              }

              if (extraInfo) {
                responseTexts.push(extraInfo);
              }

              responseText = responseTexts.join("\n\n");

              return finish();
            }
          },
          onmessage(msg) {
            if (msg.data === "[DONE]" || finished) {
              return finish();
            }
            const text = msg.data;
            try {
              const json = JSON.parse(text) as {
                choices: Array<{
                  delta: {
                    content: string;
                  };
                }>;
              };
              const delta = json.choices[0]?.delta?.content;
              if (delta) {
                remainText += delta;
              }
            } catch (e) {
              console.error("[Request] parse error", text);
            }
          },
          onclose() {
            finish();
          },
          onerror(e) {
            options.onError?.(e);
            throw e;
          },
          openWhenHidden: true,
        });
      } else {
        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = this.extractMessage(resJson);
        options.onFinish(message);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }

  async usage() {
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`;
    const ONE_DAY = 1 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = formatDate(startOfMonth);
    const endDate = formatDate(new Date(Date.now() + ONE_DAY));

    const [used, subs] = await Promise.all([
      fetch(
        this.path(
          `${OpenaiPath.UsagePath}?start_date=${startDate}&end_date=${endDate}`,
        ),
        {
          method: "GET",
          headers: getHeaders(),
        },
      ),
      fetch(this.path(OpenaiPath.SubsPath), {
        method: "GET",
        headers: getHeaders(),
      }),
    ]);

    if (used.status === 401) {
      throw new Error(Locale.Error.Unauthorized);
    }

    if (!used.ok || !subs.ok) {
      throw new Error("Failed to query usage from openai");
    }

    const response = (await used.json()) as {
      total_usage?: number;
      error?: {
        type: string;
        message: string;
      };
    };

    const total = (await subs.json()) as {
      hard_limit_usd?: number;
    };

    if (response.error && response.error.type) {
      throw Error(response.error.message);
    }

    if (response.total_usage) {
      response.total_usage = Math.round(response.total_usage) / 100;
    }

    if (total.hard_limit_usd) {
      total.hard_limit_usd = Math.round(total.hard_limit_usd * 100) / 100;
    }

    return {
      used: response.total_usage,
      total: total.hard_limit_usd,
    } as LLMUsage;
  }

  async models(): Promise<LLMModel[]> {
    if (this.disableListModels) {
      return DEFAULT_MODELS.slice();
    }

    const res = await fetch(this.path(OpenaiPath.ListModelPath), {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    const resJson = (await res.json()) as OpenAIListModelResponse;
    const chatModels = resJson.data?.filter((m) => m.id.startsWith("gpt-"));
    console.log("[Models]", chatModels);

    if (!chatModels) {
      return [];
    }

    return chatModels.map((m) => ({
      name: m.id,
      available: true,
      provider: {
        id: "openai",
        providerName: "OpenAI",
        providerType: "openai",
      },
    }));
  }
}

export { OpenaiPath };
