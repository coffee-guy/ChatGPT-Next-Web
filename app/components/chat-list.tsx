import DeleteIcon from "../icons/delete.svg";
import AddIcon from "../icons/add.svg";

import styles from "./home.module.scss";
import {
  DragDropContext,
  Droppable,
  Draggable,
  OnDragEndResponder,
} from "@hello-pangea/dnd";

import { ChatMessage, useChatStore } from "../store";

import Locale from "../locales";
import { Link, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { MaskAvatar } from "./mask";
import { DEFAULT_MASK_AVATAR, Mask } from "../store/mask";
import { useRef, useEffect, useState } from "react";
import { showConfirm } from "./ui-lib";
import { getDateStrByStamp, useMobileScreen } from "../utils";
import {
  ChatGPTAssistant,
  ChatGPTMessage,
  ChatGPTThread,
} from "@/app/client/platforms/openai";
import React from "react";

export function ChatItem(props: {
  type: string;
  onClick?: () => void;
  onDelete?: () => void;
  title: string;
  count: number;
  time: string;
  selected: boolean;
  id: string;
  index: number;
  narrow?: boolean;
  mask?: Mask;
}) {
  const draggableRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (props.selected && draggableRef.current) {
      draggableRef.current?.scrollIntoView({
        block: "center",
      });
    }
  }, [props.selected]);

  const titleText = `${props.title} (Session)\n${Locale.ChatItem.ChatItemCount(
    props.count,
  )}`;
  return (
    <Draggable draggableId={`${props.id}`} index={props.index}>
      {(provided) => (
        <div
          className={`${styles["chat-item"]} ${
            props.selected && styles["chat-item-selected"]
          }`}
          onClick={props.onClick}
          ref={(ele) => {
            draggableRef.current = ele;
            provided.innerRef(ele);
          }}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          title={titleText}
        >
          {props.narrow ? (
            <div className={styles["chat-item-narrow"]}>
              <div className={styles["chat-item-avatar"] + " no-dark"}>
                <MaskAvatar avatar={DEFAULT_MASK_AVATAR} />
              </div>
              <div className={styles["chat-item-narrow-count"]}>
                {props.count}
              </div>
            </div>
          ) : (
            <>
              <div className={styles["chat-item-title"]}>{props.title}</div>
              <div className={styles["chat-item-info"]}>
                <div className={styles["chat-item-count"]}>
                  {Locale.ChatItem.ChatItemCount(props.count)}
                </div>
                <div className={styles["chat-item-date"]}>{props.time}</div>
              </div>
            </>
          )}

          <div
            className={styles["chat-item-delete"]}
            onClickCapture={(e) => {
              props.onDelete?.();
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <DeleteIcon />
          </div>
        </div>
      )}
    </Draggable>
  );
}

export function AssistantItem(props: {
  onClick: () => void;
  onDelete: () => void;
  onCreateThread: () => void;
  id: string;
  object: string;
  createdAt: number;
  description?: string;
  model: string;
  instructions?: string;
  name: string;
  tools?: string[];
  fileIds?: string[];
  threads?: ChatGPTThread[];
  index: number;
  narrow?: boolean;
}) {
  // console.log("[CHAT-LIST] AssistantItem:",props)

  const draggableRef = useRef<HTMLDivElement | null>(null);
  const createdDataStr = getDateStrByStamp(props.createdAt);
  useEffect(() => {
    if (draggableRef.current) {
      draggableRef.current?.scrollIntoView({
        block: "center",
      });
    }
  }, []);

  const titleText = `${props.name}\n${Locale.ChatItem.ThreadItemCount(
    props.threads ? props.threads.length : 0,
  )}`;
  return (
    <Draggable draggableId={`${props.id}`} index={props.index}>
      {(provided) => (
        <div className={`${styles["assistant-container"]}`}>
          <div
            className={`${styles["assistant-item"]} `}
            onClick={props.onClick}
            ref={(ele) => {
              draggableRef.current = ele;
              provided.innerRef(ele);
            }}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            title={titleText}
          >
            {props.narrow ? (
              <div className={styles["chat-item-narrow"]}>
                <div className={styles["chat-item-avatar"] + " no-dark"}>
                  <MaskAvatar avatar={DEFAULT_MASK_AVATAR} />
                </div>
                <div className={styles["chat-item-narrow-count"]}>
                  {props.threads ? props.threads.length : 0}
                </div>
              </div>
            ) : (
              <>
                <div className={styles["chat-item-title"]}>{props.name}</div>
                <div className={styles["chat-item-info"]}>
                  <div className={styles["chat-item-count"]}>
                    {Locale.ChatItem.ThreadItemCount(
                      props.threads ? props.threads.length : 0,
                    )}
                  </div>
                  <div className={styles["chat-item-date"]}>
                    {createdDataStr}
                  </div>
                </div>
              </>
            )}

            <div
              className={styles["assistant-item-delete"]}
              onClickCapture={(e) => {
                console.log("mad7 delete assistant");
                props.onDelete?.();
                // e.preventDefault();
                // e.stopPropagation();
              }}
            >
              <DeleteIcon />
            </div>
          </div>
          <div
            className={styles["chat-item-add"]}
            onClickCapture={(e) => {
              console.log("mad7 add thread");
              props.onCreateThread?.();
            }}
          >
            <AddIcon />
          </div>
        </div>
      )}
    </Draggable>
  );
}

export function ThreadItem(props: {
  onClick: () => void;
  onDelete: () => void;
  id: string;
  object: string;
  createdAt: number;
  selected: boolean;
  index: number;
  narrow?: boolean;
  messagesList?: ChatGPTMessage[];
}) {
  // console.log("[CHAT-LIST] ThreadItem:",props)
  const draggableRef = useRef<HTMLDivElement | null>(null);
  const createdDataStr = getDateStrByStamp(props.createdAt);
  useEffect(() => {
    if (props.selected && draggableRef.current) {
      draggableRef.current?.scrollIntoView({
        block: "center",
      });
    }
  }, [props.selected]);

  const titleText = `${props.id}\n${Locale.ChatItem.ChatItemCount(
    props.messagesList ? props.messagesList.length : 0,
  )}`;
  return (
    <Draggable draggableId={`${props.id}`} index={props.index}>
      {(provided) => (
        <div
          className={`${styles["chat-item"]} ${
            props.selected && styles["chat-item-selected"]
          }`}
          onClick={props.onClick}
          ref={(ele) => {
            draggableRef.current = ele;
            provided.innerRef(ele);
          }}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          title={titleText}
        >
          {props.narrow ? (
            <div className={styles["chat-item-narrow"]}>
              <div className={styles["chat-item-avatar"] + " no-dark"}>
                <MaskAvatar avatar={DEFAULT_MASK_AVATAR} />
              </div>
              <div className={styles["chat-item-narrow-count"]}>
                {props.messagesList ? props.messagesList.length : 0}
              </div>
            </div>
          ) : (
            <>
              <div className={styles["chat-item-title"]}>{props.id}</div>
              <div className={styles["chat-item-info"]}>
                <div className={styles["chat-item-count"]}>
                  {Locale.ChatItem.ChatItemCount(
                    props.messagesList ? props.messagesList.length : 0,
                  )}
                </div>
                <div className={styles["chat-item-date"]}>{createdDataStr}</div>
              </div>
            </>
          )}

          <div
            className={styles["chat-item-delete"]}
            onClickCapture={(e) => {
              console.log("mad7 delete thread");
              props.onDelete?.();
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <DeleteIcon />
          </div>
        </div>
      )}
    </Draggable>
  );
}

// 定义一个类型来表示展开状态的对象，其中键是字符串，值是布尔类型
type ExpandedAssistants = {
  [key: string]: boolean;
};

export function ChatList(props: {
  narrow?: boolean;
  onTabChange?: (arg: string) => void;
}) {
  const [
    sessions,
    selectedSessionIndex,
    selectSession,
    moveSession,
    assistants,
    selectThread,
    currentThreadId,
  ] = useChatStore((state) => [
    state.sessions,
    state.currentSessionIndex,
    state.selectSession,
    state.moveSession,
    state.assistants,
    state.selectThread,
    state.currentThreadId,
  ]);

  const chatStore = useChatStore();
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();

  // 定义一个状态变量来存储当前选中的Tab
  const [activeTab, setActiveTab] = useState("session");

  // 使用一个对象来跟踪每个助手的展开状态
  const [expandedAssistants, setExpandedAssistants] =
    useState<ExpandedAssistants>({});

  // 切换助手的展开/收起状态
  const toggleAssistant = (id: string) => {
    setExpandedAssistants((prevExpanded) => ({
      ...prevExpanded,
      [id]: !prevExpanded[id],
    }));
  };

  // Tab切换的处理函数
  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    props.onTabChange?.(tabId);
  };

  const onDragEnd: OnDragEndResponder = (result) => {
    const { destination, source } = result;
    if (!destination) {
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    moveSession(source.index, destination.index);
  };

  return (
    <>
      {/* Tab组件 */}
      <div className={styles.tabs}>
        <div
          className={`${styles.tab} ${
            activeTab === "session" ? styles.active : ""
          }`}
          onClick={() => handleTabClick("session")}
        >
          会话
        </div>
        <div
          className={`${styles.tab} ${
            activeTab === "assistant" ? styles.active : ""
          }`}
          onClick={() => handleTabClick("assistant")}
        >
          Assistant
        </div>
      </div>

      {/* 根据选中的Tab渲染对应的列表 */}
      {activeTab === "session" ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="chat-list">
            {(provided) => (
              <div
                className={styles["chat-list"]}
                ref={provided.innerRef}
                {...provided.droppableProps}
              >
                {sessions.map((item, i) => (
                  <ChatItem
                    type={"session"}
                    title={item.topic}
                    time={new Date(item.lastUpdate).toLocaleString()}
                    count={item.messages.length}
                    key={item.id}
                    id={item.id}
                    index={i}
                    selected={i === selectedSessionIndex}
                    onClick={() => {
                      navigate(Path.Chat);
                      selectSession(i);
                    }}
                    onDelete={async () => {
                      if (
                        (!props.narrow && !isMobileScreen) ||
                        (await showConfirm(Locale.Home.DeleteChat))
                      ) {
                        chatStore.deleteSession(i);
                      }
                    }}
                    narrow={props.narrow}
                    mask={item.mask}
                  />
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="chat-list">
            {(provided) => (
              <div
                className={styles["chat-list"]}
                ref={provided.innerRef}
                {...provided.droppableProps}
              >
                {assistants.map(
                  (assistantItem: ChatGPTAssistant, assistantIdx) => {
                    return (
                      <React.Fragment key={assistantItem.id}>
                        <div>
                          <AssistantItem
                            name={assistantItem.name}
                            createdAt={assistantItem.createdAt}
                            key={assistantItem.id}
                            id={assistantItem.id}
                            threads={assistantItem.threads}
                            index={assistantIdx}
                            object={assistantItem.object}
                            model={assistantItem.model}
                            tools={assistantItem.tools}
                            fileIds={assistantItem.fileIds}
                            description={assistantItem.description}
                            instructions={assistantItem.instructions}
                            // selected={assistantIdx === selectedSessionIndex}
                            onClick={() => {
                              toggleAssistant(assistantItem.id);
                            }}
                            onDelete={async () => {
                              if (
                                await showConfirm(Locale.Home.DeleteAssistant)
                              ) {
                                console.log("[CHATLIST] deleteAssistant");
                                chatStore.deleteAssistant(assistantItem);
                              }
                            }}
                            onCreateThread={async () => {
                              chatStore.createThread(assistantItem);
                              //展开tab item
                              setExpandedAssistants((prevExpanded) => ({
                                ...prevExpanded,
                                [assistantItem.id]: true,
                              }));
                            }}
                            narrow={props.narrow}
                          />
                        </div>
                        {expandedAssistants[assistantItem.id] &&
                          assistantItem.threads && (
                            <div className={styles["sub-list"]}>
                              {/* 这里渲染子列表 */}
                              {assistantItem.threads.map(
                                (thread: ChatGPTThread, threadIdx) => (
                                  <React.Fragment key={thread.id}>
                                    <div>
                                      <ThreadItem
                                        key={thread.id}
                                        id={thread.id}
                                        index={threadIdx}
                                        createdAt={thread.createdAt}
                                        object={thread.object}
                                        selected={thread.id === currentThreadId}
                                        messagesList={thread.data}
                                        // messagesList={assistantItem.threads}
                                        onClick={() => {
                                          navigate(Path.ThreadChat);
                                          selectThread(
                                            assistantItem.id,
                                            thread.id,
                                          );
                                        }}
                                        onDelete={async () => {
                                          chatStore.deleteThread(
                                            assistantItem.id,
                                            thread.id,
                                            () => {
                                              handleTabClick("session");
                                              navigate(Path.Chat);
                                            },
                                          );
                                        }}
                                        narrow={props.narrow}
                                      />
                                    </div>
                                  </React.Fragment>
                                ),
                              )}
                            </div>
                          )}
                      </React.Fragment>
                    );
                  },
                )}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </>
  );
}
