import React, { useState } from "react";
import styles from "./file-manager.module.scss";
import { ErrorBoundary } from "@/app/components/error";
import { IconButton } from "@/app/components/button";
import DeleteIcon from "@/app/icons/delete.svg";
import AddIcon from "@/app/icons/add.svg";
import { useNavigate } from "react-router-dom";
import { useAppConfig, useChatStore } from "@/app/store";
import { useAllModels } from "@/app/utils/hooks";
import { ChatGPTFile } from "@/app/client/platforms/openai";
import Locale from "@/app/locales";
import CloseIcon from "@/app/icons/close.svg";
import { Path } from "@/app/constant";
import { getDateStrByStamp } from "@/app/utils";

function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  if (i < 2) {
    // 如果小于1MB，则以KB为单位显示
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  } else {
    // 否则以MB或GB为单位显示
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }
}

export function FileManager() {
  const config = useAppConfig();
  const allModels = useAllModels();
  const chatStore = useChatStore();
  const navigate = useNavigate();
  const files = chatStore.files;

  // TODO: Implement fetchFiles method to load files from the server
  const fetchFiles = async () => {
    // Fetch files and update state
    chatStore.listFiles();
  };

  // TODO: Implement deleteFile method to handle file deletion
  const deleteFile = async (fileId: string) => {
    // Delete file and update state
    chatStore.deleteFile(fileId);
  };

  // TODO: Implement handleFileUpload method to handle file uploads
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Handle file upload and update state
    const file = event.target.files?.[0];
    if (file) {
      chatStore.uploadFile(file);
    }
  };

  // Call fetchFiles on component mount
  React.useEffect(() => {
    fetchFiles();
  }, []);

  return (
    <ErrorBoundary>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">
            {Locale.FileManager.Title}
          </div>
          <div className="window-header-sub-title">
            {Locale.FileManager.SubTitle}
          </div>
        </div>
      </div>
      <div className={styles["file-manager"]}>
        <div className={styles["file-list"]}>
          <div className={styles["file-list-header"]}>
            <span className={styles["column-id"]}>ID</span>
            <span className={styles["column-filename"]}>文件名</span>
            <span className={styles["column-size"]}>大小</span>
            <span className={styles["column-created"]}>创建时间</span>
            <span className={styles["column-actions"]}>操作</span>
          </div>
          {files.map((file, index) => (
            <div key={index} className={styles["file-item"]}>
              <span className={styles["column-id"]}>{file.id}</span>
              <span className={styles["column-filename"]}>{file.filename}</span>
              <span className={styles["column-size"]}>
                {formatBytes(file.bytes)}
              </span>
              <span className={styles["column-created"]}>
                {getDateStrByStamp(file.createdAt)}
              </span>
              <span className={styles["column-actions"]}>
                <IconButton
                  icon={<DeleteIcon />}
                  onClick={() => deleteFile(file.id)}
                  bordered
                />
              </span>
            </div>
          ))}
        </div>
        <div className={styles["pagination"]}>
          {/* TODO: Implement pagination if needed */}
        </div>
        <div className={styles["add-file"]}>
          <input
            type="file"
            id="file-upload"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          <label htmlFor="file-upload">
            <IconButton
              icon={<AddIcon />}
              text={"新增文件"}
              onClick={() => document.getElementById("file-upload")?.click()}
              bordered
            />
          </label>
        </div>
      </div>
    </ErrorBoundary>
  );
}
