import { getDb } from '../db/index.js';

export interface FolderRow {
  id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  description: string | null;
  division_id: number | null;
  division_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  document_count: number;
  child_count: number;
  created_at: string;
}

export interface DocumentRow {
  id: number;
  name: string;
  stored_name: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  checksum: string;
  folder_id: number | null;
  folder_name: string | null;
  entity_type: string | null;
  entity_id: number | null;
  category: string;
  description: string | null;
  division_id: number | null;
  division_name: string | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  download_count: number;
  latitude: string | null;
  longitude: string | null;
  captured_at: string | null;
  created_at: string;
}

const FOLDER_SELECT = `
  SELECT f.id, f.name, f.parent_id, p.name AS parent_name, f.description,
         f.division_id, d.name AS division_name,
         f.created_by, u.full_name AS created_by_name, f.created_at,
         (SELECT COUNT(*) FROM documents doc WHERE doc.folder_id = f.id) AS document_count,
         (SELECT COUNT(*) FROM document_folders c WHERE c.parent_id = f.id) AS child_count
    FROM document_folders f
    LEFT JOIN document_folders p ON p.id = f.parent_id
    LEFT JOIN divisions d ON d.id = f.division_id
    LEFT JOIN users u ON u.id = f.created_by`;

const DOCUMENT_SELECT = `
  SELECT doc.id, doc.name, doc.stored_name, doc.mime_type, doc.extension, doc.size_bytes,
         doc.checksum, doc.folder_id, f.name AS folder_name, doc.entity_type, doc.entity_id,
         doc.category, doc.description, doc.division_id, d.name AS division_name,
         doc.uploaded_by, u.full_name AS uploaded_by_name, doc.download_count,
         doc.latitude, doc.longitude, doc.captured_at, doc.created_at
    FROM documents doc
    LEFT JOIN document_folders f ON f.id = doc.folder_id
    LEFT JOIN divisions d ON d.id = doc.division_id
    LEFT JOIN users u ON u.id = doc.uploaded_by`;

// --- Folders ---------------------------------------------------------------

export function listFolders(parentId: number | null, divisionId?: number): FolderRow[] {
  const where: string[] = [parentId === null ? 'f.parent_id IS NULL' : 'f.parent_id = ?'];
  const params: unknown[] = parentId === null ? [] : [parentId];
  if (divisionId) {
    where.push('(f.division_id IS NULL OR f.division_id = ?)');
    params.push(divisionId);
  }
  return getDb()
    .prepare(`${FOLDER_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.name`)
    .all(...params) as FolderRow[];
}

/** Every folder the user may see, for the tree and the move-to picker. */
export function listAllFolders(divisionId?: number): FolderRow[] {
  const clause = divisionId ? 'WHERE f.division_id IS NULL OR f.division_id = ?' : '';
  const params = divisionId ? [divisionId] : [];
  return getDb()
    .prepare(`${FOLDER_SELECT} ${clause} ORDER BY f.name`)
    .all(...params) as FolderRow[];
}

export function findFolder(id: number): FolderRow | null {
  return (
    (getDb().prepare(`${FOLDER_SELECT} WHERE f.id = ?`).get(id) as FolderRow | undefined) ?? null
  );
}

