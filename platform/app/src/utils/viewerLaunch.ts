import { compressedStudyRoot } from './s3CompressedStudy';

export function validateViewerLaunch(value: any): {
  s3Prefix: string; sourceVersion: string | number;
  access: { expiresAt: string; resources: Record<string, string> };
} {
  if (value?.schemaVersion !== 1) throw new Error('Личный кабинет пока не поддерживает новый формат просмотра.');
  if (value.viewerAvailable !== true) throw new Error('Сжатая серия ещё не подготовлена.');
  if (typeof value.s3Prefix !== 'string' || !['number', 'string'].includes(typeof value.sourceVersion) || !String(value.sourceVersion).trim()) {
    throw new Error('Не указана актуальная версия исследования.');
  }
  const s3Prefix = compressedStudyRoot(value.s3Prefix);
  const access = value.access;
  if (!access || typeof access.expiresAt !== 'string' || !Number.isFinite(Date.parse(access.expiresAt)) || Date.parse(access.expiresAt) <= Date.now()) {
    throw new Error('Срок доступа истёк. Откройте исследование заново из личного кабинета.');
  }
  if (!access.resources || Array.isArray(access.resources) || typeof access.resources !== 'object' || !Object.keys(access.resources).length) {
    throw new Error('Не предоставлен доступ к файлам сжатой серии.');
  }
  return { s3Prefix, sourceVersion: value.sourceVersion, access };
}
