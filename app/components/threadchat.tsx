import { useDebouncedCallback } from "use-debounce";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  Fragment,
} from "react";

import SendWhiteIcon from "../icons/send-white.svg";
import BrainIcon from "../icons/brain.svg";
import RenameIcon from "../icons/rename.svg";
import ExportIcon from "../icons/share.svg";
import ReturnIcon from "../icons/return.svg";
import CopyIcon from "../icons/copy.svg";
import LoadingIcon from "../icons/three-dots.svg";
import PromptIcon from "../icons/prompt.svg";
import MaskIcon from "../icons/mask.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import ResetIcon from "../icons/reload.svg";
import BreakIcon from "../icons/break.svg";
import SettingsIcon from "../icons/chat-settings.svg";
import DeleteIcon from "../icons/clear.svg";
import AddIcon from "../icons/add.svg";

import PinIcon from "../icons/pin.svg";
import EditIcon from "../icons/rename.svg";
import ConfirmIcon from "../icons/confirm.svg";
import CancelIcon from "../icons/cancel.svg";

import LightIcon from "../icons/light.svg";
import DarkIcon from "../icons/dark.svg";
import AutoIcon from "../icons/auto.svg";
import BottomIcon from "../icons/bottom.svg";
import StopIcon from "../icons/pause.svg";
import RobotIcon from "../icons/robot.svg";

import {
  ChatMessage,
  SubmitKey,
  useChatStore,
  BOT_HELLO,
  createTempMessage,
  useAccessStore,
  Theme,
  useAppConfig,
  DEFAULT_TOPIC,
  ModelType,
  createTempChatGPTMessage,
} from "../store";

import {
  copyToClipboard,
  selectOrCopy,
  autoGrowTextArea,
  useMobileScreen,
  getDateStr,
  getDateStrByStamp,
  getDateStrByStampLog,
} from "../utils";

import dynamic from "next/dynamic";

import { Prompt, usePromptStore } from "../store/prompt";
import Locale from "../locales";

import { IconButton } from "./button";
import styles from "./chat.module.scss";

import {
  List,
  ListItem,
  Modal,
  Selector,
  showConfirm,
  showPrompt,
  showToast,
} from "./ui-lib";
import { useNavigate } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  LAST_INPUT_KEY,
  Path,
  REQUEST_TIMEOUT_MS,
  UNFINISHED_INPUT,
} from "../constant";
import { Avatar } from "./emoji";
import { ContextPrompts, MaskAvatar, MaskConfig } from "./mask";
import { useMaskStore } from "../store/mask";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { getClientConfig } from "../config/client";
import { useAllModels } from "../utils/hooks";
import assert from "assert";
import {
  ChatGPTAssistant,
  ChatGPTMessage,
  ChatGPTMessageContent,
  ChatGPTMessageFile,
  ChatGPTThread,
} from "@/app/client/platforms/openai";
import { nanoid } from "nanoid";
import { api } from "@/app/client/api";
import ShareIcon from "@/app/icons/share.svg";

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

function useSubmitHandler() {
  const config = useAppConfig();
  const submitKey = config.submitKey;
  const isComposing = useRef(false);

  useEffect(() => {
    const onCompositionStart = () => {
      isComposing.current = true;
    };
    const onCompositionEnd = () => {
      isComposing.current = false;
    };

    window.addEventListener("compositionstart", onCompositionStart);
    window.addEventListener("compositionend", onCompositionEnd);

    return () => {
      window.removeEventListener("compositionstart", onCompositionStart);
      window.removeEventListener("compositionend", onCompositionEnd);
    };
  }, []);

  const shouldSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return false;
    if (e.key === "Enter" && (e.nativeEvent.isComposing || isComposing.current))
      return false;
    return (
      (config.submitKey === SubmitKey.AltEnter && e.altKey) ||
      (config.submitKey === SubmitKey.CtrlEnter && e.ctrlKey) ||
      (config.submitKey === SubmitKey.ShiftEnter && e.shiftKey) ||
      (config.submitKey === SubmitKey.MetaEnter && e.metaKey) ||
      (config.submitKey === SubmitKey.Enter &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey)
    );
  };

  return {
    submitKey,
    shouldSubmit,
  };
}

