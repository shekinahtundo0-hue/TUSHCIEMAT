import { sql } from "drizzle-orm";
import type { StoredAttachment } from "@workspace/db/schema";
import type { Tx } from "../../lib/database";
import type { AppDeps } from "../../lib/deps";
import { badRequest, notFound } from "../../lib/errors";
import {
  ALLOWED_FILE_EXTENSIONS,
  MAX_FILE_BYTES,
  buildObjectPath,
  extensionOf,
  objectPathBelongsTo,
  storageUnavailable,
  validateUploadList,
  type StorageAdapter,
  type UploadLocation,
  type UploadTarget,
} from "../../lib/storage";

type StoredFileInput = { id: string; path: string; name: string; size: number; type: string };

type FileScope = { schoolId: string; classId: string; location: UploadLocation };

/** Storage is optional configuration: every file route answers honestly when it is absent. */
export function requireStorage(deps: AppDeps): StorageAdapter {
  if (!deps.storage) throw storageUnavailable();
  return deps.storage;
}

/** Teachers pass by RLS on their own class rows; staff need the classroom capability in that school. */
export async function assertCanManage(tx: Tx, schoolId: string, classId: string): Promise<void> {
  const allowed = await tx.execute<{ allowed: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM public.school_classes c
      WHERE c.id = ${classId}::uuid
        AND c.school_id = ${schoolId}::uuid
        AND (app_private.has_school_capability(c.school_id, 'classroom.manage')
             OR app_private.teaches_class(c.id))
    ) AS allowed
  `);
  if (!allowed.rows[0]?.allowed) throw notFound("Class not found in your classroom.");
}

export async function createUploadTargets(
  storage: StorageAdapter,
  scope: FileScope,
  declared: Array<{ name: string; size: number; type: string }>,
): Promise<UploadTarget[]> {
  return Promise.all(
    validateUploadList(declared).map(async (file) => {
      const path = buildObjectPath(scope.schoolId, scope.classId, scope.location, file.id, file);
      const { uploadUrl, headers, expiresAt } = await storage.uploadTarget(path, file.type);
      return { ...file, path, method: "PUT" as const, uploadUrl, headers, expiresAt };
    }),
  );
}

/**
 * Turns client-declared files into storable metadata. A file is only accepted once
 * storage reports the object, so metadata can never claim an upload that failed.
 */
export async function confirmStoredFiles(
  storage: StorageAdapter,
  scope: FileScope,
  files: StoredFileInput[],
): Promise<StoredAttachment[]> {
  if (files.length > 10) throw badRequest("Attach up to 10 files at a time.", "too_many_files");
  const confirmed: StoredAttachment[] = [];
  for (const file of files) {
    if (!objectPathBelongsTo(file.path, scope.schoolId, scope.classId, scope.location)) {
      throw badRequest(`"${file.name}" was not uploaded for this class.`, "invalid_file_path");
    }
    if (!ALLOWED_FILE_EXTENSIONS.includes(extensionOf(file.path))) {
      throw badRequest(`"${file.name}" is not a supported format.`, "unsupported_file_type");
    }
    const object = await storage.confirm(file.path);
    if (!object || object.size <= 0) {
      throw badRequest(
        `"${file.name}" never reached storage. Upload it again before saving.`,
        "upload_incomplete",
      );
    }
    if (object.size > MAX_FILE_BYTES) {
      throw badRequest(`"${file.name}" is larger than the allowed size.`, "file_too_large");
    }
    confirmed.push({
      id: file.id,
      path: file.path,
      name: file.name.trim().slice(0, 250),
      // Storage decides the size, not the browser's declaration.
      size: object.size,
      type: object.contentType ?? file.type,
    });
  }
  return confirmed;
}

export function findAttachment(attachments: StoredAttachment[], fileId: string): StoredAttachment {
  const found = attachments.find((file) => file.id === fileId);
  if (!found) throw notFound("That file is not attached here.");
  return found;
}

/** Drops files a record no longer references; cleanup trouble must not block saving. */
export async function discard(
  storage: StorageAdapter,
  keep: StoredAttachment[],
  previous: StoredAttachment[],
): Promise<void> {
  const kept = new Set(keep.map((file) => file.path));
  const orphaned = previous.filter((file) => !kept.has(file.path)).map((file) => file.path);
  if (orphaned.length === 0) return;
  try {
    await storage.remove(orphaned);
  } catch {
    // The metadata change is what the user asked for; orphaned objects stay retryable.
  }
}
