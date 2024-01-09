import {trimTopic} from "../utils";

import Locale, {getLang} from "../locales";
import {showToast} from "../components/ui-lib";
import {ModelConfig, ModelType, useAppConfig} from "./config";
import {createEmptyMask, Mask} from "./mask";
import {
    DEFAULT_INPUT_TEMPLATE,
    DEFAULT_SYSTEM_TEMPLATE,
    KnowledgeCutOffDate,
    LAST_INPUT_KEY,
    ModelProvider,
    StoreKey,
    SUMMARIZE_MODEL,
} from "../constant";
import {api, ChatSession, ClientApi, RequestMessage} from "../client/api";
import {ChatControllerPool} from "../client/controller";
import {prettyObject} from "../utils/format";
import {estimateTokenLength} from "../utils/token";
import {nanoid} from "nanoid";
import {createPersistStore} from "../utils/store";
import {
    ChatGPTAssistant,
    ChatGPTMessage,
    ChatGPTThread,
    ChatGPTFile,
    OpenAIListAssistantResponse,
} from "@/app/client/platforms/openai";
import {threadId} from "node:worker_threads";
import assert from "node:assert";
import {useNavigate} from "react-router-dom";

export type ChatMessage = RequestMessage & {
    date: string;
    streaming?: boolean;
    isError?: boolean;
    id: string;
    model?: ModelType;
};

export function createTempMessage(override: Partial<ChatMessage>): ChatMessage {
    return {
        id: nanoid(),
        date: new Date().toLocaleString(),
        role: "user",
        content: "",
        ...override,
    };
}

export function createTempChatGPTMessage(
    threadId: string,
    override: Partial<ChatGPTMessage>,
) {
    return {
        id: nanoid(),
        threadId: threadId,
        // createAt: Math.floor(new Date().getTime() / 1000),
        ...override,
    };
}

