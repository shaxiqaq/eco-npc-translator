import { useEffect, useState } from 'react';

type SkillIconResult = {
  ok?: boolean;
  dataUrl?: string;
  name?: string;
  nameClient?: string;
  nameJa?: string;
  wikiUrl?: string;
};

const cache = new Map<number, Promise<SkillIconResult>>();

export function getSkillIconResult(skillId: number) {
  if (!Number.isInteger(skillId) || skillId <= 0) {
    return Promise.resolve({ ok: false as const });
  }
  if (!cache.has(skillId)) {
    cache.set(skillId, window.eco.getSkillIcon(skillId));
  }
  return cache.get(skillId)!;
}

export function clearSkillIconCache() {
  cache.clear();
}

export function useSkillIcon(skillId?: number | null) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [nameClient, setNameClient] = useState<string>('');
  const [nameJa, setNameJa] = useState<string>('');
  const [wikiUrl, setWikiUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const id = Number(skillId);
    if (!Number.isInteger(id) || id <= 0) {
      setDataUrl(null);
      setName(null);
      setNameClient('');
      setNameJa('');
      setWikiUrl('');
      return;
    }
    getSkillIconResult(id).then((result) => {
      if (cancelled) return;
      setDataUrl(result?.ok && result.dataUrl ? result.dataUrl : null);
      setName(result?.name ? String(result.name).trim() : null);
      setNameClient(String(result?.nameClient || '').trim());
      setNameJa(String(result?.nameJa || '').trim());
      setWikiUrl(String(result?.wikiUrl || '').trim());
    }).catch(() => {
      if (!cancelled) {
        setDataUrl(null);
        setName(null);
        setNameClient('');
        setNameJa('');
        setWikiUrl('');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  return { dataUrl, name, nameClient, nameJa, wikiUrl };
}
