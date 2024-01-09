import { useAccessStore, useAppConfig, useChatStore } from "../store";
import { useMaskStore } from "../store/mask";
import { usePromptStore } from "../store/prompt";
import { StoreKey } from "../constant";
import { merge } from "./merge";
import { ChatSession } from "@/app/client/api";
import {ChatGPTAssistant, ChatGPTThread} from "@/app/client/platforms/openai";

type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
}[keyof T];
type NonFunctionFields<T> = Pick<T, NonFunctionKeys<T>>;

export function getNonFunctionFileds<T extends object>(obj: T) {
  const ret: any = {};

  Object.entries(obj).map(([k, v]) => {
    if (typeof v !== "function") {
      ret[k] = v;
    }
  });

  return ret as NonFunctionFields<T>;
}

export type GetStoreState<T> = T extends { getState: () => infer U }
  ? NonFunctionFields<U>
  : never;

const LocalStateSetters = {
  [StoreKey.Chat]: useChatStore.setState,
  [StoreKey.Access]: useAccessStore.setState,
  [StoreKey.Config]: useAppConfig.setState,
  [StoreKey.Mask]: useMaskStore.setState,
  [StoreKey.Prompt]: usePromptStore.setState,
} as const;

const LocalStateGetters = {
  [StoreKey.Chat]: () => getNonFunctionFileds(useChatStore.getState()),
  [StoreKey.Access]: () => getNonFunctionFileds(useAccessStore.getState()),
  [StoreKey.Config]: () => getNonFunctionFileds(useAppConfig.getState()),
  [StoreKey.Mask]: () => getNonFunctionFileds(useMaskStore.getState()),
  [StoreKey.Prompt]: () => getNonFunctionFileds(usePromptStore.getState()),
} as const;

export type AppState = {
  [k in keyof typeof LocalStateGetters]: ReturnType<
    (typeof LocalStateGetters)[k]
  >;
};

type Merger<T extends keyof AppState, U = AppState[T]> = (
  localState: U,
  remoteState: U,
) => U;

type StateMerger = {
  [K in keyof AppState]: Merger<K>;
};

// we merge remote state to local state
const MergeStates: StateMerger = {
  [StoreKey.Chat]: (localState, remoteState) => {
    // merge sessions
    const localSessions: Record<string, ChatSession> = {};
    localState.sessions.forEach((s) => (localSessions[s.id] = s));

    remoteState.sessions.forEach((remoteSession) => {
      // skip empty chats
      if (remoteSession.messages.length === 0) return;

      const localSession = localSessions[remoteSession.id];
      if (!localSession) {
        // if remote session is new, just merge it
        localState.sessions.push(remoteSession);
      } else {
        // if both have the same session id, merge the messages
        const localMessageIds = new Set(localSession.messages.map((v) => v.id));
        remoteSession.messages.forEach((m) => {
          if (!localMessageIds.has(m.id)) {
            localSession.messages.push(m);
          }
        });

        // sort local messages with date field in asc order
        localSession.messages.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      }
    });

    // sort local sessions with date field in desc order
    localState.sessions.sort(
      (a, b) =>
        new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime(),
    );

    //merge assistant
    const localAssistant: Record<string, ChatGPTAssistant> = {};
    localState.assistants.forEach((s) => (localAssistant[s.id] = s));

    remoteState.assistants.forEach((remoteAssis) => {
      // skip empty assistant
      if (remoteAssis.threads.length === 0) return;


      const localAssistantElement = localAssistant[remoteAssis.id];
      if (!localAssistantElement) {
        // if remote assistant is new, just merge it
        localState.assistants.unshift(remoteAssis);
      } else {
        // if both have the same assistant id, merge the threads
        const localThread: Record<string, ChatGPTThread> = {};
        const localThreadIds = new Set()

        localAssistantElement.threads.map((t) => {
          localThread[t.id] = t;
          localThreadIds.add(t.id)
        });

        remoteAssis.threads.forEach((remoteT) => {
          if (!localThreadIds.has(remoteT.id)) {
            //如果远端assistant中thread本地没有,直接插入
            localAssistantElement.threads.unshift(remoteT);
          }else{
            //如果thread存在，则merge 消息
            //先去重,云端缓存如果有bug,重复消息的话这一步去掉
            // 使用Set来记录已经出现过的id
            const seenMessageIds = new Set<string>();

            const uniqueList = remoteT.data.filter(item => {
              if (seenMessageIds.has(item.id)) {
                // 如果id已经出现过，则过滤掉这个元素
                return false;
              } else {
                // 如果id是第一次出现，加入到Set中，并保留这个元素
                seenMessageIds.add(item.id);
                return true;
              }
            });

            const localMessageIds = new Set(localThread[remoteT.id].data.map((v) => v.id));
            uniqueList.forEach((remoteM) => {
              if (!localMessageIds.has(remoteM.id)) {
                //如果远端消息,本地thread的消息没有,直接插入
                localThread[remoteT.id].data.push(remoteM);
              }
            });

            //排序消息
            // sort local messages with date field in asc order
            localThread[remoteT.id].data.sort(
                (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
            );
          }
        });

        // // sort local messages with date field in asc order
        // localSession.messages.sort(
        //     (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        // );
      }
    });

    return localState;
  },
  [StoreKey.Prompt]: (localState, remoteState) => {
    localState.prompts = {
      ...remoteState.prompts,
      ...localState.prompts,
    };
    return localState;
  },
  [StoreKey.Mask]: (localState, remoteState) => {
    localState.masks = {
      ...remoteState.masks,
      ...localState.masks,
    };
    return localState;
  },
  [StoreKey.Config]: mergeWithUpdate<AppState[StoreKey.Config]>,
  [StoreKey.Access]: mergeWithUpdate<AppState[StoreKey.Access]>,
};

export function getLocalAppState() {
  const appState = Object.fromEntries(
    Object.entries(LocalStateGetters).map(([key, getter]) => {
      return [key, getter()];
    }),
  ) as AppState;

  return appState;
}

export function setLocalAppState(appState: AppState) {
  Object.entries(LocalStateSetters).forEach(([key, setter]) => {
    setter(appState[key as keyof AppState]);
  });
}

export function mergeAppState(localState: AppState, remoteState: AppState) {
  Object.keys(localState).forEach(<T extends keyof AppState>(k: string) => {
    const key = k as T;
    const localStoreState = localState[key];
    const remoteStoreState = remoteState[key];
    MergeStates[key](localStoreState, remoteStoreState);
  });

  return localState;
}

/**
 * Merge state with `lastUpdateTime`, older state will be override
 */
export function mergeWithUpdate<T extends { lastUpdateTime?: number }>(
  localState: T,
  remoteState: T,
) {
  const localUpdateTime = localState.lastUpdateTime ?? 0;
  const remoteUpdateTime = localState.lastUpdateTime ?? 1;

  if (localUpdateTime < remoteUpdateTime) {
    merge(remoteState, localState);
    return { ...remoteState };
  } else {
    merge(localState, remoteState);
    return { ...localState };
  }
}