export interface ChatStat {
    tokenCount: number;
    wordCount: number;
    charCount: number;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;
export const BOT_HELLO: ChatMessage = createTempMessage({
    role: "assistant",
    content: Locale.Store.BotHello,
});

function createEmptySession(): ChatSession {
    return {
        id: nanoid(),
        topic: DEFAULT_TOPIC,
        memoryPrompt: "",
        messages: [],
        stat: {
            tokenCount: 0,
            wordCount: 0,
            charCount: 0,
        },
        lastUpdate: Date.now(),
        lastSummarizeIndex: 0,

        mask: createEmptyMask(),
    };
}

function getSummarizeModel(currentModel: string) {
    // if it is using gpt-* models, force to use 3.5 to summarize
    return currentModel.startsWith("gpt") ? SUMMARIZE_MODEL : currentModel;
}

function countMessages(msgs: ChatMessage[]) {
    return msgs.reduce((pre, cur) => pre + estimateTokenLength(cur.content), 0);
}

function fillTemplateWith(input: string, modelConfig: ModelConfig) {
    let cutoff =
        KnowledgeCutOffDate[modelConfig.model] ?? KnowledgeCutOffDate.default;

    const vars = {
        cutoff,
        model: modelConfig.model,
        time: new Date().toLocaleString(),
        lang: getLang(),
        input: input,
    };

    let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

    // must contains {{input}}
    const inputVar = "{{input}}";
    if (!output.includes(inputVar)) {
        output += "\n" + inputVar;
    }

    Object.entries(vars).forEach(([name, value]) => {
        output = output.replaceAll(`{{${name}}}`, value);
    });

    return output;
}

const DEFAULT_CHAT_STATE = {
    sessions: [createEmptySession()],
    assistants: [] as ChatGPTAssistant[],
    currentSessionIndex: 0,
    currentAssistantId: "",
    currentThreadId: "",
    files: [] as ChatGPTFile[],
};

export const useChatStore = createPersistStore(
    DEFAULT_CHAT_STATE,
    (set, _get) => {
        function get() {
            return {
                ..._get(),
                ...methods,
            };
        }

        const methods = {
            async listFiles() {
                const oldFiles = get().files.slice();
                const files = await api.llm.listFiles();
                const mergedList: ChatGPTFile[] = [];

                // 将第一个列表的元素添加到新数组中
                oldFiles.forEach((item) => {
                    mergedList.push(item);
                });

                files.forEach((item) => {
                    // 检查新数组中是否已经存在具有相同id的元素
                    const existingItem = mergedList.find(
                        (existing) => existing.id === item.id,
                    );
                    if (!existingItem) {
                        mergedList.push(item);
                    }
                });

                mergedList.sort((a, b) => a.createdAt - b.createdAt);

                set(() => ({
                    files: mergedList,
                }));
            },

            async uploadFile(file: File) {
                const files = get().files.slice();
                const fileUploaded = await api.llm.uploadFile({
                    file: file,
                    purpose: "assistant",
                });

                files.unshift(fileUploaded);
                set(() => ({
                    files: files,
                }));
            },

            async deleteFile(fileId: string) {
                const deleteResponse = await api.llm.deleteFile(fileId);
                if (deleteResponse.deleted) {
                    const files = get().files.slice();
                    const newFiles = files.filter((f, i, a) => {
                        return !(f.id === fileId);
                    });
                    set(() => ({
                        files: newFiles,
                    }));
                }
            },

            async fetchAssistants() {
                const assistantResponse = await api.llm.listAssistants();
                // console.log("[CHAT] fetchAssistants:",assistantResponse)
                set((state) => {
                    const {
                        sessions,
                        assistants: oldAssistants,
                        currentSessionIndex: oldIndex,
                    } = state;
                    const mergedList: ChatGPTAssistant[] = [];

                    // 将第一个列表的元素添加到新数组中
                    oldAssistants.forEach((item) => {
                        // 检查createNewAssistant是否包含id字段
                        if (item && item.id) {
                            if (!item.threads) {
                                item.threads = [];
                            }
                            mergedList.push(item);
                        } else {
                            // 处理错误情况，例如抛出错误或者设置错误状态
                            console.error(
                                "[CHAT]fetchAssistants merge error:Find Corrupted Assistant, abandon|",
                                item,
                            );
                        }
                    });

                    assistantResponse.data?.forEach((item) => {
                        // 检查新数组中是否已经存在具有相同id的元素
                        const existingItem = mergedList.find(
                            (existing) => existing.id === item.id,
                        );
                        if (!existingItem) {
                            // 如果不存在，则添加到新数组中
                            if (!item.threads) {
                                item.threads = [];
                            }
                            mergedList.push(item);
                        } else {
                            // update
                            existingItem.name = item.name;
                            existingItem.description = item.description;
                            existingItem.fileIds = item.fileIds;
                            existingItem.model = item.model;
                            existingItem.tools = item.tools;
                            existingItem.instructions = item.instructions;
                        }
                    });

                    mergedList.sort((a, b) => b.createdAt - a.createdAt);
                    console.log("[CHAT] mergedAssistantList:", mergedList);

                    return {
                        assistants: mergedList,
                    };
                });
            },

            async createAssistant(req: {
                name: string;
                description?: string;
                instructions?: string;
                model: string;
                fileIds?: string[];
                tools?: { type: string }[];
            }) {
                const assistant = await api.llm.createAssistant(req);
                // console.log("[CHAT] createAssistant:", assistant)
                const assistants = get().assistants.slice();
                if (!assistant.threads) {
                    assistant.threads = [];
                }
                assistants.push(assistant);
                assistants.sort((a, b) => b.createdAt - a.createdAt);
                set(() => ({
                    assistants: assistants,
                }));
            },

            async deleteAssistant(deleteAssistant: ChatGPTAssistant) {
                const deletingLastAssistant = get().assistants.length === 1;
                const deleteIdx = get().assistants.findIndex(
                    (assis) => assis.id === deleteAssistant.id,
                );
                if (!deleteAssistant || deleteIdx === -1) {
                    console.error("[CHAT] deletingAssistant|ERROR|not exist");
                    return;
                }

                //调用api删除
                const assistantDeleteResponse =
                    await api.llm.deleteAssistant(deleteAssistant);
                if (assistantDeleteResponse.deleted) {
                    const assistants = get().assistants.slice();
                    assistants.splice(deleteIdx, 1);

                    // const currentIndex = get().currentAssistantIndex;
                    // let nextIndex = Math.min(
                    //     currentIndex - Number(index < currentIndex),
                    //     assistants.length - 1,
                    // );
                    //
                    // if (deletingLastAssistant) {
                    //     nextIndex = 0;
                    //     // assistant 不用push empty
                    //     // assistants.push(createEmptySession());
                    // }
                    set(() => ({
                        assistants: assistants,
                    }));
                    showToast(
                        Locale.Home.DeleteAssistantSuccessToast(deleteAssistant.name),
                    );
                } else {
                    showToast(Locale.Home.DeleteAssistantFailToast);
                }
            },

            async createThread(assistant: ChatGPTAssistant) {
                const assistants = get().assistants.slice();
                const bondAssistant = assistants.find((i) => i.id === assistant.id);
                if (bondAssistant) {
                    const newThread = await api.llm.createThread();
                    if (!newThread.data) {
                        newThread.data = [];
                    }
                    bondAssistant.threads.unshift(newThread);
                    bondAssistant.threads.sort((a, b) => a.createdAt - b.createdAt);
                    set(() => ({
                        assistants: assistants,
                        currentThreadId: newThread.id,
                    }));
                } else {
                    showToast(Locale.Home.CreateThreadFail);
                }
            },

            async deleteThread(
                assistantId: string,
                threadId: string,
                noThreadLeft: () => void,
            ) {
                const assistants = get().assistants.slice();
                const refAssistant = assistants.find((e) => e.id === assistantId);
                const deleteThread = refAssistant?.threads.find(
                    (e) => e.id === threadId,
                );
                const deletingLastThread = refAssistant?.threads.length === 1;
                const currentThreadIdx = refAssistant?.threads.findIndex(
                    (i) => i.id === get().currentThreadId,
                );
                const currentThreadId = get().currentThreadId;
                console.log(
                    currentThreadIdx,
                    deletingLastThread,
                    get().currentThreadId,
                    threadId,
                );
                if (!refAssistant || !deleteThread) {
                    return;
                }
                const deleteThreadIdx = refAssistant?.threads.indexOf(deleteThread);

                //调用api删除
                const threadDeleteResponse = await api.llm.deleteThread(threadId);
                if (threadDeleteResponse.deleted) {
                    console.log(111);
                    refAssistant.threads.splice(deleteThreadIdx, 1);
                    console.log(currentThreadIdx);

                    if (currentThreadIdx === undefined || currentThreadIdx === -1) {
                        console.log(222);
                        //当前激活的thread不在本地被删除thread的assistant中
                        set(() => ({
                            assistants: assistants,
                        }));
                    } else if (currentThreadId === threadId) {
                        //激活thread和删除thread在一个assist中，且删除thread就是当前激活thread
                        if (!deletingLastThread) {
                            console.log(333);

                            let newThreadId = refAssistant.threads.at(0)?.id;
                            if (!newThreadId) {
                                //回到初始化
                                newThreadId = "";
                            }
                            set(() => ({
                                assistants: assistants,
                                currentThreadId: newThreadId,
                            }));
                        } else {
                            console.log(444);
                            //删除的就是最后一个
                            set(() => ({
                                assistants: assistants,
                                currentThreadId: "",
                            }));
                            noThreadLeft();
                        }
                    } else {
                        console.log(555);
                        //当前激活的thread和被删除的thread在同一个assis中，但不相同
                        set((ƒs) => ({
                            assistants: assistants,
                        }));
                    }
                    showToast(Locale.Home.DeleteAssistantSuccessToast(refAssistant.name));
                } else {
                    showToast(Locale.Home.DeleteAssistantFailToast);
                }
            },

            async createMessage(content: string) {
                const threadId = get().currentThreadId;
                const assistantId = get().currentAssistantId;
                const assistants = get().assistants.slice();
                const createMessageResult = await api.llm.createMessage(
                    threadId,
                    content,
                );
                if (createMessageResult) {
                    //add
                    // console.log('[CREATE message]:', createMessageResult)
                    // assistants.find(e => e.id === assistantId)?.threads.find(e => e.id === threadId)?.data.push(createMessageResult)
                    // console.log("[CREATE message] list|",assistants)
                    // set(() => ({
                    //     assistants: assistants,
                    // }));
                    this.updateCurrentThread((thread) => {
                        thread?.data.push(createMessageResult);
                    });
                }
            },

            async createAudioTranscriptions(audioFile:Blob) {
                return await api.llm.createAudioTranscriptions(audioFile);
            },

            async createRun(assistantId: string, threadId: string) {
                //create run
                return await api.llm.createRun(threadId, assistantId);
            },

            async loopRetrieveRun(
                threadId: string,
                runId: string,
                callback: (onNewMessage: ChatGPTMessage) => void,
            ) {
                const checkRunStatus = async () => {
                    try {
                        const runStatus = await api.llm.retrieveRun(threadId, runId);
                        if (runStatus && runStatus.status === "completed") {
                            // 如果状态成功，处理结果并清除定时器
                            clearInterval(intervalId);
                            // 处理结果...
                            console.log("[CHAT] Run succeeded:", runStatus.id);
                            // list message
                            let messageListRes = await api.llm.listMessages({
                                threadId: threadId,
                                order: "asc",
                            });

                            const assistants = get().assistants.slice();
                            const assistant = assistants.find(
                                (assit) => assit.id === get().currentAssistantId,
                            );
                            const thread = assistant?.threads.find(
                                (thread) => thread.id === threadId,
                            );

                            if (
                                thread &&
                                messageListRes.data.length > 0 &&
                                messageListRes.data.at(messageListRes.data.length - 1)?.role ===
                                "assistant"
                            ) {
                                //merge messages
                                let newMsg = messageListRes.data.pop();
                                if (newMsg) {
                                    //find if duplicate
                                    if (!thread?.data.find((value,index,obj) => {
                                        return value.id === newMsg?.id
                                    })){
                                        thread?.data.push(newMsg);
                                        callback(newMsg);
                                        set(() => ({
                                            assistants: assistants,
                                        }));
                                    }
                                }
                            }
                        } else if (
                            runStatus &&
                            (runStatus.status === "requires_action" ||
                                runStatus.status === "failed" ||
                                runStatus.status === "cancelled" ||
                                runStatus.status === "expired")
                        ) {
                            // 如果状态失败，也清除定时器
                            clearInterval(intervalId);
                            console.error(
                                "[CHAT] Run failed:",
                                runStatus.status,
                                runStatus.id,
                            );
                        }
                        // 如果状态是其他（例如pending），定时器会继续运行
                    } catch (error) {
                        // 如果请求失败，清除定时器并打印错误
                        clearInterval(intervalId);
                        console.error("[CHAT] Error retrieving run status:", error);
                    }
                };

                // 设置定时器，每3秒调用一次checkRunStatus函数
                const intervalId = setInterval(checkRunStatus, 2000);
            },

            clearSessions() {
                set(() => ({
                    sessions: [createEmptySession()],
                    currentSessionIndex: 0,
                }));
            },

            selectSession(index: number) {
                set({
                    currentSessionIndex: index,
                });
            },

            selectThread(assistantId: string, threadIdx: string) {
                console.log("[CHAT] selectThread:", threadIdx);
                set({
                    currentAssistantId: assistantId,
                    currentThreadId: threadIdx,
                });
            },

            moveSession(from: number, to: number) {
                set((state) => {
                    const {sessions, currentSessionIndex: oldIndex} = state;

                    // move the session
                    const newSessions = [...sessions];
                    const session = newSessions[from];
                    newSessions.splice(from, 1);
                    newSessions.splice(to, 0, session);

                    // modify current session id
                    let newIndex = oldIndex === from ? to : oldIndex;
                    if (oldIndex > from && oldIndex <= to) {
                        newIndex -= 1;
                    } else if (oldIndex < from && oldIndex >= to) {
                        newIndex += 1;
                    }

                    return {
                        currentSessionIndex: newIndex,
                        sessions: newSessions,
                    };
                });
            },

            newSession(mask?: Mask) {
                const session = createEmptySession();

                if (mask) {
                    const config = useAppConfig.getState();
                    const globalModelConfig = config.modelConfig;

                    session.mask = {
                        ...mask,
                        modelConfig: {
                            ...globalModelConfig,
                            ...mask.modelConfig,
                        },
                    };
                    session.topic = mask.name;
                }

                set((state) => ({
                    currentSessionIndex: 0,
                    sessions: [session].concat(state.sessions),
                }));
            },

            nextSession(delta: number) {
                const n = get().sessions.length;
                const limit = (x: number) => (x + n) % n;
                const i = get().currentSessionIndex;
                get().selectSession(limit(i + delta));
            },

            deleteSession(index: number) {
                const deletingLastSession = get().sessions.length === 1;
                const deletedSession = get().sessions.at(index);

                if (!deletedSession) return;

                const sessions = get().sessions.slice();
                sessions.splice(index, 1);

                const currentIndex = get().currentSessionIndex;
                let nextIndex = Math.min(
                    currentIndex - Number(index < currentIndex),
                    sessions.length - 1,
                );

                if (deletingLastSession) {
                    nextIndex = 0;
                    sessions.push(createEmptySession());
                }

                // for undo delete action
                const restoreState = {
                    currentSessionIndex: get().currentSessionIndex,
                    sessions: get().sessions.slice(),
                };

                set(() => ({
                    currentSessionIndex: nextIndex,
                    sessions,
                }));

                showToast(
                    Locale.Home.DeleteToast,
                    {
                        text: Locale.Home.Revert,
                        onClick() {
                            set(() => restoreState);
                        },
                    },
                    5000,
                );
            },

            // currentAssistant() {
            //     let index = get().currentAssistantId;
            //     const assistants = get().assistants;
            //
            //     return assistants
            // }

            currentThread() {
                let threadId = get().currentThreadId;
                let assistantId = get().currentAssistantId;
                const assistants = get().assistants;
                //first look in currentAssistant
                let currentAssisFound = assistants
                    .find((e) => e.id === assistantId)
                    ?.threads.find((e) => e.id === threadId);

                if (!currentAssisFound) {
                    //search all assistant
                    assistants.forEach(assistant => {
                        if (assistant.threads.find((e) => e.id === threadId)) {
                            //found
                            set(() => ({
                                currentAssistantId: assistant.id,
                            }));
                            return assistant.threads.find((e) => e.id === threadId)
                        }
                    });
                }else{
                    return assistants
                        .find((e) => e.id === assistantId)
                        ?.threads.find((e) => e.id === threadId);
                }
            },

            currentSession() {
                let index = get().currentSessionIndex;
                const sessions = get().sessions;

                if (index < 0 || index >= sessions.length) {
                    index = Math.min(sessions.length - 1, Math.max(0, index));
                    set(() => ({currentSessionIndex: index}));
                }

                const session = sessions[index];

                return session;
            },

            onNewMessage(message: ChatMessage) {
                get().updateCurrentSession((session) => {
                    session.messages = session.messages.concat();
                    session.lastUpdate = Date.now();
                });
                get().updateStat(message);
                get().summarizeSession();
            },

            async onUserInputForSession(content: string) {
                const session = get().currentSession();
                const modelConfig = session.mask.modelConfig;

                const userContent = fillTemplateWith(content, modelConfig);
                console.log("[User Input] after template: ", userContent);

                const userMessage: ChatMessage = createTempMessage({
                    role: "user",
                    content: userContent,
                });

                const botMessage: ChatMessage = createTempMessage({
                    role: "assistant",
                    streaming: true,
                    model: modelConfig.model,
                });

                // get recent messages
                const recentMessages = get().getMessagesWithMemory();
                const sendMessages = recentMessages.concat(userMessage);
                const messageIndex = get().currentSession().messages.length + 1;

                // save user's and bot's message
                get().updateCurrentSession((session) => {
                    const savedUserMessage = {
                        ...userMessage,
                        content,
                    };
                    session.messages = session.messages.concat([
                        savedUserMessage,
                        botMessage,
                    ]);
                });

                var api: ClientApi;
                if (modelConfig.model === "gemini-pro") {
                    api = new ClientApi(ModelProvider.GeminiPro);
                } else {
                    api = new ClientApi(ModelProvider.GPT);
                }

                // make request
                api.llm.chat({
                    messages: sendMessages,
                    config: {...modelConfig, stream: true},
                    onUpdate(message) {
                        botMessage.streaming = true;
                        if (message) {
                            botMessage.content = message;
                        }
                        get().updateCurrentSession((session) => {
                            session.messages = session.messages.concat();
                        });
                    },
                    onFinish(message) {
                        botMessage.streaming = false;
                        if (message) {
                            botMessage.content = message;
                            get().onNewMessage(botMessage);
                        }
                        ChatControllerPool.remove(session.id, botMessage.id);
                    },
                    onError(error) {
                        const isAborted = error.message.includes("aborted");
                        botMessage.content +=
                            "\n\n" +
                            prettyObject({
                                error: true,
                                message: error.message,
                            });
                        botMessage.streaming = false;
                        userMessage.isError = !isAborted;
                        botMessage.isError = !isAborted;
                        get().updateCurrentSession((session) => {
                            session.messages = session.messages.concat();
                        });
                        ChatControllerPool.remove(
                            session.id,
                            botMessage.id ?? messageIndex,
                        );

                        console.error("[Chat] failed ", error);
                    },
                    onController(controller) {
                        // collect controller for stop/retry
                        ChatControllerPool.addController(
                            session.id,
                            botMessage.id ?? messageIndex,
                            controller,
                        );
                    },
                });
            },

            getMemoryPrompt() {
                const session = get().currentSession();

                return {
                    role: "system",
                    content:
                        session.memoryPrompt.length > 0
                            ? Locale.Store.Prompt.History(session.memoryPrompt)
                            : "",
                    date: "",
                } as ChatMessage;
            },

            getMessagesWithMemory() {
                const session = get().currentSession();
                const modelConfig = session.mask.modelConfig;
                const clearContextIndex = session.clearContextIndex ?? 0;
                const messages = session.messages.slice();
                const totalMessageCount = session.messages.length;

                // in-context prompts
                const contextPrompts = session.mask.context.slice();

                // system prompts, to get close to OpenAI Web ChatGPT
                const shouldInjectSystemPrompts =
                    modelConfig.enableInjectSystemPrompts &&
                    session.mask.modelConfig.model.startsWith("gpt-");

                var systemPrompts: ChatMessage[] = [];
                systemPrompts = shouldInjectSystemPrompts
                    ? [
                        createTempMessage({
                            role: "system",
                            content: fillTemplateWith("", {
                                ...modelConfig,
                                template: DEFAULT_SYSTEM_TEMPLATE,
                            }),
                        }),
                    ]
                    : [];
                if (shouldInjectSystemPrompts) {
                    console.log(
                        "[Global System Prompt] ",
                        systemPrompts.at(0)?.content ?? "empty",
                    );
                }

                // long term memory
                const shouldSendLongTermMemory =
                    modelConfig.sendMemory &&
                    session.memoryPrompt &&
                    session.memoryPrompt.length > 0 &&
                    session.lastSummarizeIndex > clearContextIndex;
                const longTermMemoryPrompts = shouldSendLongTermMemory
                    ? [get().getMemoryPrompt()]
                    : [];
                const longTermMemoryStartIndex = session.lastSummarizeIndex;

                // short term memory
                const shortTermMemoryStartIndex = Math.max(
                    0,
                    totalMessageCount - modelConfig.historyMessageCount,
                );

                // lets concat send messages, including 4 parts:
                // 0. system prompt: to get close to OpenAI Web ChatGPT
                // 1. long term memory: summarized memory messages
                // 2. pre-defined in-context prompts
                // 3. short term memory: latest n messages
                // 4. newest input message
                const memoryStartIndex = shouldSendLongTermMemory
                    ? Math.min(longTermMemoryStartIndex, shortTermMemoryStartIndex)
                    : shortTermMemoryStartIndex;
                // and if user has cleared history messages, we should exclude the memory too.
                const contextStartIndex = Math.max(clearContextIndex, memoryStartIndex);
                const maxTokenThreshold = modelConfig.max_tokens;

                // get recent messages as much as possible
                const reversedRecentMessages = [];
                for (
                    let i = totalMessageCount - 1, tokenCount = 0;
                    i >= contextStartIndex && tokenCount < maxTokenThreshold;
                    i -= 1
                ) {
                    const msg = messages[i];
                    if (!msg || msg.isError) continue;
                    tokenCount += estimateTokenLength(msg.content);
                    reversedRecentMessages.push(msg);
                }

                // concat all messages
                const recentMessages = [
                    ...systemPrompts,
                    ...longTermMemoryPrompts,
                    ...contextPrompts,
                    ...reversedRecentMessages.reverse(),
                ];

                return recentMessages;
            },

            updateMessage(
                sessionIndex: number,
                messageIndex: number,
                updater: (message?: ChatMessage) => void,
            ) {
                const sessions = get().sessions;
                const session = sessions.at(sessionIndex);
                const messages = session?.messages;
                updater(messages?.at(messageIndex));
                set(() => ({sessions}));
            },

            resetSession() {
                get().updateCurrentSession((session) => {
                    session.messages = [];
                    session.memoryPrompt = "";
                });
            },

            summarizeSession() {
                const config = useAppConfig.getState();
                const session = get().currentSession();
                const modelConfig = session.mask.modelConfig;

                var api: ClientApi;
                if (modelConfig.model === "gemini-pro") {
                    api = new ClientApi(ModelProvider.GeminiPro);
                } else {
                    api = new ClientApi(ModelProvider.GPT);
                }

                // remove error messages if any
                const messages = session.messages;

                // should summarize topic after chating more than 50 words
                const SUMMARIZE_MIN_LEN = 50;
                if (
                    config.enableAutoGenerateTitle &&
                    session.topic === DEFAULT_TOPIC &&
                    countMessages(messages) >= SUMMARIZE_MIN_LEN
                ) {
                    const topicMessages = messages.concat(
                        createTempMessage({
                            role: "user",
                            content: Locale.Store.Prompt.Topic,
                        }),
                    );
                    api.llm.chat({
                        messages: topicMessages,
                        config: {
                            model: getSummarizeModel(session.mask.modelConfig.model),
                        },
                        onFinish(message) {
                            get().updateCurrentSession(
                                (session) =>
                                    (session.topic =
                                        message.length > 0 ? trimTopic(message) : DEFAULT_TOPIC),
                            );
                        },
                    });
                }
                const summarizeIndex = Math.max(
                    session.lastSummarizeIndex,
                    session.clearContextIndex ?? 0,
                );
                let toBeSummarizedMsgs = messages
                    .filter((msg) => !msg.isError)
                    .slice(summarizeIndex);

                const historyMsgLength = countMessages(toBeSummarizedMsgs);

                if (historyMsgLength > modelConfig?.max_tokens ?? 4000) {
                    const n = toBeSummarizedMsgs.length;
                    toBeSummarizedMsgs = toBeSummarizedMsgs.slice(
                        Math.max(0, n - modelConfig.historyMessageCount),
                    );
                }

                // add memory prompt
                toBeSummarizedMsgs.unshift(get().getMemoryPrompt());

                const lastSummarizeIndex = session.messages.length;

                console.log(
                    "[Chat History] ",
                    toBeSummarizedMsgs,
                    historyMsgLength,
                    modelConfig.compressMessageLengthThreshold,
                );

                if (
                    historyMsgLength > modelConfig.compressMessageLengthThreshold &&
                    modelConfig.sendMemory
                ) {
                    api.llm.chat({
                        messages: toBeSummarizedMsgs.concat(
                            createTempMessage({
                                role: "system",
                                content: Locale.Store.Prompt.Summarize,
                                date: "",
                            }),
                        ),
                        config: {
                            ...modelConfig,
                            stream: true,
                            model: getSummarizeModel(session.mask.modelConfig.model),
                        },
                        onUpdate(message) {
                            session.memoryPrompt = message;
                        },
                        onFinish(message) {
                            console.log("[Memory] ", message);
                            get().updateCurrentSession((session) => {
                                session.lastSummarizeIndex = lastSummarizeIndex;
                                session.memoryPrompt = message; // Update the memory prompt for stored it in local storage
                            });
                        },
                        onError(err) {
                            console.error("[Summarize] ", err);
                        },
                    });
                }
            },

            updateStat(message: ChatMessage) {
                get().updateCurrentSession((session) => {
                    session.stat.charCount += message.content.length;
                    // TODO: should update chat count and word count
                });
            },

            updateCurrentSession(updater: (session: ChatSession) => void) {
                const sessions = get().sessions;
                const index = get().currentSessionIndex;
                updater(sessions[index]);
                set(() => ({sessions}));
            },

            updateCurrentThread(updater: (thread?: ChatGPTThread) => void) {
                const assistants = get().assistants;
                const currentAssistantId = get().currentAssistantId;
                const currentThreadId = get().currentThreadId;
                updater(
                    assistants
                        .find((e) => e.id === currentAssistantId)
                        ?.threads.find((e) => e.id === currentThreadId),
                );
                set(() => ({assistants}));
            },

            clearAllData() {
                localStorage.clear();
                location.reload();
            },
        };

        return methods;
    },
    {
        name: StoreKey.Chat,
        version: 3.1,
        migrate(persistedState, version) {
            const state = persistedState as any;
            const newState = JSON.parse(
                JSON.stringify(state),
            ) as typeof DEFAULT_CHAT_STATE;

            if (version < 2) {
                newState.sessions = [];

                const oldSessions = state.sessions;
                for (const oldSession of oldSessions) {
                    const newSession = createEmptySession();
                    newSession.topic = oldSession.topic;
                    newSession.messages = [...oldSession.messages];
                    newSession.mask.modelConfig.sendMemory = true;
                    newSession.mask.modelConfig.historyMessageCount = 4;
                    newSession.mask.modelConfig.compressMessageLengthThreshold = 1000;
                    newState.sessions.push(newSession);
                }
            }

            if (version < 3) {
                // migrate id to nanoid
                newState.sessions.forEach((s) => {
                    s.id = nanoid();
                    s.messages.forEach((m) => (m.id = nanoid()));
                });
            }

            // Enable `enableInjectSystemPrompts` attribute for old sessions.
            // Resolve issue of old sessions not automatically enabling.
            if (version < 3.1) {
                newState.sessions.forEach((s) => {
                    if (
                        // Exclude those already set by user
                        !s.mask.modelConfig.hasOwnProperty("enableInjectSystemPrompts")
                    ) {
                        // Because users may have changed this configuration,
                        // the user's current configuration is used instead of the default
                        const config = useAppConfig.getState();
                        s.mask.modelConfig.enableInjectSystemPrompts =
                            config.modelConfig.enableInjectSystemPrompts;
                    }
                });
            }

            return newState as any;
        },
    },
);