function ChatAction(props: {
  text: string;
  icon: JSX.Element;
  onClick: () => void;
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  return (
    <div
      className={`${styles["chat-input-action"]} clickable`}
      onClick={() => {
        props.onClick();
        setTimeout(updateWidth, 1);
      }}
      onMouseEnter={updateWidth}
      onTouchStart={updateWidth}
      style={
        {
          "--icon-width": `${width.icon}px`,
          "--full-width": `${width.full}px`,
        } as React.CSSProperties
      }
    >
      <div ref={iconRef} className={styles["icon"]}>
        {props.icon}
      </div>
      <div className={styles["text"]} ref={textRef}>
        {props.text}
      </div>
    </div>
  );
}

function useScrollToBottom() {
  // for auto-scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  function scrollDomToBottom() {
    const dom = scrollRef.current;
    if (dom) {
      requestAnimationFrame(() => {
        setAutoScroll(true);
        dom.scrollTo(0, dom.scrollHeight);
      });
    }
  }

  // auto scroll
  useEffect(() => {
    if (autoScroll) {
      scrollDomToBottom();
    }
  });

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
  };
}

function _Chat() {
  // type RenderMessage = ChatMessage & { preview?: boolean };
  const config = useAppConfig();
  const chatStore = useChatStore();
  const currentThreadId = chatStore.currentThreadId;
  const navigate = useNavigate();
  const currentThread = useChatStore((state) => state.currentThread())!;
  const fontSize = config.fontSize;
  const asstants = chatStore.assistants;
  const [showExport, setShowExport] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const [creatingMessage, setCreatingMessage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { submitKey, shouldSubmit } = useSubmitHandler();
  const { scrollRef, setAutoScroll, scrollDomToBottom } = useScrollToBottom();
  const [hitBottom, setHitBottom] = useState(true);
  const isMobileScreen = useMobileScreen();

  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder>();
  const [audioBlob, setAudioBlob] = useState<Blob>();
  const [transcription, setTranscription] = useState("");

  // auto grow input
  const [inputRows, setInputRows] = useState(2);
  const measure = useDebouncedCallback(
    () => {
      const rows = inputRef.current ? autoGrowTextArea(inputRef.current) : 1;
      const inputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [userInput]);

  // only search prompts when user input is short
  const SEARCH_TEXT_LIMIT = 30;
  const onInput = (text: string) => {
    setUserInput(text);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        setAudioBlob(event.data);
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (error) {
      console.error("Error accessing the microphone", error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const uploadAudioAndTranscribe = async () => {
    if (!audioBlob) return;

    const formData = new FormData();
    formData.append(
      "file",
      new File([audioBlob], "audio.mp3", { type: "audio/mp3" }),
    );
    formData.append("model", "whisper-1");

    try {
      const response = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: formData,
        },
      );

      const data = await response.json();
      setTranscription(data.choices[0].text); // Adjust this according to the actual response structure
    } catch (error) {
      console.error("Error uploading audio and transcribing", error);
    }
  };

  const doSubmit = async (userInput: string) => {
    if (userInput.trim() === "") return;
    localStorage.setItem(LAST_INPUT_KEY, userInput);
    setIsLoading(true);
    setCreatingMessage(true);
    setUserInput("");
    try {
      let message = await chatStore.createMessage(userInput);
      // ... 其他代码
    } catch (error) {
      // 如果有错误，你可能想在这里处理它
    } finally {
      setCreatingMessage(false);
    }
    const assistantId = chatStore.currentAssistantId;
    const threadId = chatStore.currentThreadId;
    let run = await chatStore.createRun(assistantId, threadId);
    let callbackFn = (onNewMessage: ChatGPTMessage) => {
      setIsLoading(false);
      if (!isMobileScreen) inputRef.current?.focus();
      setAutoScroll(true);
    };
    chatStore.loopRetrieveRun(threadId, run.id, callbackFn);
  };

  // check if should send message
  const onRightClick = (e: any, message: ChatGPTMessage) => {
    // copy to clipboard
    const messageText = message.content.find((e) => e.type === "text")?.text
      ?.value;
    if (messageText) {
      if (selectOrCopy(e.currentTarget, messageText)) {
        if (userInput.length === 0) {
          setUserInput(messageText);
        }
        e.preventDefault();
      }
    }
  };

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, currentThread.data.length - CHAT_PAGE_SIZE),
  );

  function setMsgRenderIndex(newIndex: number) {
    newIndex = Math.min(currentThread.data.length - CHAT_PAGE_SIZE, newIndex);
    newIndex = Math.max(0, newIndex);
    _setMsgRenderIndex(newIndex);
  }

  const renderMessages = useMemo(() => {
    const data = currentThread.data
      .concat(
        creatingMessage
          ? ([
              {
                ...createTempChatGPTMessage(currentThreadId, {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: {
                        value: localStorage.getItem(LAST_INPUT_KEY) as string,
                      },
                    },
                  ] as ChatGPTMessageContent[],
                }),
                preview: true,
              },
            ] as ChatGPTMessage[])
          : [],
      )
      .concat(
        isLoading
          ? ([
              {
                ...createTempChatGPTMessage(currentThreadId, {
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: {
                        value: "...",
                      },
                    },
                  ] as ChatGPTMessageContent[],
                  // createAt: new Date().getTime(),
                }),
                preview: true,
              },
            ] as ChatGPTMessage[])
          : [],
      )
      .concat(
        userInput.length > 0 && config.sendPreviewBubble
          ? ([
              {
                ...createTempChatGPTMessage(currentThreadId, {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: {
                        value: userInput,
                      },
                    },
                  ] as ChatGPTMessageContent[],
                }),
                preview: true,
              },
            ] as ChatGPTMessage[])
          : [],
      );
    // console.log("[THREAD_CHAT] rendermessage 3333333333:", data.find(e => !e.createAt)?.id);
    return data;
  }, [
    currentThread.data,
    config.sendPreviewBubble,
    asstants,
    isLoading,
    creatingMessage,
    userInput,
  ]);

  const messages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      renderMessages.length,
    );
    let chatGPTMessages = renderMessages.slice(msgRenderIndex, endRenderIndex);
    // console.log("[THREAD_CHAT] useMemo -------------- :", chatGPTMessages.find(e=> !(e.createAt))?.id)
    return chatGPTMessages;
  }, [msgRenderIndex, renderMessages]);

  const onChatBodyScroll = (e: HTMLElement) => {
    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (isTouchTopEdge && !isTouchBottomEdge) {
      setMsgRenderIndex(prevPageMsgIndex);
    } else if (isTouchBottomEdge) {
      setMsgRenderIndex(nextPageMsgIndex);
    }

    setHitBottom(isHitBottom);
    setAutoScroll(isHitBottom);
  };

  function scrollToBottom() {
    setMsgRenderIndex(currentThread.data.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }

  const clientConfig = useMemo(() => getClientConfig(), []);

  const autoFocus = !isMobileScreen; // wont auto focus on mobile screen
  const showMaxIcon = !isMobileScreen && !clientConfig?.isApp;

  useCommand({
    fill: setUserInput,
    submit: (text) => {
      doSubmit(text);
    },
  });

  // remember unfinished input
  useEffect(() => {
    // try to load from local storage
    const key = UNFINISHED_INPUT(currentThread.id);
    const mayBeUnfinishedInput = localStorage.getItem(key);
    if (mayBeUnfinishedInput && userInput.length === 0) {
      setUserInput(mayBeUnfinishedInput);
      localStorage.removeItem(key);
    }

    const dom = inputRef.current;
    return () => {
      localStorage.setItem(key, dom?.value ?? "");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // if ArrowUp and no userInput, fill with last input
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      setUserInput(localStorage.getItem(LAST_INPUT_KEY) ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e)) {
      doSubmit(userInput);
      e.preventDefault();
    }
  };

  return (
    <div className={styles.chat}>
      <div className="window-header" data-tauri-drag-region>
        {isMobileScreen && (
          <div className="window-actions">
            <div className={"window-action-button"}>
              <IconButton
                icon={<ReturnIcon />}
                bordered
                title={Locale.Chat.Actions.ChatList}
                onClick={() => navigate(Path.Home)}
              />
            </div>
          </div>
        )}

        <div className={`window-header-title ${styles["chat-body-title"]}`}>
          <div
            className={`window-header-main-title ${styles["chat-body-main-title"]}`}
          >
            {currentThread.topic ? currentThread.topic : currentThread.id}
          </div>
          <div className="window-header-sub-title">
            {Locale.Chat.SubTitle(currentThread.data.length)}
          </div>
        </div>
        <div className="window-actions">
          {!isMobileScreen}
          <div className="window-action-button">
            <IconButton
              icon={<ExportIcon />}
              bordered
              title={Locale.Chat.Actions.Export}
              onClick={() => {
                setShowExport(true);
              }}
            />
          </div>
          {showMaxIcon && (
            <div className="window-action-button">
              <IconButton
                icon={config.tightBorder ? <MinIcon /> : <MaxIcon />}
                bordered
                onClick={() => {
                  config.update(
                    (config) => (config.tightBorder = !config.tightBorder),
                  );
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div
        className={styles["chat-body"]}
        ref={scrollRef}
        onScroll={(e) => onChatBodyScroll(e.currentTarget)}
        onMouseDown={() => inputRef.current?.blur()}
        onTouchStart={() => {
          inputRef.current?.blur();
          setAutoScroll(false);
        }}
      >
        {messages.map((message, i) => {
          const isUser = message.role === "user";
          const showActions =
            i > 0 && !(message.preview || message.content.length === 0);
          const showTyping = message.preview || message.streaming;
          const t = message.content.find((e) => e.type === "text")?.text?.value;
          const messageText = t ? t : "";
          // console.log("[THREAD_CHAT] messageCreateAt:", messageCreateAt);
          // console.log("[THREAD_CHAT] messages 2222222222:", messages.find(e => !e.createAt)?.id);
          return (
            <Fragment key={message.id}>
              <div
                className={
                  isUser ? styles["chat-message-user"] : styles["chat-message"]
                }
              >
                <div className={styles["chat-message-container"]}>
                  <div className={styles["chat-message-header"]}>
                    <div className={styles["chat-message-avatar"]}>
                      {isUser ? (
                        <Avatar avatar={config.avatar} />
                      ) : (
                        <Avatar
                          avatar="gpt-bot"
                          model={config.modelConfig.model}
                        />
                      )}
                    </div>

                    {showActions && (
                      <div className={styles["chat-message-actions"]}>
                        <div className={styles["chat-input-actions"]}>
                          <>
                            <ChatAction
                              text={Locale.Chat.Actions.Copy}
                              icon={<CopyIcon />}
                              onClick={() =>
                                copyToClipboard(messageText ? messageText : "")
                              }
                            />
                          </>
                        </div>
                      </div>
                    )}
                  </div>
                  {showTyping && (
                    <div className={styles["chat-message-status"]}>
                      {Locale.Chat.Typing}
                    </div>
                  )}
                  <div className={styles["chat-message-item"]}>
                    {/*<div>{messageText}</div>*/}
                    <Markdown
                      content={messageText}
                      // loading={
                      //     (message.preview || message.streaming) &&
                      //     message.content.length === 0 &&
                      //     !isUser
                      // }
                      onContextMenu={(e) => onRightClick(e, message)}
                      onDoubleClickCapture={() => {
                        if (!isMobileScreen) return;
                        setUserInput(messageText);
                      }}
                      fontSize={fontSize}
                      parentRef={scrollRef}
                      defaultShow={i >= messages.length - 6}
                    />
                  </div>
                  <div className={styles["chat-message-action-date"]}>
                    {getDateStrByStamp(message.createdAt)}
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className={styles["chat-input-panel"]}>
        <div className={styles["chat-input-panel-inner"]}>
          <textarea
            ref={inputRef}
            className={styles["chat-input"]}
            placeholder={Locale.Chat.Input(submitKey)}
            onInput={(e) => onInput(e.currentTarget.value)}
            value={userInput}
            onKeyDown={onInputKeyDown}
            onFocus={scrollToBottom}
            onClick={scrollToBottom}
            rows={inputRows}
            autoFocus={autoFocus}
            style={{
              fontSize: config.fontSize,
            }}
          />
          <IconButton
            icon={creatingMessage ? <LoadingIcon /> : <SendWhiteIcon />}
            text={Locale.Chat.Send}
            className={styles["chat-input-send"]}
            type="primary"
            onClick={() => doSubmit(userInput)}
          />
        </div>
        <button onClick={isRecording ? stopRecording : startRecording}>
          {isRecording ? "Stop Recording" : "Start Recording"}
        </button>
        <button onClick={uploadAudioAndTranscribe} disabled={!audioBlob}>
          Transcribe Audio
        </button>
        {transcription && <p>Transcription: {transcription}</p>}
      </div>

      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}

export function Chat() {
  const chatStore = useChatStore();
  const threadId = chatStore.currentThreadId;
  console.log("chat|", threadId);
  useEffect(() => {
    // 这里的代码会在组件挂载后执行
    console.log("ThreadChat 组件已挂载");

    // 返回一个清理函数，这个函数会在组件卸载前执行
    return () => {
      console.log("ThreadChat 组件将要卸载");
    };
  }, []); // 空依赖数组意味着这个 effect 只会在组件挂载和卸载时运行一次

  // useEffect(() => {
  //     console.log('ThreadChat 组件已挂载或 threadId 变化');
  //
  //     return () => {
  //         console.log('ThreadChat 组件将要卸载或 threadId 变化前的清理');
  //     };
  // }, [threadId]); // sessionIndex 在依赖数组中

  if (!threadId) return;
  return <_Chat key={threadId}></_Chat>;
}
