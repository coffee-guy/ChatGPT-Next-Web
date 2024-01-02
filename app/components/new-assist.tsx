import React, { useState } from "react";
import styles from "./new-assist.module.scss";
import { ErrorBoundary } from "@/app/components/error";
import Locale, {
  ALL_LANG_OPTIONS,
  AllLangs,
  changeLang,
  getLang,
} from "@/app/locales";
import { IconButton } from "@/app/components/button";
import CloseIcon from "@/app/icons/close.svg";
import {
  Azure,
  OPENAI_BASE_URL,
  Path,
  ServiceProvider,
  SlotID,
} from "@/app/constant";
import {
  List,
  ListItem,
  PasswordInput,
  Popover,
  Select,
} from "@/app/components/ui-lib";
import {
  ModalConfigValidator,
  ModelConfig,
  SubmitKey,
  Theme,
  useAppConfig,
  useChatStore,
} from "@/app/store";
import { useNavigate } from "react-router-dom";
import { useAllModels } from "../utils/hooks";
import SendWhiteIcon from "@/app/icons/send-white.svg";

export function CreateNewAssistant() {
  const config = useAppConfig();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instruction, setInstruction] = useState(
    "As an academic researcher with a Ph.D. in Machine Learning and Deep Learning, I specialize in NLP research and development. I frequently read numerous papers on the most cutting-edge NLP technologies and algorithms, such as Transformers, ChatGPT, LLaMa, and others.Your role will be that of a supportive research assistant. All your answers must be grounded in the papers that I have provided. Before responding to my inquiries, you will meticulously review the papers and, if necessary, reference the original content within them. Should you be unable to find an answer to my questions on the first attempt, you will employ multiple strategies to gather the required information. Please keep me informed of your progress, including any alternative methods you are exploring.",
  );
  const [model, setModel] = useState(config.modelConfig.model as string);
  const [tools, setTools] = useState<string[]>([]);
  const [fileIds, setFileIds] = useState("");
  const allModels = useAllModels();
  const chatStore = useChatStore();

  // const [file, setFile] = useState<File | null>(null);
  const navigate = useNavigate();

  // 处理复选框变化的函数
  const handleCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { checked, value } = event.target;

    if (checked) {
      // 如果复选框被选中，将其值添加到tools数组中
      setTools([...tools, value]);
    } else {
      // 如果复选框被取消选中，将其值从tools数组中移除
      setTools(tools.filter((tool) => tool !== value));
    }
  };
  const handleSubmit = async () => {
    // Handle form submission logic here
    console.log({ name, description, instruction, model, tools, fileIds });
    const toolsParam: { type: string }[] = tools.map((item) => ({
      type: item,
    }));

    const newAssist = {
      name: name,
      description: description,
      instructions: instruction,
      model: model,
      fileIds: fileIds ? fileIds.split(",") : [],
      tools: toolsParam,
    };

    chatStore.createAssistant(newAssist);
  };

  const handleCancel = () => {
    // Handle cancel logic here
  };

  return (
    <ErrorBoundary>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">
            {Locale.Assistant.Create.Title}
          </div>
          <div className="window-header-sub-title">
            {Locale.Assistant.Create.SubTitle}
          </div>
        </div>
        <div className="window-actions">
          <div className="window-action-button"></div>
          <div className="window-action-button"></div>
          <div className="window-action-button">
            <IconButton
              icon={<CloseIcon />}
              onClick={() => navigate(Path.Home)}
              bordered
            />
          </div>
        </div>
      </div>
      <div className={styles["settings"]}>
        <>
          <ListItem
            title={Locale.Assistant.Name.Title}
            // subTitle={Locale.Settings.MaxTokens.SubTitle}
          >
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            ></input>
          </ListItem>
          <ListItem
            title={Locale.Assistant.Description.Title}
            // subTitle={Locale.Settings.MaxTokens.SubTitle}
          >
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            ></input>
          </ListItem>

          <ListItem
            title={Locale.Assistant.Instruction.Title}
            subTitle={Locale.Assistant.Instruction.SubTitle}
          >
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            ></input>
          </ListItem>

          <ListItem
            title={Locale.Assistant.Files.Title}
            subTitle={Locale.Assistant.Files.SubTitle}
          >
            <input
              type="text"
              value={fileIds}
              onChange={(e) => setFileIds(e.target.value)}
            ></input>
          </ListItem>

          <ListItem title={Locale.Settings.Model}>
            <Select
              className={styles["form-select"]}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {/* TODO: Configure model options here */}
              {allModels
                .filter((v) => v.available)
                .map((v, i) => (
                  <option value={v.name} key={i}>
                    {v.displayName}
                  </option>
                ))}
            </Select>
          </ListItem>

          <ListItem title={Locale.Assistant.Tools.Title}>
            <div className={styles["form-checkbox-group"]}>
              <input
                type="checkbox"
                value="code_interpreter"
                className={styles["form-checkbox"]}
                onChange={handleCheckboxChange}
              />
              <label>code_interpreter</label>
              <input
                type="checkbox"
                value="retrieval"
                className={styles["form-checkbox"]}
                onChange={handleCheckboxChange}
              />
              <label>retrieval</label>
            </div>
          </ListItem>
        </>
      </div>
      <IconButton
        icon={<SendWhiteIcon />}
        text={"确定"}
        className={styles["chat-input-send"]}
        type="primary"
        onClick={() => {
          handleSubmit();
        }}
      />
    </ErrorBoundary>
  );
}