export function insertFolder(values: {
  name: string;
  parent_id: number | null;
  description: string | null;
  division_id: number | null;
  created_by: number;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO document_folders (name, parent_id, description, division_id, created_by)
       VALUES (@name, @parent_id, @description, @division_id, @created_by)`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

export function updateFolder(
  id: number,
  values: { name?: string; description?: string | null; parent_id?: number | null },
): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    sets.push(`${key} = @${key}`);
    params[key] = value;
  }
  if (!sets.length) return;
  getDb()
    .prepare(`UPDATE document_folders SET ${sets.join(', ')} WHERE id = @id`)
    .run(params);
}

export function deleteFolder(id: number): void {
  getDb().prepare(`DELETE FROM document_folders WHERE id = ?`).run(id);
}

/** Walks up the tree so the client can render a breadcrumb. */
export function folderPath(id: number): { id: number; name: string }[] {
  const rows = getDb()
    .prepare<[number], { id: number; name: string; parent_id: number | null }>(
      `WITH RECURSIVE up(id, name, parent_id, depth) AS (
         SELECT id, name, parent_id, 0 FROM document_folders WHERE id = ?
         UNION ALL
         SELECT f.id, f.name, f.parent_id, up.depth + 1
           FROM document_folders f JOIN up ON f.id = up.parent_id
       )
       SELECT id, name, parent_id FROM up ORDER BY depth DESC`,
    )
    .all(id);
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/** True when `candidate` sits inside `folderId`, used to refuse a cyclic move. */
export function isDescendant(folderId: number, candidate: number): boolean {
  const row = getDb()
    .prepare<[number, number], { n: number }>(
      `WITH RECURSIVE down(id) AS (
         SELECT id FROM document_folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM document_folders f JOIN down ON f.parent_id = down.id
       )
       SELECT COUNT(*) AS n FROM down WHERE id = ?`,
    )
    .get(folderId, candidate);
  return (row?.n ?? 0) > 0;
}

// --- Documents -------------------------------------------------------------

export interface DocumentQuery {
  folderId?: number | null;
  entityType?: string;
  entityId?: number;
  search?: string;
  category?: string;
  divisionId?: number;
  uploadedBy?: number;
  limit: number;
  offset: number;
}

export function listDocuments(query: DocumentQuery): { rows: DocumentRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.folderId === null) where.push('doc.folder_id IS NULL');
  else if (query.folderId !== undefined) {
    where.push('doc.folder_id = ?');
    params.push(query.folderId);
  }
  if (query.entityType) {
    where.push('doc.entity_type = ?');
    params.push(query.entityType);
  }
  if (query.entityId) {
    where.push('doc.entity_id = ?');
    params.push(query.entityId);
  }
  if (query.category) {
    where.push('doc.category = ?');
    params.push(query.category);
  }
  if (query.uploadedBy) {
    where.push('doc.uploaded_by = ?');
    params.push(query.uploadedBy);
  }
  if (query.divisionId) {
    where.push('(doc.division_id IS NULL OR doc.division_id = ?)');
    params.push(query.divisionId);
  }
  if (query.search) {
    where.push('(doc.name LIKE ? OR doc.description LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM documents doc ${clause}`)
      .get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${DOCUMENT_SELECT} ${clause} ORDER BY doc.created_at DESC, doc.id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset) as DocumentRow[];
  return { rows, total };
}

export function findDocument(id: number): DocumentRow | null {
  return (
    (getDb().prepare(`${DOCUMENT_SELECT} WHERE doc.id = ?`).get(id) as DocumentRow | undefined) ??
    null
  );
}

/** Lets an upload of identical bytes reuse the row rather than duplicating it. */
export function findByChecksum(checksum: string, folderId: number | null): DocumentRow | null {
  const clause = folderId === null ? 'doc.folder_id IS NULL' : 'doc.folder_id = ?';
  const params: unknown[] = folderId === null ? [checksum] : [checksum, folderId];
  return (
    (getDb()
      .prepare(`${DOCUMENT_SELECT} WHERE doc.checksum = ? AND ${clause}`)
      .get(...params) as DocumentRow | undefined) ?? null
  );
}

export function insertDocument(values: {
  name: string;
  stored_name: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  checksum: string;
  folder_id: number | null;
  entity_type: string | null;
  entity_id: number | null;
  category: string;
  description: string | null;
  division_id: number | null;
  uploaded_by: number;
  latitude?: string | null;
  longitude?: string | null;
  captured_at?: string | null;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO documents
         (name, stored_name, mime_type, extension, size_bytes, checksum, folder_id,
          entity_type, entity_id, category, description, division_id, uploaded_by,
          latitude, longitude, captured_at)
       VALUES
         (@name, @stored_name, @mime_type, @extension, @size_bytes, @checksum, @folder_id,
          @entity_type, @entity_id, @category, @description, @division_id, @uploaded_by,
          @latitude, @longitude, @captured_at)`,
    )
    .run({ latitude: null, longitude: null, captured_at: null, ...values });
  return Number(result.lastInsertRowid);
}

export function updateDocument(
  id: number,
  values: { name?: string; description?: string | null; folder_id?: number | null; category?: string },
): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    sets.push(`${key} = @${key}`);
    params[key] = value;
  }
  if (!sets.length) return;
  getDb().prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function deleteDocument(id: number): void {
  getDb().prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

export function recordDownload(id: number): void {
  getDb().prepare(`UPDATE documents SET download_count = download_count + 1 WHERE id = ?`).run(id);
}

/** True when any other row still points at the same stored file. */
export function isStoredFileShared(storedName: string, exceptId: number): boolean {
  const row = getDb()
    .prepare<[string, number], { n: number }>(
      `SELECT COUNT(*) AS n FROM documents WHERE stored_name = ? AND id <> ?`,
    )
    .get(storedName, exceptId);
  return (row?.n ?? 0) > 0;
}

export function storageSummary(): { totalFiles: number; totalBytes: number } {
  const row = getDb()
    .prepare<[], { files: number; bytes: number | null }>(
      `SELECT COUNT(*) AS files, SUM(size_bytes) AS bytes FROM documents`,
    )
    .get();
  return { totalFiles: row?.files ?? 0, totalBytes: row?.bytes ?? 0 };
}
