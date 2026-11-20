import { randomUUID } from "node:crypto";
import { AppError, badRequest } from "./errors";

const MEGABYTE = 1024 * 1024;

/** A classroom file is a document, not a data payload: keep the ceiling explicit. */
export const MAX_FILE_BYTES = 25 * MEGABYTE;
export const MAX_FILES_PER_REQUEST = 10;
export const UPLOAD_TARGET_TTL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type AllowedFileKind = "pdf" | "word" | "powerpoint" | "image" | "spreadsheet" | "text" | "archive";

type FilePolicy = {
  extension: string;
  kind: AllowedFileKind;
  /** Stored in the existing `resource_type` enum so learners can filter by it. */
  resourceType: "pdf" | "docx" | "pptx" | "image" | "spreadsheet" | "text" | "archive";
  mimeTypes: string[];
};

const FILE_POLICIES: FilePolicy[] = [
  { extension: "pdf", kind: "pdf", resourceType: "pdf", mimeTypes: ["application/pdf"] },
  { extension: "doc", kind: "word", resourceType: "docx", mimeTypes: ["application/msword"] },
  {
    extension: "docx",
    kind: "word",
    resourceType: "docx",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  { extension: "ppt", kind: "powerpoint", resourceType: "pptx", mimeTypes: ["application/vnd.ms-powerpoint"] },
  {
    extension: "pptx",
    kind: "powerpoint",
    resourceType: "pptx",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  },
  { extension: "jpg", kind: "image", resourceType: "image", mimeTypes: ["image/jpeg"] },
  { extension: "jpeg", kind: "image", resourceType: "image", mimeTypes: ["image/jpeg"] },
  { extension: "png", kind: "image", resourceType: "image", mimeTypes: ["image/png"] },
  {
    extension: "xls",
    kind: "spreadsheet",
    resourceType: "spreadsheet",
    mimeTypes: ["application/vnd.ms-excel"],
  },
  {
    extension: "xlsx",
    kind: "spreadsheet",
    resourceType: "spreadsheet",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  { extension: "txt", kind: "text", resourceType: "text", mimeTypes: ["text/plain"] },
  {
    extension: "zip",
    kind: "archive",
    resourceType: "archive",
    mimeTypes: ["application/zip", "application/x-zip-compressed", "application/x-zip"],
  },
];

export const ALLOWED_FILE_EXTENSIONS = FILE_POLICIES.map((policy) => policy.extension);
export const ALLOWED_FILE_MIME_TYPES = [...new Set(FILE_POLICIES.flatMap((policy) => policy.mimeTypes))];

/** Lets a stored object decide the learner-facing `resource_type` label. */
export function resourceTypeForExtension(extension: string): FilePolicy["resourceType"] | null {
  return FILE_POLICIES.find((policy) => policy.extension === extension.toLowerCase())?.resourceType ?? null;
}

function policyFor(extension: string, mimeType: string): FilePolicy | null {
  const byExtension = FILE_POLICIES.find((policy) => policy.extension === extension.toLowerCase());
  if (!byExtension) return null;
  const normalised = mimeType.split(";")[0].trim().toLowerCase();
  // Some browsers send an empty type for Office files, so the extension is the fallback.
  if (normalised && !byExtension.mimeTypes.includes(normalised)) return null;
  return byExtension;
}

export type ValidatedUpload = {
  id: string;
  name: string;
  size: number;
  type: string;
  extension: string;
  kind: AllowedFileKind;
  resourceType: FilePolicy["resourceType"];
};

/** Validates one client-declared file. Nothing is trusted from the browser beyond the name. */
export function validateUpload(input: { name: string; size: number; type: string }): ValidatedUpload {
  const name = input.name.trim();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const policy = policyFor(extension, input.type ?? "");
  if (!policy) {
    throw badRequest(
      `"${name || "file"}" is not a supported format. Use PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, JPG, PNG, TXT or ZIP.`,
      "unsupported_file_type",
    );
  }
  if (!Number.isInteger(input.size) || input.size <= 0) {
    throw badRequest(`"${name}" is empty. Choose a file with content.`, "empty_file");
  }
  if (input.size > MAX_FILE_BYTES) {
    throw badRequest(
      `"${name}" is larger than ${Math.round(MAX_FILE_BYTES / MEGABYTE)} MB.`,
      "file_too_large",
    );
  }
  return {
    id: randomUUID(),
    name,
    size: input.size,
    type: policy.mimeTypes[0],
    extension: policy.extension,
    kind: policy.kind,
    resourceType: policy.resourceType,
  };
}

export function validateUploadList(
  files: Array<{ name: string; size: number; type: string }>,
): ValidatedUpload[] {
  if (!Array.isArray(files) || files.length === 0) throw badRequest("Choose at least one file.", "files_required");
  if (files.length > MAX_FILES_PER_REQUEST) {
    throw badRequest(`Attach up to ${MAX_FILES_PER_REQUEST} files at a time.`, "too_many_files");
  }
  return files.map(validateUpload);
}

/** Keeps generated names inside a single safe path segment. */
export function safeObjectName(name: string, extension: string): string {
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${cleaned || "file"}.${extension}`;
}

export type UploadLocation = "resources" | "assignments" | "submissions";

function segment(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, " ");
}

export function buildObjectPath(
  schoolId: string,
  classId: string,
  location: UploadLocation,
  fileId: string,
  file: { name: string; extension: string },
): string {
  return `${segment(schoolId)}/${segment(classId)}/${location}/${fileId}/${safeObjectName(file.name, file.extension)}`;
}

/** True only for a path this school/class generated for the given location. */
export function objectPathBelongsTo(
  path: string,
  schoolId: string,
  classId: string,
  location: UploadLocation,
): boolean {
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\//i.test(path)) return false;
  if (path.includes("..") || path.startsWith("/") || path.includes("//")) return false;
  const [school, klass, place, fileId, name, ...rest] = path.split("/");
  return (
    rest.length === 0 &&
    school.toLowerCase() === schoolId.toLowerCase() &&
    klass.toLowerCase() === classId.toLowerCase() &&
    place === location &&
    /^[a-f0-9-]{36}$/i.test(fileId) &&
    /^[a-z0-9][a-z0-9.-]*$/i.test(name)
  );
}

export type UploadTarget = {
  id: string;
  path: string;
  name: string;
  size: number;
  type: string;
  extension: string;
  kind: AllowedFileKind;
  method: "PUT";
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type StoredObject = {
  id: string;
  path: string;
  name: string;
  size: number;
  type: string;
};

export type DownloadGrant = {
  url: string;
  name: string;
  size: number;
  type: string;
  expiresAt: string;
};

export interface StorageAdapter {
  /** Grants a single-object upload URL. Nothing is recorded until `confirm` succeeds. */
  uploadTarget(
    path: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; headers: Record<string, string>; expiresAt: string }>;
  /** Reads the object back from storage; null means the upload never landed. */
  confirm(path: string): Promise<{ size: number; contentType: string | null } | null>;
  downloadGrant(path: string, name: string, options?: { inline?: boolean }): Promise<DownloadGrant>;
  remove(paths: string[]): Promise<void>;
}

export const storageUnavailable = () =>
  new AppError(503, "storage_unavailable", "File storage has not been configured for this school platform yet.");

type Fetch = (input: string, init?: Record<string, unknown>) => Promise<Response>;

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
}

export function createSupabaseStorage(options: {
  url: string;
  serviceKey: string;
  bucket: string;
  fetchImpl?: Fetch;
}): StorageAdapter {
  const base = `${options.url.replace(/\/+$/, "")}/storage/v1`;
  const bucket = segment(options.bucket);
  const fetchImpl: Fetch = options.fetchImpl ?? ((input, init) => fetch(input, init as RequestInit));
  const auth = { authorization: `Bearer ${options.serviceKey}`, apikey: options.serviceKey };

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      throw new AppError(502, "storage_error", `The file service rejected the request (${response.status}).`);
    }
    return (await response.json().catch(() => ({}))) as Record<string, unknown>;
  }

  function absolute(signedURL: unknown): string {
    if (typeof signedURL !== "string" || !signedURL) {
      throw new AppError(502, "storage_error", "The file service returned no upload or download URL.");
    }
    return signedURL.startsWith("http") ? signedURL : `${options.url.replace(/\/+$/, "")}${signedURL}`;
  }

  return {
    async uploadTarget(path, contentType) {
      const json = await post(
        `/object/upload/sign/${bucket}/${path}?expiresIn=${UPLOAD_TARGET_TTL_SECONDS}`,
        { upsert: false },
      );
      return {
        uploadUrl: absolute(json.signedURL ?? json.url),
        // Supabase matches the object's stored content type against the request header.
        headers: { "content-type": contentType },
        expiresAt: new Date(Date.now() + UPLOAD_TARGET_TTL_SECONDS * 1000).toISOString(),
      };
    },

    async confirm(path) {
      const signed = await post(`/object/sign/${bucket}/${path}`, { expiresIn: 60 });
      const response = await fetchImpl(absolute(signed.signedURL ?? signed.url), { method: "HEAD" });
      if (!response.ok) return null;
      const length = Number(response.headers.get("content-length"));
      return {
        size: Number.isFinite(length) && length > 0 ? length : 0,
        contentType: response.headers.get("content-type"),
      };
    },

    async downloadGrant(path, name, grantOptions) {
      const signed = await post(`/object/sign/${bucket}/${path}`, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
      const url = new URL(absolute(signed.signedURL ?? signed.url));
      if (!grantOptions?.inline) url.searchParams.set("download", name);
      const response = await fetchImpl(url.toString(), { method: "HEAD", headers: auth });
      if (!response.ok) {
        throw new AppError(409, "file_missing", `"${name}" is no longer available in storage.`);
      }
      const length = Number(response.headers.get("content-length"));
      return {
        url: url.toString(),
        name,
        size: Number.isFinite(length) && length > 0 ? length : 0,
        type: response.headers.get("content-type") ?? "application/octet-stream",
        expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      };
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const response = await fetchImpl(`${base}/object/${bucket}`, {
        method: "DELETE",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!response.ok && response.status !== 404) {
        throw new AppError(502, "storage_error", `The file service could not delete the object (${response.status}).`);
      }
    },
  };
}

/** In-memory adapter used by tests; mirrors the real confirm-before-persist contract. */
export function createMemoryStorage(): StorageAdapter & {
  objects: Map<string, { size: number; contentType: string | null }>;
} {
  const objects = new Map<string, { size: number; contentType: string | null }>();
  return {
    objects,
    async uploadTarget(path, contentType) {
      objects.set(path, { size: 0, contentType });
      return {
        uploadUrl: `memory://upload/${path}`,
        headers: { "content-type": contentType },
        expiresAt: new Date(Date.now() + UPLOAD_TARGET_TTL_SECONDS * 1000).toISOString(),
      };
    },
    async confirm(path) {
      const object = objects.get(path);
      return object ? { ...object } : null;
    },
    async downloadGrant(path, name, grantOptions) {
      const object = objects.get(path);
      if (!object) throw new AppError(409, "file_missing", `"${name}" is no longer available in storage.`);
      return {
        url: `memory://${grantOptions?.inline ? "preview" : "download"}/${path}`,
        name,
        size: object.size,
        type: object.contentType ?? "application/octet-stream",
        expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      };
    },
    async remove(paths) {
      for (const path of paths) objects.delete(path);
    },
  };
}

/** Marks a memory-adapter upload as finished so tests can exercise the confirm step. */
export function markUploaded(
  storage: { objects: Map<string, { size: number; contentType: string | null }> },
  path: string,
  size: number,
  contentType: string,
): void {
  storage.objects.set(path, { size, contentType });
}
