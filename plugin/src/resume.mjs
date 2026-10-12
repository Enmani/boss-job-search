import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { TaskError } from './domain.mjs';

function redactContacts(text) {
  return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱已隐藏]')
    .replace(/(?:\+\d{1,3}[ -]?)?(?:\d[ -]?){10,13}\d/g, '[电话已隐藏]');
}
async function readText(path) {
  if (!isAbsolute(path)) throw new TaskError('ABSOLUTE_PATH_REQUIRED', '请使用简历的完整本机路径。');
  let info;
  try { info = await stat(path); } catch { throw new TaskError('FILE_NOT_FOUND', '找不到指定文件，请核对路径。'); }
  if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new TaskError('FILE_SIZE', '请使用不超过 10 MB 的简历文件。');
  const extension = extname(path).toLowerCase();
  if (['.md', '.txt'].includes(extension)) return (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
  if (extension === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(await readFile(path)) });
    try { return (await parser.getText()).text; } finally { await parser.destroy(); }
  }
  if (extension === '.docx') {
    const { default: mammoth } = await import('mammoth');
    return (await mammoth.extractRawText({ buffer: await readFile(path) })).value;
  }
  throw new TaskError('FILE_TYPE', '支持 PDF、DOCX、TXT 和 Markdown 简历。');
}
export async function loadResume({path,label,contextPath}) {
  const text = redactContacts(await readText(path)).trim();
  if (text.length < 50) throw new TaskError('RESUME_EMPTY', '简历可读文字不足；扫描版请先转换为可复制文字。');
  if (text.length > 100000) throw new TaskError('RESUME_TOO_LONG', '简历文字过长，请选择简历文件。');
  const contextText = contextPath ? redactContacts(await readText(contextPath)).trim() : '';
  if (contextText.length > 100000) throw new TaskError('CONTEXT_TOO_LONG', '事实资料过长，请先选取相关内容。');
  return {label,sourcePath:path,contextPath:contextPath ?? null,text,contextText};
}
