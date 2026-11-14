import APIClient, { apiClient } from 'App/api_client';

interface RecordingData {
  name: string;
  duration: number;
  sessionId: string;
}

interface FetchFilter {
  page: number;
  limit: number;
  order: 'asc' | 'desc';
  query: string;
  startTimestamp: number;
  endTimestamp: number;
  userId?: string;
}

export interface IRecord {
  createdAt: number;
  createdBy: string;
  duration: number;
  name: string;
  recordId: number;
  sessionId: number | string; // modify lee 2026.11.14 接口按字符串返回会话号（原为 number）
  userId: number;
  URL?: string;
}

export default class RecordingsService {
  private client: APIClient;

  constructor(client?: APIClient) {
    this.client = client || apiClient;
  }

  initClient(client?: APIClient) {
    this.client = client || apiClient;
  }

  reserveUrl(
    siteId: string,
    recordingData: RecordingData,
  ): Promise<{ URL: string; key: string }> {
    return this.client
      .put(`/${siteId}/assist/save`, recordingData)
      .then((r) => r.json().then((j) => j.data));
  }

  saveFile(url: string, file: Blob) {
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/webm' },
      body: file,
    }).then(() => true);
  }

  confirmFile(
    siteId: string,
    recordingData: RecordingData,
    key: string,
  ): Promise<any> {
    return this.client
      .put(`/${siteId}/assist/save/done`, { ...recordingData, key })
      .then((r) => r.json().then((j) => j.data));
  }

  fetchRecordings(filters: FetchFilter): Promise<any> {
    return this.client
      .post('/assist/records', filters)
      .then((r) => r.json().then((j) => j.data));
  }

  fetchRecording(id: number | string): Promise<IRecord> {
    return this.client
      .get(`/assist/records/${id}`)
      .then((r) => r.json().then((j) => j.data));
  }

  updateRecordingName(id: number, name: string): Promise<IRecord> {
    return this.client
      .post(`/assist/records/${id}`, { name })
      .then((r) => r.json().then((j) => j.data));
  }

  deleteRecording(id: number): Promise<any> {
    return this.client
      .delete(`/assist/records/${id}`)
      .then((r) => r.json().then((j) => j.data));
  }

  // add lee 2026.11.14 Sessions 列表录像按钮：一页会话号批量查录像，返回 {会话号: [录像…]}
  fetchRecordingsBySessions(
    sessionIds: string[],
  ): Promise<Record<string, IRecord[]>> {
    return this.client
      .post('/assist/records/by-sessions', { sessionIds })
      .then((r) => r.json().then((j) => j.data || {}));
  }
  // end

  // add lee 2026.11.14 边录边传：开始 / 传一段 / 完成 / 放弃（后端 api/routers/subs/pg_assist_records.py）
  // 返回 {data} 或 {errors}；调用方按 errors 判断失败
  private pgUploadCall(path: string, body?: any): Promise<any> {
    return this.client.post(path, body).then((r) =>
      r.json().then((j) => {
        if (!r.ok || j.errors) throw new Error((j.errors || [r.status]).join(','));
        return j.data;
      }),
    );
  }

  startUpload(
    siteId: string,
    data: { name: string; sessionId: string },
  ): Promise<{ recordId: number }> {
    return this.pgUploadCall(`/${siteId}/assist/upload/start`, data);
  }

  uploadPart(siteId: string, recordId: number, partNumber: number, blob: Blob) {
    return this.pgUploadCall(
      `/${siteId}/assist/upload/${recordId}/part/${partNumber}`,
      blob,
    );
  }

  completeUpload(siteId: string, recordId: number, duration: number) {
    return this.pgUploadCall(`/${siteId}/assist/upload/${recordId}/complete`, {
      duration,
    });
  }

  // 页面关闭 / 刷新时：只发一个很小的“完成”指令，浏览器在页面离开后仍会发完（keepalive）
  completeUploadOnLeave(siteId: string, recordId: number, duration: number) {
    void this.client
      .post(
        `/${siteId}/assist/upload/${recordId}/complete`,
        { duration },
        { clean: true, keepalive: true },
      )
      .catch(() => undefined);
  }

  abortUpload(siteId: string, recordId: number) {
    return this.pgUploadCall(`/${siteId}/assist/upload/${recordId}/abort`, {});
  }
  // end

  triggerExport = async (
    sessionId: string,
  ): Promise<{ data: { status: string } }> => {
    return this.client
      .post(`/v2/PROJECT_ID/session-videos`, { sessionId })
      .then((r) => r.json());
  };

  getExports = async (
    params: Record<string, any>,
  ): Promise<ExportsResponse> => {
    return this.client
      .get(`/v2/PROJECT_ID/session-videos`, params)
      .then((r) => r.json());
  };

  getDownloadLink = async (sessionId: string): Promise<{ data: string }> => {
    return this.client
      .get(`/v2/PROJECT_ID/session-videos/${sessionId}`)
      .then((r) => r.json());
  };

  deleteVideo = async (sessionId: string) => {
    return this.client
      .delete(`/v2/PROJECT_ID/session-videos/${sessionId}`)
      .then((r) => r.json());
  };
}

export interface ExportsResponse {
  data: {
    videos: {
      sessionId: string;
      projectId: number;
      userId: number;
      fileUrl: string;
      status: string;
      jobId: string;
      createdAt: number;
      modifiedAt: number;
      userName: string;
    }[];
    total: number;
  };
}
