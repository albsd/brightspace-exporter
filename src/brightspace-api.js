export class APIError extends Error {
  constructor(status, path) {
    super(`D2L API ${status} at ${path}`);
    this.status = status;
    this.path = path;
  }
}

export class BrightspaceAPI {
  constructor(institutionUrl, { lpVersion = '1.28', leVersion = '1.68' } = {}) {
    this.base = institutionUrl.startsWith('http')
      ? institutionUrl.replace(/\/$/, '')
      : `https://${institutionUrl}`;
    this.lp = lpVersion;
    this.le = leVersion;
  }

  async _fetch(path) {
    const res = await fetch(`${this.base}${path}`, { credentials: 'include' });
    if (!res.ok) throw new APIError(res.status, path);
    return res.json();
  }

  // Returns [{ orgUnitId, name, code }]
  async getEnrollments() {
    const data = await this._fetch(
      `/d2l/api/lp/${this.lp}/enrollments/myenrollments/?pageSize=100&orgUnitTypeId=3`
    );
    return (data.Items || []).map(item => ({
      orgUnitId: String(item.OrgUnit.Id),
      name: item.OrgUnit.Name,
      code: item.OrgUnit.Code,
    }));
  }

  // Returns the raw TOC object: { Modules: [...] }
  // Each Module has { ModuleId, Title, Modules: [], Topics: [] }
  // Each Topic has { TopicId, Title, Url, TypeIdentifier, MimeType }
  async getContentTOC(orgUnitId) {
    return this._fetch(`/d2l/api/le/${this.le}/${orgUnitId}/content/toc`);
  }

  // Returns [{ id, name, instructions, attachments: [{ fileId, fileName }] }]
  async getAssignmentFolders(orgUnitId) {
    const folders = await this._fetch(
      `/d2l/api/le/${this.le}/${orgUnitId}/dropbox/folders/`
    );
    return (folders || []).map(f => ({
      id: String(f.Id),
      name: f.Name,
      instructions: f.CustomInstructions?.Html || '',
      attachments: (f.Attachments || []).map(a => ({
        fileId: String(a.FileId),
        fileName: a.FileName,
      })),
    }));
  }

  async downloadBlob(url) {
    const fullUrl = url.startsWith('http') ? url : `${this.base}${url}`;
    const res = await fetch(fullUrl, { credentials: 'include' });
    if (!res.ok) throw new APIError(res.status, url);
    return res.blob();
  }

  assignmentAttachmentUrl(orgUnitId, folderId, fileId) {
    return `${this.base}/d2l/api/le/${this.le}/${orgUnitId}/dropbox/folders/${folderId}/attachments/${fileId}`;
  }
}
